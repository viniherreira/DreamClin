import 'server-only';

import { unstable_cache } from 'next/cache';
import { googleAdsConnection, googleAdsCredentials, googleAdsTag, type GoogleAdsConnection } from './google-ads-account';
import { GoogleAdsError, googleSearch } from './google-ads-api';
import { buildGoogleAudience, parseGoogleBreakdown, parseGoogleRow, type GoogleBreakdownKind } from './google-ads-rules';
import { buildAdHours, buildAdsReport, buildPlatforms, type AdInfo, type AdsReport, type BreakdownRow, type InsightRow, type MetaErrorKind } from './ads-rules';
import type { AdsBreakdowns } from './ads-report';
import { daysOf, reportRange, type DayRange, type ReportPeriodKey } from './report-period';

/**
 * A aba Google da tela Anúncios: busca os números do Google Ads (com cache de
 * 15 minutos por clínica) e monta o mesmo relatório da aba Meta, com as regras
 * de `ads-rules.ts`. Nada é guardado no banco.
 */

const CACHE_SECONDS = 900;

export type GoogleLevel = 'account' | 'campaign' | 'ad';

const METRICAS = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions';
const dia = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '1970-01-01');
const entre = (since: string, until: string) => `segments.date BETWEEN '${dia(since)}' AND '${dia(until)}'`;
const daCampanha = (id: string | null) => (id && /^\d{1,25}$/.test(id) ? ` AND campaign.id = ${id}` : '');

/** A consulta de cada nível (só leitura, GAQL). */
export function insightsQuery(q: { since: string; until: string; level: GoogleLevel; daily: boolean }): string {
  const data = q.daily ? ', segments.date' : '';
  if (q.level === 'account') return `SELECT ${METRICAS}${data} FROM customer WHERE ${entre(q.since, q.until)}`;
  if (q.level === 'campaign') return `SELECT campaign.id, campaign.name, ${METRICAS}${data} FROM campaign WHERE ${entre(q.since, q.until)}`;
  return `SELECT campaign.id, campaign.name, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ${METRICAS}${data} FROM ad_group_ad WHERE ${entre(q.since, q.until)}`;
}

/** A consulta de cada recorte. Idade e gênero vêm das visões próprias do Google. */
export function breakdownQuery(q: { since: string; until: string; kind: GoogleBreakdownKind; campaignId: string | null }): string {
  const filtro = `${entre(q.since, q.until)}${daCampanha(q.campaignId)}`;
  switch (q.kind) {
    case 'network':
      return `SELECT segments.ad_network_type, ${METRICAS} FROM campaign WHERE ${filtro}`;
    case 'device':
      return `SELECT segments.device, ${METRICAS} FROM campaign WHERE ${filtro}`;
    case 'hour':
      return `SELECT segments.hour, ${METRICAS} FROM campaign WHERE ${filtro}`;
    case 'age':
      return `SELECT ad_group_criterion.age_range.type, ${METRICAS} FROM age_range_view WHERE ${filtro}`;
    case 'gender':
      return `SELECT ad_group_criterion.gender.type, ${METRICAS} FROM gender_view WHERE ${filtro}`;
  }
}

export interface GoogleFetchers {
  insights(tenantId: string, customerId: string, q: { since: string; until: string; level: GoogleLevel; daily: boolean }): Promise<{ rows: InsightRow[]; at: number }>;
  breakdown(tenantId: string, customerId: string, q: { since: string; until: string; kind: GoogleBreakdownKind; campaignId: string | null }): Promise<BreakdownRow[]>;
}

async function credFor(tenantId: string, customerId: string) {
  const cred = await googleAdsCredentials(tenantId);
  // A conta mudou entre montar a tela e buscar: não usa o token numa conta que não é mais a escolhida.
  if (!cred || cred.customerId !== customerId) throw new GoogleAdsError('auth', 'A conexão com o Google Ads mudou. Atualize a página.');
  return cred;
}

/** Direto no Google, sem cache (os testes usam este). */
export const liveGoogleFetchers: GoogleFetchers = {
  async insights(tenantId, customerId, q) {
    const c = await credFor(tenantId, customerId);
    const rows = await googleSearch(c.accessToken, c.customerId, c.loginCustomerId, insightsQuery(q));
    return { rows: rows.map(parseGoogleRow), at: Date.now() };
  },
  async breakdown(tenantId, customerId, q) {
    const c = await credFor(tenantId, customerId);
    const rows = await googleSearch(c.accessToken, c.customerId, c.loginCustomerId, breakdownQuery(q));
    return rows.map((r) => parseGoogleBreakdown(r, q.kind));
  },
};

