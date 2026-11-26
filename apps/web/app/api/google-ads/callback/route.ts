import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { guardCrmAction } from '@/crm/guard';
import { finishGoogleConnection, googleAdsTag, verifyGoogleState } from '@/crm/google-ads-account';
import { siteUrl } from '@/lib/company';

export const dynamic = 'force-dynamic';

/**
 * Volta da janela do Google. Só aceita o `state` assinado para esta clínica e
 * esta pessoa, dentro de 15 minutos: sem isso, alguém poderia ligar a conta
 * de anúncios dele na clínica de outro.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const voltar = (resultado: string) => NextResponse.redirect(`${siteUrl()}/crm/whatsapp?google=${encodeURIComponent(resultado)}#google-ads`);

  const g = await guardCrmAction('crm_config');
  if (!g.ok) return voltar('sem-acesso');
  const state = url.searchParams.get('state') ?? '';
  if (!verifyGoogleState(state, g.tenantId, g.userId)) return voltar('expirou');
  // A pessoa fechou ou recusou a janela do Google.
  if (url.searchParams.get('error')) return voltar('cancelado');

  const r = await finishGoogleConnection(g.tenantId, g.userId, url.searchParams.get('code') ?? '');
  if (!r.ok) return NextResponse.redirect(`${siteUrl()}/crm/whatsapp?google=erro&motivo=${encodeURIComponent(r.message.slice(0, 200))}#google-ads`);
  revalidateTag(googleAdsTag(g.tenantId));
  revalidatePath('/crm/whatsapp');
  revalidatePath('/crm/anuncios/google');
  return voltar(r.chosen ? 'conectado' : 'escolher');
}
