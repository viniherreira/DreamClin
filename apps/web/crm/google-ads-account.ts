import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { decrypt, prisma, type Prisma } from '@clinicaiq/db';
import { sealToken } from '@/lib/cloud-account';
import { siteUrl } from '@/lib/company';
import { readGoogleAdsSettings, type GoogleAdsSettings } from './google-ads-rules';
import {
  exchangeGoogleCode,
  forgetGoogleAccess,
  googleAccessToken,
  googleAdsConfigured,
  GoogleAdsError,
  listGoogleAdsAccounts,
  type GoogleAdsAccountOption,
} from './google-ads-api';

/**
 * A conexão da clínica com o Google Ads (só leitura). A pessoa entra pela
 * janela do Google; o token de renovação fica cifrado em
 * `Tenant.settings.googleAds` e nunca vai para o navegador nem para o log.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/** A etiqueta do cache dos números do Google desta clínica. */
export const googleAdsTag = (tenantId: string) => `google-ads:${tenantId}`;

/** Para onde o Google devolve a pessoa (cadastrado igual no cliente OAuth do Google Cloud). */
export const googleRedirectUri = () => `${siteUrl()}/api/google-ads/callback`;

function masterKey(): string {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) throw new Error('ENCRYPTION_MASTER_KEY not set');
  return key;
}

// ─── O "state" da janela: amarra a volta à clínica e à pessoa ────────────────

const STATE_TTL_MS = 15 * 60_000;
const assinar = (texto: string) => createHmac('sha256', `${masterKey()}:google-ads-state`).update(texto).digest('base64url');

export function signGoogleState(tenantId: string, userId: string, now = Date.now()): string {
  const corpo = Buffer.from(JSON.stringify({ t: tenantId, u: userId, e: now + STATE_TTL_MS })).toString('base64url');
  return `${corpo}.${assinar(corpo)}`;
}

/** Confere a assinatura, a validade e que é a mesma clínica e pessoa logadas agora. */
export function verifyGoogleState(state: string, tenantId: string, userId: string, now = Date.now()): boolean {
  const [corpo, sig] = state.split('.');
  if (!corpo || !sig || state.length > 600) return false;
  const esperado = Buffer.from(assinar(corpo));
  const recebido = Buffer.from(sig);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return false;
  try {
    const o = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as { t?: string; u?: string; e?: number };
    return o.t === tenantId && o.u === userId && typeof o.e === 'number' && o.e > now;
  } catch {
    return false;
  }
}

// ─── Configurações da clínica ────────────────────────────────────────────────

async function readSettings(tenantId: string): Promise<{ all: Record<string, unknown>; google: GoogleAdsSettings | null }> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const all = t?.settings && typeof t.settings === 'object' && !Array.isArray(t.settings) ? (t.settings as Record<string, unknown>) : {};
  return { all, google: readGoogleAdsSettings(all) };
}

/** Grava só a parte `googleAds`; o resto do JSON fica como está. */
async function writeGoogle(tenantId: string, google: GoogleAdsSettings | null): Promise<void> {
  const { all } = await readSettings(tenantId);
  const novo: Record<string, unknown> = { ...all };
  if (google) novo.googleAds = { ...google };
  else delete novo.googleAds;
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: novo as Prisma.InputJsonValue } });
}

async function audit(tenantId: string, userId: string | null, action: string, metadata: object = {}) {
  await prisma.auditLog
    .create({ data: { tenantId, userId, action, entity: 'GoogleAdsAccount', entityId: tenantId, metadata } })
    .catch(() => undefined);
}

function refreshOf(tenantId: string, g: GoogleAdsSettings): string | null {
  try {
    return decrypt(g.refreshTokenEncrypted, masterKey(), tenantId);
  } catch {
    return null;
  }
}

const why = (e: unknown) => (e instanceof GoogleAdsError ? e.message : 'Não foi possível falar com o Google agora. Tente de novo.');

export interface GoogleAdsConnection {
  state: 'none' | 'choosing' | 'connected';
  accountId: string | null;
  accountName: string | null;
  currency: string | null;
  connectedAt: string | null;
}

/** O que a tela mostra da conexão (nunca o token). */
export async function googleAdsConnection(tenantId: string): Promise<GoogleAdsConnection> {
  const { google } = await readSettings(tenantId);
  if (!google) return { state: 'none', accountId: null, accountName: null, currency: null, connectedAt: null };
  return {
    state: google.customerId ? 'connected' : 'choosing',
    accountId: google.customerId,
    accountName: google.accountName,
    currency: google.currency,
    connectedAt: google.connectedAt,
  };
}

