import 'server-only';

import { cache } from 'react';
import { prisma } from '@clinicaiq/db';

/**
 * Bandeira do paciente e da agenda novos (spec 2026-11-18).
 *
 * Como o financeiro: novidade aparece primeiro só na conta em cortesia do dono;
 * `PACIENTE_AGENDA=todos` na Vercel libera para todas as clínicas. Desligada, a
 * clínica segue nas telas antigas, e as colunas novas (todas opcionais) ficam
 * sem uso.
 */
export const pacienteAgendaEnabled = cache(async (tenantId: string): Promise<boolean> => {
  if (process.env.PACIENTE_AGENDA === 'todos') return true;
  const sub = await prisma.subscription
    .findUnique({ where: { tenantId }, select: { complimentary: true } })
    .catch(() => null);
  return Boolean(sub?.complimentary);
});

/**
 * Bandeira do Google Ads (conexão em Canais e a aba Google em Anúncios).
 * Primeiro só na conta em cortesia do dono; `GOOGLE_ADS=todos` na Vercel
 * libera para todas as clínicas.
 */
export const googleAdsEnabled = cache(async (tenantId: string): Promise<boolean> => {
  if (process.env.GOOGLE_ADS === 'todos') return true;
  const sub = await prisma.subscription
    .findUnique({ where: { tenantId }, select: { complimentary: true } })
    .catch(() => null);
  return Boolean(sub?.complimentary);
});

