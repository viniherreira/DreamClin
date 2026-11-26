'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { guardCrmAction } from '@/crm/guard';
import * as google from '@/crm/google-ads-account';
import type { GoogleAdsAccountOption } from '@/crm/google-ads-api';

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/** Só gestor troca a conta ou desconecta; depois de mudar, os números são buscados de novo. */
async function comoGestor(fn: (g: { tenantId: string; userId: string }) => Promise<Result>): Promise<Result> {
  const g = await guardCrmAction('crm_config');
  if (!g.ok) return g;
  const r = await fn(g);
  if (r.ok) {
    revalidateTag(google.googleAdsTag(g.tenantId));
    revalidatePath('/crm/whatsapp');
    revalidatePath('/crm/anuncios/google');
  }
  return r;
}

export const chooseGoogleAdsAccountAction = async (accountId: string): Promise<Result> =>
  comoGestor((g) => google.chooseGoogleAdsAccount(g.tenantId, g.userId, String(accountId ?? '')));

export const disconnectGoogleAdsAction = async (): Promise<Result> => comoGestor((g) => google.disconnectGoogleAds(g.tenantId, g.userId));

/** As contas que dá para escolher (para escolher ou "Trocar conta"). Só leitura. */
export async function listGoogleAdsAccountsAction(): Promise<Result<{ accounts: GoogleAdsAccountOption[] }>> {
  const g = await guardCrmAction('crm_config', { write: false });
  if (!g.ok) return g;
  return google.googleAdsAccountOptions(g.tenantId);
}

/** O botão "Atualizar" da aba Google: busca os números de novo. */
export async function refreshGoogleAdsAction(): Promise<Result> {
  const g = await guardCrmAction('crm', { write: false });
  if (!g.ok) return g;
  if (g.ownOnly) return { ok: false, message: 'Os números dos anúncios são da clínica inteira. Peça a um gestor.' };
  revalidateTag(google.googleAdsTag(g.tenantId));
  revalidatePath('/crm/anuncios/google');
  return { ok: true };
}