/** Token de acesso e conta para ler os números. Nulo: não conectou ou falta escolher a conta. */
export async function googleAdsCredentials(
  tenantId: string,
): Promise<{ accessToken: string; customerId: string; loginCustomerId: string | null } | null> {
  const { google } = await readSettings(tenantId);
  if (!google?.customerId) return null;
  const refresh = refreshOf(tenantId, google);
  if (!refresh) return null;
  return { accessToken: await googleAccessToken(refresh), customerId: google.customerId, loginCustomerId: google.loginCustomerId };
}

/**
 * Volta da janela do Google: troca o código, guarda o token de renovação
 * cifrado e devolve as contas para escolher. Com uma conta só, já escolhe.
 */
export async function finishGoogleConnection(
  tenantId: string,
  userId: string,
  code: string,
): Promise<Result<{ accounts: GoogleAdsAccountOption[]; chosen: GoogleAdsAccountOption | null }>> {
  if (!googleAdsConfigured()) return { ok: false, message: 'A conexão com o Google Ads ainda não está configurada no servidor.' };
  if (!code || code.length > 2000) return { ok: false, message: 'O Google não devolveu a autorização. Tente de novo.' };

  let refresh: string;
  let accounts: GoogleAdsAccountOption[];
  try {
    const r = await exchangeGoogleCode(code, googleRedirectUri());
    if (!r.scopes.includes('https://www.googleapis.com/auth/adwords')) {
      return { ok: false, message: 'Na janela do Google, deixe marcada a permissão de ver as campanhas do Google Ads e conecte de novo.' };
    }
    refresh = r.refreshToken;
    accounts = await listGoogleAdsAccounts(await googleAccessToken(refresh));
  } catch (e) {
    if (!(e instanceof GoogleAdsError)) console.error('[crm] conexão do google ads falhou', { tenantId, erro: e instanceof Error ? e.name : 'desconhecido' });
    return { ok: false, message: why(e) };
  }
  if (accounts.length === 0) {
    return { ok: false, message: 'Este e-mail do Google não tem nenhuma conta de anúncios. Conecte com o e-mail que acessa o Google Ads da clínica.' };
  }

  const chosen = accounts.length === 1 ? accounts[0] : null;
  await writeGoogle(tenantId, {
    refreshTokenEncrypted: sealToken(refresh, tenantId),
    customerId: chosen?.id ?? null,
    loginCustomerId: chosen?.loginCustomerId ?? null,
    accountName: chosen?.name ?? null,
    currency: chosen?.currency ?? null,
    connectedAt: new Date().toISOString(),
    connectedById: userId,
  });
  await audit(tenantId, userId, 'GOOGLE_ADS_CONNECTED', { accounts: accounts.length, accountId: chosen?.id ?? null });
  return { ok: true, accounts, chosen };
}

/** As contas que o token guardado alcança (para escolher ou trocar). */
export async function googleAdsAccountOptions(tenantId: string): Promise<Result<{ accounts: GoogleAdsAccountOption[] }>> {
  const { google } = await readSettings(tenantId);
  const refresh = google ? refreshOf(tenantId, google) : null;
  if (!google || !refresh) return { ok: false, message: 'Conecte o Google Ads primeiro.' };
  try {
    return { ok: true, accounts: await listGoogleAdsAccounts(await googleAccessToken(refresh)) };
  } catch (e) {
    return { ok: false, message: why(e) };
  }
}

/** Escolhe (ou troca) a conta. Só vale uma conta que o token alcança de verdade. */
export async function chooseGoogleAdsAccount(tenantId: string, userId: string | null, accountId: string): Promise<Result> {
  const opcoes = await googleAdsAccountOptions(tenantId);
  if (!opcoes.ok) return opcoes;
  const conta = opcoes.accounts.find((a) => a.id === accountId.replace(/-/g, ''));
  if (!conta) return { ok: false, message: 'O Google não deixou ler esta conta de anúncios.' };
  const { google } = await readSettings(tenantId);
  if (!google) return { ok: false, message: 'Conecte o Google Ads primeiro.' };
  await writeGoogle(tenantId, { ...google, customerId: conta.id, loginCustomerId: conta.loginCustomerId, accountName: conta.name, currency: conta.currency });
  await audit(tenantId, userId, 'GOOGLE_ADS_ACCOUNT_CHOSEN', { accountId: conta.id });
  return { ok: true };
}

/** Desliga: apaga o token e a conta. Nada do CRM é apagado. */
export async function disconnectGoogleAds(tenantId: string, userId: string | null): Promise<Result> {
  const { google } = await readSettings(tenantId);
  if (!google) return { ok: false, message: 'O Google Ads não está conectado.' };
  const refresh = refreshOf(tenantId, google);
  if (refresh) {
    forgetGoogleAccess(refresh);
    // Avisa o Google para retirar a autorização (sem esperar: se falhar, o token some daqui de qualquer jeito).
    void fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refresh }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  await writeGoogle(tenantId, null);
  await audit(tenantId, userId, 'GOOGLE_ADS_DISCONNECTED', { accountId: google.customerId });
  return { ok: true };
}
