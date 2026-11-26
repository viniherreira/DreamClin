import { NextResponse } from 'next/server';
import { guardCrmAction } from '@/crm/guard';
import { googleRedirectUri, signGoogleState } from '@/crm/google-ads-account';
import { googleAdsConfigured, googleAuthUrl } from '@/crm/google-ads-api';
import { googleAdsEnabled } from '@/lib/feature-flags';
import { siteUrl } from '@/lib/company';

export const dynamic = 'force-dynamic';

/** Abre a janela de login do Google para conectar o Google Ads (só gestor do CRM). */
export async function GET() {
  const voltar = (erro: string) => NextResponse.redirect(`${siteUrl()}/crm/whatsapp?google=${encodeURIComponent(erro)}#google-ads`);
  const g = await guardCrmAction('crm_config');
  if (!g.ok) return voltar('sem-acesso');
  if (!(await googleAdsEnabled(g.tenantId))) return voltar('indisponivel');
  if (!googleAdsConfigured()) return voltar('nao-configurado');
  return NextResponse.redirect(googleAuthUrl(signGoogleState(g.tenantId, g.userId), googleRedirectUri()));
}
