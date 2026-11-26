import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe('Google Ads: a volta da janela só vale para a mesma clínica e pessoa', async () => {
  const { signGoogleState, verifyGoogleState } = await import('./google-ads-account');
  it('assinatura, validade e dono', () => {
    const s = signGoogleState('t1', 'u1', 1_000);
    expect(verifyGoogleState(s, 't1', 'u1', 2_000)).toBe(true);
    expect(verifyGoogleState(s, 't2', 'u1', 2_000)).toBe(false);
    expect(verifyGoogleState(s, 't1', 'u2', 2_000)).toBe(false);
    expect(verifyGoogleState(s, 't1', 'u1', 1_000 + 16 * 60_000)).toBe(false);
    const [corpo] = s.split('.');
    expect(verifyGoogleState(`${corpo}.assinatura-falsa`, 't1', 'u1', 2_000)).toBe(false);
    expect(verifyGoogleState('lixo', 't1', 'u1', 2_000)).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('Google Ads: conectar, escolher e desconectar (banco)', async () => {
  process.env.GOOGLE_ADS_CLIENT_ID = 'cliente-teste';
  process.env.GOOGLE_ADS_CLIENT_SECRET = 'segredo-teste';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-teste';
  const { prisma } = await import('@clinicaiq/db');
  const g = await import('./google-ads-account');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await prisma.tenant.create({ data: { clerkOrgId: `gads_${suffix}`, name: 'Google', slug: `gads-${suffix}` } });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.$disconnect();
  });

  /** Um Google de mentira: token, contas acessíveis (uma direta e um administrador com uma filha) e as consultas. */
  const googleFalso = (opts: { scope?: string } = {}) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
        if (url.includes('oauth2.googleapis.com/token')) {
          const corpo = String(init?.body ?? '');
          if (corpo.includes('authorization_code')) return json({ access_token: 'acesso-1', refresh_token: 'renovacao-secreta', expires_in: 3600, scope: opts.scope ?? 'https://www.googleapis.com/auth/adwords' });
          return json({ access_token: 'acesso-2', expires_in: 3600 });
        }
        if (url.endsWith('customers:listAccessibleCustomers')) return json({ resourceNames: ['customers/1111111111', 'customers/9999999999'] });
        if (url.includes('/customers/1111111111/googleAds:searchStream')) {
          return json([{ results: [{ customer: { id: '1111111111', descriptiveName: 'Clínica Sorriso', currencyCode: 'BRL', manager: false, testAccount: false } }] }]);
        }
        if (url.includes('/customers/9999999999/googleAds:searchStream')) {
          const q = JSON.parse(String(init?.body ?? '{}')).query as string;
          if (q.includes('FROM customer_client')) {
            return json([{ results: [{ customerClient: { id: '2222222222', descriptiveName: 'Filial Centro', currencyCode: 'BRL', manager: false, testAccount: true } }] }]);
          }
          return json([{ results: [{ customer: { id: '9999999999', descriptiveName: 'Agência', manager: true } }] }]);
        }
        return json({}, 404);
      }),
    );

  it('sem a permissão do Google Ads marcada, não conecta', async () => {
    googleFalso({ scope: 'openid' });
    const r = await g.finishGoogleConnection(tenant.id, 'u1', 'codigo');
    expect(r.ok).toBe(false);
    expect((await g.googleAdsConnection(tenant.id)).state).toBe('none');
  });

  it('conecta, guarda o token cifrado e lista as contas (administrador vira as filhas)', async () => {
    googleFalso();
    const r = await g.finishGoogleConnection(tenant.id, 'u1', 'codigo');
    if (!r.ok) throw new Error(r.message);
    expect(r.chosen).toBeNull();
    expect(r.accounts.map((a) => [a.id, a.loginCustomerId])).toEqual([
      ['1111111111', null],
      ['2222222222', '9999999999'],
    ]);
    const t = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { settings: true } });
    const salvo = JSON.stringify(t?.settings);
    expect(salvo).not.toContain('renovacao-secreta');
    expect((await g.googleAdsConnection(tenant.id)).state).toBe('choosing');
  });

  it('escolhe a conta pela de administrador e lê as credenciais', async () => {
    googleFalso();
    expect((await g.chooseGoogleAdsAccount(tenant.id, 'u1', '222-222-2222')).ok).toBe(true);
    const c = await g.googleAdsConnection(tenant.id);
    expect(c).toMatchObject({ state: 'connected', accountId: '2222222222', accountName: 'Filial Centro' });
    const cred = await g.googleAdsCredentials(tenant.id);
    expect(cred).toMatchObject({ customerId: '2222222222', loginCustomerId: '9999999999' });
    expect((await g.chooseGoogleAdsAccount(tenant.id, 'u1', '3333333333')).ok).toBe(false);
  });

  it('desconectar apaga o token e a conta', async () => {
    googleFalso();
    expect((await g.disconnectGoogleAds(tenant.id, 'u1')).ok).toBe(true);
    expect((await g.googleAdsConnection(tenant.id)).state).toBe('none');
    expect(await g.googleAdsCredentials(tenant.id)).toBeNull();
  });
});
