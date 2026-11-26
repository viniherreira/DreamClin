import 'server-only';

import { createHash } from 'node:crypto';
import { classifyGoogleError, customerNumber, googleErrorCodes, streamResults } from './google-ads-rules';
import type { MetaErrorKind } from './ads-rules';

/**
 * As chamadas ao Google (login e Google Ads API, só leitura). O token vai
 * sempre no cabeçalho, nunca no endereço, e nunca é escrito em log.
 *
 * Variáveis na Vercel (o dono cria no Google Cloud e no Google Ads):
 * - GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET: o cliente OAuth (Web).
 * - GOOGLE_ADS_DEVELOPER_TOKEN: o token de desenvolvedor da conta de administrador.
 * - GOOGLE_ADS_API_VERSION (opcional): a versão da API, ex. "v26". O Google desliga cada versão cerca de um ano depois de lançar (a v22 saiu do ar em nov/2026).
 */

export class GoogleAdsError extends Error {
  constructor(
    readonly kind: MetaErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleAdsError';
  }
}

export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

// Sem espaço nem quebra de linha que venham junto ao colar a chave na Vercel.
const env = (nome: 'GOOGLE_ADS_CLIENT_ID' | 'GOOGLE_ADS_CLIENT_SECRET' | 'GOOGLE_ADS_DEVELOPER_TOKEN') => process.env[nome]?.trim() ?? '';

export function googleAdsConfigured(): boolean {
  return Boolean(env('GOOGLE_ADS_CLIENT_ID') && env('GOOGLE_ADS_CLIENT_SECRET') && env('GOOGLE_ADS_DEVELOPER_TOKEN'));
}

const apiVersion = () => (process.env.GOOGLE_ADS_API_VERSION?.trim().match(/^v\d{2,3}$/) ? process.env.GOOGLE_ADS_API_VERSION.trim() : 'v26');
const adsBase = () => `https://googleads.googleapis.com/${apiVersion()}`;

/** O endereço da janela de login do Google. `state` amarra a volta a esta clínica e pessoa. */
export function googleAuthUrl(state: string, redirectUri: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env('GOOGLE_ADS_CLIENT_ID'));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_ADS_SCOPE);
  // offline + consent: o Google entrega o token de renovação, que deixa ler os números depois.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }> {
  let res: Response;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env('GOOGLE_ADS_CLIENT_ID'), client_secret: env('GOOGLE_ADS_CLIENT_SECRET'), ...params }),
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
  } catch {
    throw new GoogleAdsError('other', 'O Google demorou para responder. Tente de novo em instantes.');
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok) {
    console.error('[crm] google: token recusado', { status: res.status, erro: typeof body.error === 'string' ? body.error.slice(0, 60) : '?' });
    const e = classifyGoogleError(res.status, body);
    throw new GoogleAdsError(e.kind, e.message);
  }
  return body;
}

/** Fim da janela do Google: troca o código pelo token de renovação. */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<{ refreshToken: string; scopes: string[] }> {
  const body = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (!body.refresh_token) {
    throw new GoogleAdsError('other', 'O Google não entregou a autorização para ler os números. Clique em Conectar de novo.');
  }
  return { refreshToken: body.refresh_token, scopes: (body.scope ?? '').split(/\s+/).filter(Boolean) };
}

/** Token de acesso (dura 1 hora), guardado em memória pelo resumo do token de renovação. */
const acessos = new Map<string, { token: string; until: number }>();
export async function googleAccessToken(refreshToken: string): Promise<string> {
  const chave = createHash('sha256').update(refreshToken).digest('hex');
  const ja = acessos.get(chave);
  if (ja && ja.until > Date.now() + 60_000) return ja.token;
  const body = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  if (!body.access_token) throw new GoogleAdsError('auth', 'A conexão com o Google Ads expirou. Conecte de novo em Canais.');
  acessos.set(chave, { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000 });
  return body.access_token;
}

/** Esquece o token de acesso guardado (ao desconectar). */
export function forgetGoogleAccess(refreshToken: string): void {
  acessos.delete(createHash('sha256').update(refreshToken).digest('hex'));
}

