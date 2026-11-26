import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe('Google Ads: consultas', async () => {
  const { insightsQuery, breakdownQuery } = await import('./google-ads-report');
  it('só leitura, com o período e a campanha validados', () => {
    expect(insightsQuery({ since: '2026-11-01', until: '2026-11-30', level: 'campaign', daily: true })).toBe(
      "SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, segments.date FROM campaign WHERE segments.date BETWEEN '2026-11-01' AND '2026-11-30'",
    );
    expect(breakdownQuery({ since: '2026-11-01', until: '2026-11-30', kind: 'age', campaignId: '123' })).toContain('FROM age_range_view');
    expect(breakdownQuery({ since: '2026-11-01', until: '2026-11-30', kind: 'hour', campaignId: '123' })).toContain('AND campaign.id = 123');
    // Nada de fora entra na consulta.
    expect(breakdownQuery({ since: "x' OR 1=1", until: '2026-11-30', kind: 'device', campaignId: '1; DROP' })).toBe(
      "SELECT segments.device, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '1970-01-01' AND '2026-11-30'",
    );
  });
});

describe.skipIf(!process.env.DATABASE_URL)('Google Ads: a aba Google monta o relatório (banco)', async () => {
  const { prisma } = await import('@clinicaiq/db');
  const { sealToken } = await import('@/lib/cloud-account');
  const { loadGoogleAdsPage } = await import('./google-ads-report');
  const { GoogleAdsError } = await import('./google-ads-api');
  type Fetchers = NonNullable<Parameters<typeof loadGoogleAdsPage>[3]>['fetchers'];

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await prisma.tenant.create({ data: { clerkOrgId: `gadr_${suffix}`, name: 'Google R', slug: `gadr-${suffix}` } });
  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.$disconnect();
  });

  const NOW = new Date('2026-11-25T15:00:00Z');
  const linha = (o: Partial<{ day: string; campaignId: string; campaignName: string; adId: string; adName: string; spendCents: number; impressions: number; clicks: number; conversations: number }>) => ({
    day: o.day ?? null,
    campaignId: o.campaignId ?? null,
    campaignName: o.campaignName ?? null,
    adId: o.adId ?? null,
    adName: o.adName ?? null,
    spendCents: o.spendCents ?? 0,
    impressions: o.impressions ?? 0,
    reach: 0,
    clicks: o.clicks ?? 0,
    conversations: o.conversations ?? 0,
  });
  const falsos: Fetchers = {
    insights: async (_t, _c, q) => ({
      at: NOW.getTime(),
      rows:
        q.level === 'campaign'
          ? [
              linha({ day: '2026-11-20', campaignId: '11', campaignName: 'Implante Pesquisa', spendCents: 30_000, impressions: 2_000, clicks: 100, conversations: 10 }),
              linha({ day: '2026-11-21', campaignId: '22', campaignName: 'Clareamento YouTube', spendCents: 10_000, impressions: 8_000, clicks: 40, conversations: 2 }),
            ]
          : [linha({ campaignId: '11', campaignName: 'Implante Pesquisa', adId: '901', adName: 'Grupo implante', spendCents: 30_000, impressions: 2_000, clicks: 100, conversations: 10 })],
    }),
    breakdown: async (_t, _c, q) =>
      q.kind === 'network'
        ? [{ keys: { publisher_platform: 'Pesquisa Google' }, spendCents: 30_000, impressions: 2_000, clicks: 100, conversations: 10 }]
        : q.kind === 'device'
          ? [{ keys: { publisher_platform: 'Celular' }, spendCents: 25_000, impressions: 1_500, clicks: 80, conversations: 9 }]
          : [],
  };

  it('sem conexão: pede para conectar', async () => {
    expect((await loadGoogleAdsPage(tenant.id, '30d', null, { now: NOW, fetchers: falsos })).state).toBe('not_connected');
  });

  it('conectado: investimento, conversões, custo por conversão, lugares e aparelhos', async () => {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { settings: { googleAds: { refreshTokenEncrypted: sealToken('r', tenant.id), customerId: '1234567890', accountName: 'Clínica', connectedAt: NOW.toISOString() } } },
    });
    const d = await loadGoogleAdsPage(tenant.id, '30d', null, { now: NOW, fetchers: falsos });
    if (d.state !== 'ok') throw new Error(d.state);
    expect(d.report.totals.spendCents).toBe(40_000);
    expect(d.report.totals.conversations).toBe(12);
    expect(d.report.kpis.costPerConversation.value).toBe(Math.round(40_000 / 12));
    expect(d.report.delivery.reach).toBe(0);
    expect(d.report.campaigns.map((c) => c.name)).toEqual(['Clareamento YouTube', 'Implante Pesquisa']);
    expect(d.breakdowns.platforms.lines[0].label).toBe('Pesquisa Google');
    expect(d.breakdowns.devices?.lines[0].label).toBe('Celular');
  });

  it('conexão vencida vira o aviso de reconectar', async () => {
    const vencida: Fetchers = { ...falsos, insights: async () => Promise.reject(new GoogleAdsError('auth', 'Conecte de novo.')) };
    const d = await loadGoogleAdsPage(tenant.id, '30d', null, { now: NOW, fetchers: vencida });
    expect(d).toMatchObject({ state: 'error', kind: 'auth' });
  });
});
