import type { Audience, BreakdownMetric, BreakdownRow, InsightRow, MetaErrorKind } from './ads-rules';

/**
 * Regras puras do Google Ads (testadas por tabela): o que fica guardado da
 * conexão, os números que a API devolve e os erros, no mesmo formato que a
 * tela da Meta já usa. Assim a aba Google reaproveita os mesmos gráficos.
 */

export interface GoogleAdsSettings {
  refreshTokenEncrypted: string;
  /** A conta de anúncios (só números, sem traços). Nulo enquanto a pessoa escolhe. */
  customerId: string | null;
  /** A conta de administrador por onde se chega na conta (quando é assim). */
  loginCustomerId: string | null;
  accountName: string | null;
  currency: string | null;
  connectedAt: string;
  connectedById: string | null;
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** "123-456-7890", "customers/1234567890" ou 1234567890 → "1234567890". */
export function customerNumber(id: unknown): string | null {
  const s = typeof id === 'number' ? String(id) : texto(id);
  if (!s) return null;
  const n = s.replace(/^customers\//, '').replace(/-/g, '');
  return /^\d{10}$/.test(n) ? n : null;
}

/** "1234567890" → "123-456-7890", como o Google mostra. */
export const customerLabel = (id: string) => (/^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

export function readGoogleAdsSettings(settings: unknown): GoogleAdsSettings | null {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).googleAds : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const refreshTokenEncrypted = texto(o.refreshTokenEncrypted);
  if (!refreshTokenEncrypted) return null;
  return {
    refreshTokenEncrypted,
    customerId: customerNumber(o.customerId),
    loginCustomerId: customerNumber(o.loginCustomerId),
    accountName: texto(o.accountName),
    currency: texto(o.currency),
    connectedAt: texto(o.connectedAt) ?? new Date(0).toISOString(),
    connectedById: texto(o.connectedById),
  };
}

/** O Google manda dinheiro em milionésimos ("cost_micros"): 12_340_000 → 1234 centavos. */
export function microsToCents(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n / 10_000) : 0;
}

const inteiro = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** O caminho dentro do JSON da API ("campaign.id" → r.campaign.id). */
function at(r: unknown, path: string): unknown {
  let cur: unknown = r;
  for (const k of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/**
 * Uma linha do `searchStream` → os números da tela. O Google não tem
 * "alcance" na pesquisa (fica 0 e a tela esconde) e chama de "conversões" o
 * que a conta marcou como resultado (clique no WhatsApp, ligação, formulário).
 */
export function parseGoogleRow(raw: unknown): InsightRow {
  const dia = texto(at(raw, 'segments.date'));
  const campaignId = at(raw, 'campaign.id');
  const adId = at(raw, 'adGroupAd.ad.id');
  return {
    day: dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null,
    campaignId: campaignId !== undefined && campaignId !== null ? String(campaignId) : null,
    campaignName: texto(at(raw, 'campaign.name')),
    adId: adId !== undefined && adId !== null ? String(adId) : null,
    adName: texto(at(raw, 'adGroupAd.ad.name')) ?? texto(at(raw, 'adGroup.name')),
    spendCents: microsToCents(at(raw, 'metrics.costMicros')),
    impressions: inteiro(at(raw, 'metrics.impressions')),
    reach: 0,
    clicks: inteiro(at(raw, 'metrics.clicks')),
    conversations: inteiro(at(raw, 'metrics.conversions')),
  };
}

/** As linhas de todos os lotes do `searchStream` (a resposta é uma lista de lotes). */
export function streamResults(body: unknown): unknown[] {
  const lotes = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
  return lotes.flatMap((l) => {
    const res = l && typeof l === 'object' ? (l as { results?: unknown }).results : undefined;
    return Array.isArray(res) ? res : [];
  });
}

/** O motivo do erro do Google em português, sem nada da resposta que possa ter dado sensível. */
export function classifyGoogleError(status: number, body: unknown): { kind: MetaErrorKind; message: string } {
  const txt = JSON.stringify(body ?? {}).slice(0, 4000);
  if (status === 429 || /RESOURCE_EXHAUSTED|RATE_EXCEEDED/.test(txt)) {
    return { kind: 'rate', message: 'O Google pediu uma pausa nas consultas. Tente de novo em alguns minutos.' };
  }
  if (status === 401 || /invalid_grant|UNAUTHENTICATED|OAUTH_TOKEN_(INVALID|EXPIRED|REVOKED)/.test(txt)) {
    return { kind: 'auth', message: 'A conexão com o Google Ads expirou ou foi retirada. Conecte de novo em Canais.' };
  }
  if (/DEVELOPER_TOKEN_NOT_APPROVED|DEVELOPER_TOKEN_PROHIBITED/.test(txt)) {
    return { kind: 'permission', message: 'O acesso do DreamClin à API do Google Ads ainda está em aprovação. Por enquanto só contas de teste funcionam.' };
  }
  if (status === 403 || /PERMISSION_DENIED|USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED/.test(txt)) {
    return { kind: 'permission', message: 'O Google não deixou ler esta conta. Confira se o e-mail conectado tem acesso a ela e conecte de novo.' };
  }
  return { kind: 'other', message: 'Não foi possível buscar os números do Google Ads agora. Tente de novo.' };
}

// ─── Recortes: rede, aparelho, idade, gênero e hora ─────────────────────────

export type GoogleBreakdownKind = 'network' | 'device' | 'age' | 'gender' | 'hour';

const NETWORK: Record<string, string> = {
  SEARCH: 'Pesquisa Google',
  SEARCH_PARTNERS: 'Parceiros de pesquisa',
  CONTENT: 'Rede de Display',
  YOUTUBE: 'YouTube',
  YOUTUBE_SEARCH: 'YouTube',
  YOUTUBE_WATCH: 'YouTube',
  GOOGLE_TV: 'Google TV',
  MIXED: 'Várias redes (Performance Max)',
};

const DEVICE: Record<string, string> = {
  MOBILE: 'Celular',
  DESKTOP: 'Computador',
  TABLET: 'Tablet',
  CONNECTED_TV: 'TV',
};

/** AGE_RANGE_25_34 → "25-34"; AGE_RANGE_65_UP → "65+". */
export function ageKey(v: unknown): string {
  const m = typeof v === 'string' ? v.match(/^AGE_RANGE_(\d{2})_(\d{2}|UP)$/) : null;
  if (!m) return 'unknown';
  return m[2] === 'UP' ? `${m[1]}+` : `${m[1]}-${m[2]}`;
}

export const genderKey = (v: unknown): string => (v === 'FEMALE' ? 'female' : v === 'MALE' ? 'male' : 'unknown');

/** Uma linha de recorte do Google → a linha de recorte que os gráficos já leem (as chaves da Meta). */
export function parseGoogleBreakdown(raw: unknown, kind: GoogleBreakdownKind): BreakdownRow {
  const base = parseGoogleRow(raw);
  const keys: Record<string, string> = {};
  if (kind === 'network') {
    const n = at(raw, 'segments.adNetworkType');
    keys.publisher_platform = (typeof n === 'string' && NETWORK[n]) || 'unknown';
  } else if (kind === 'device') {
    const d = at(raw, 'segments.device');
    keys.publisher_platform = (typeof d === 'string' && DEVICE[d]) || 'unknown';
  } else if (kind === 'age') {
    keys.age = ageKey(at(raw, 'adGroupCriterion.ageRange.type'));
    keys.gender = 'unknown';
  } else if (kind === 'gender') {
    keys.age = 'unknown';
    keys.gender = genderKey(at(raw, 'adGroupCriterion.gender.type'));
  } else {
    const h = Number(at(raw, 'segments.hour'));
    keys.hourly_stats_aggregated_by_advertiser_time_zone = Number.isInteger(h) && h >= 0 && h <= 23 ? `${String(h).padStart(2, '0')}:00:00` : 'unknown';
  }
  return { keys, spendCents: base.spendCents, impressions: base.impressions, clicks: base.clicks, conversations: base.conversations };
}

const AGE_ORDER = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

/**
 * Idade e gênero do Google vêm separados (não dá para cruzar): as faixas de
 * idade ficam na coluna "não informado" e o gênero, só nos totais. A tela
 * mostra os dois lado a lado, sem a pirâmide.
 */
export function buildGoogleAudience(ageRows: readonly BreakdownRow[], genderRows: readonly BreakdownRow[]): Audience {
  const todas = [...ageRows, ...genderRows];
  const metric: BreakdownMetric = todas.some((r) => r.conversations > 0) ? 'conversations' : todas.some((r) => r.clicks > 0) ? 'clicks' : 'impressions';
  const porIdade = new Map<string, number>();
  for (const r of ageRows) {
    const age = r.keys.age ?? 'unknown';
    if (age === 'unknown' || r[metric] <= 0) continue;
    porIdade.set(age, (porIdade.get(age) ?? 0) + r[metric]);
  }
  const totals = { female: 0, male: 0, unknown: 0 };
  for (const r of genderRows) {
    const g = r.keys.gender === 'female' ? 'female' : r.keys.gender === 'male' ? 'male' : 'unknown';
    totals[g] += Math.max(0, r[metric]);
  }
  const ordem = (a: string) => (AGE_ORDER.indexOf(a) === -1 ? 99 : AGE_ORDER.indexOf(a));
  const ages = [...porIdade.entries()]
    .map(([age, v]) => ({ age, female: 0, male: 0, unknown: v }))
    .sort((a, b) => ordem(a.age) - ordem(b.age));
  return { metric, ages, totals, top: null };
}