function adsHeaders(accessToken: string, loginCustomerId?: string | null): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN'),
    'Content-Type': 'application/json',
    ...(loginCustomerId ? { 'login-customer-id': loginCustomerId } : {}),
  };
}

async function adsFetch(path: string, init: { method: 'GET' | 'POST'; accessToken: string; loginCustomerId?: string | null; body?: unknown }): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${adsBase()}/${path}`, {
      method: init.method,
      headers: adsHeaders(init.accessToken, init.loginCustomerId),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
  } catch {
    throw new GoogleAdsError('other', 'O Google Ads demorou para responder. Tente de novo em instantes.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = classifyGoogleError(res.status, body);
    // Só o status, o tipo e os nomes dos códigos: a mensagem do Google pode trazer nome de conta e e-mail.
    console.error('[crm] google ads recusou', { status: res.status, tipo: e.kind, codigos: googleErrorCodes(body), caminho: path.replace(/\d{10}/g, 'N') });
    throw new GoogleAdsError(e.kind, e.message);
  }
  return body;
}

/** As contas que o e-mail conectado alcança diretamente. */
export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const body = (await adsFetch('customers:listAccessibleCustomers', { method: 'GET', accessToken })) as { resourceNames?: unknown };
  const nomes = Array.isArray(body.resourceNames) ? body.resourceNames : [];
  return [...new Set(nomes.map(customerNumber).filter((x): x is string => Boolean(x)))];
}

/** Uma consulta GAQL, com todas as linhas (o searchStream manda em lotes). */
export async function googleSearch(accessToken: string, customerId: string, loginCustomerId: string | null, query: string): Promise<unknown[]> {
  const body = await adsFetch(`customers/${customerId}/googleAds:searchStream`, { method: 'POST', accessToken, loginCustomerId, body: { query } });
  return streamResults(body);
}

export interface GoogleAdsAccountOption {
  id: string;
  name: string;
  currency: string | null;
  /** A conta de administrador por onde se chega nesta conta (nulo: acesso direto). */
  loginCustomerId: string | null;
  test: boolean;
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * As contas de anúncios que a pessoa pode escolher: as diretas e, para cada
 * conta de administrador, as contas de anúncios debaixo dela. Contas de
 * administrador não têm anúncios, então não entram na lista.
 */
export async function listGoogleAdsAccounts(accessToken: string): Promise<GoogleAdsAccountOption[]> {
  const ids = (await listAccessibleCustomers(accessToken)).slice(0, 30);
  const out = new Map<string, GoogleAdsAccountOption>();
  for (const id of ids) {
    let rows: unknown[];
    try {
      rows = await googleSearch(
        accessToken,
        id,
        id,
        'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.test_account FROM customer LIMIT 1',
      );
    } catch (e) {
      // Conta cancelada ou sem permissão: some da lista, as outras seguem.
      if (e instanceof GoogleAdsError && (e.kind === 'auth' || e.kind === 'rate')) throw e;
      continue;
    }
    const c = (rows[0] as { customer?: Record<string, unknown> } | undefined)?.customer;
    if (!c) continue;
    if (c.manager === true) {
      let filhas: unknown[] = [];
      try {
        filhas = await googleSearch(
          accessToken,
          id,
          id,
          'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager, customer_client.test_account, customer_client.status FROM customer_client WHERE customer_client.manager = FALSE AND customer_client.status = ENABLED',
        );
      } catch (e) {
        if (e instanceof GoogleAdsError && (e.kind === 'auth' || e.kind === 'rate')) throw e;
      }
      for (const f of filhas) {
        const cc = (f as { customerClient?: Record<string, unknown> }).customerClient;
        const cid = customerNumber(cc?.id);
        if (!cc || !cid || out.has(cid)) continue;
        out.set(cid, { id: cid, name: texto(cc.descriptiveName) ?? cid, currency: texto(cc.currencyCode), loginCustomerId: id, test: cc.testAccount === true });
      }
      continue;
    }
    out.set(id, { id, name: texto(c.descriptiveName) ?? id, currency: texto(c.currencyCode), loginCustomerId: null, test: c.testAccount === true });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