/** Com cache de 15 minutos. A chave é a clínica, a conta e o pedido; o token nunca entra nela. */
export const cachedGoogleFetchers: GoogleFetchers = {
  insights: (tenantId, customerId, q) =>
    unstable_cache(() => liveGoogleFetchers.insights(tenantId, customerId, q), ['gads-insights', tenantId, customerId, q.since, q.until, q.level, String(q.daily)], {
      revalidate: CACHE_SECONDS,
      tags: [googleAdsTag(tenantId)],
    })(),
  breakdown: (tenantId, customerId, q) =>
    unstable_cache(() => liveGoogleFetchers.breakdown(tenantId, customerId, q), ['gads-breakdown', tenantId, customerId, q.since, q.until, q.kind, q.campaignId ?? ''], {
      revalidate: CACHE_SECONDS,
      tags: [googleAdsTag(tenantId)],
    })(),
};

export type GoogleAdsPageData =
  | { state: 'not_connected' | 'choosing'; connection: GoogleAdsConnection }
  | { state: 'error'; connection: GoogleAdsConnection; kind: MetaErrorKind; message: string }
  | { state: 'ok'; connection: GoogleAdsConnection; report: AdsReport; breakdowns: AdsBreakdowns; range: DayRange; fetchedAt: string };

export async function loadGoogleAdsPage(
  tenantId: string,
  period: ReportPeriodKey,
  campaignId: string | null,
  opts: { now?: Date; fetchers?: GoogleFetchers } = {},
): Promise<GoogleAdsPageData> {
  const connection = await googleAdsConnection(tenantId);
  if (connection.state === 'none') return { state: 'not_connected', connection };
  if (connection.state === 'choosing' || !connection.accountId) return { state: 'choosing', connection };

  const g = opts.fetchers ?? cachedGoogleFetchers;
  const conta = connection.accountId;
  const { current, previous } = reportRange(period, opts.now);

  try {
    // Os recortes são um extra: se o Google negar um deles, a tela segue sem aquele gráfico.
    const recorte = (kind: GoogleBreakdownKind) =>
      g.breakdown(tenantId, conta, { since: current.since, until: current.until, kind, campaignId }).catch((e) => {
        if (e instanceof GoogleAdsError && e.kind === 'auth') throw e;
        return [] as BreakdownRow[];
      });
    const [porCampanhaDia, porAnuncio, porRede, porAparelho, porIdade, porGenero, porHora] = await Promise.all([
      g.insights(tenantId, conta, { since: previous.since, until: current.until, level: 'campaign', daily: true }),
      g.insights(tenantId, conta, { since: current.since, until: current.until, level: 'ad', daily: false }),
      recorte('network'),
      recorte('device'),
      recorte('age'),
      recorte('gender'),
      recorte('hour'),
    ]);

    // A "ficha" de cada anúncio sai da própria linha: o Google não tem miniatura para anúncio de pesquisa.
    const fichas = new Map<string, AdInfo>();
    for (const r of porAnuncio.rows) {
      if (r.adId) fichas.set(r.adId, { name: r.adName, campaignId: r.campaignId, campaignName: r.campaignName, thumbnailUrl: null });
    }

    const report = buildAdsReport({
      days: daysOf(current),
      campaignDaily: porCampanhaDia.rows,
      adTotals: porAnuncio.rows,
      accountReach: 0,
      campaignReach: new Map(),
      adInfo: fichas,
      // O CRM do Google (quem agendou e fechou) entra com o link de WhatsApp do Google.
      crmCurrent: [],
      crmPrevious: [],
      campaignId,
    });
    const breakdowns: AdsBreakdowns = {
      platforms: buildPlatforms(porRede),
      devices: buildPlatforms(porAparelho),
      audience: buildGoogleAudience(porIdade, porGenero),
      hours: buildAdHours(porHora),
    };
    const at = Math.min(porCampanhaDia.at, porAnuncio.at);
    return { state: 'ok', connection, report, breakdowns, range: current, fetchedAt: new Date(at).toISOString() };
  } catch (e) {
    if (e instanceof GoogleAdsError) return { state: 'error', connection, kind: e.kind, message: e.message };
    console.error('[crm] aba google falhou', { tenantId, message: e instanceof Error ? e.name : 'erro desconhecido' });
    return { state: 'error', connection, kind: 'other', message: 'Não foi possível montar os números agora. Tente de novo.' };
  }
}
