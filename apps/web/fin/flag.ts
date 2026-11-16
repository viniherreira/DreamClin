import 'server-only';

import { cache } from 'react';
import { prisma } from '@clinicaiq/db';

/**
 * A bandeira do financeiro completo.
 *
 * Novidade entra primeiro só na conta em cortesia do dono; `FINANCEIRO_COMPLETO=todos`
 * na Vercel libera para todas as clínicas. Com a bandeira desligada, a clínica
 * segue no financeiro antigo e nenhuma tabela nova é tocada.
 *
 * Clínica só com CRM (sem a Agenda) não tem financeiro.
 */
export const financeEnabled = cache(async (tenantId: string): Promise<boolean> => {
  const sub = await prisma.subscription
    .findUnique({ where: { tenantId }, select: { complimentary: true, clinicEnabled: true } })
    .catch(() => null);
  if (!sub) return false;
  if (sub.clinicEnabled === false && !sub.complimentary) return false;
  return sub.complimentary || process.env.FINANCEIRO_COMPLETO === 'todos';
});

/** Recursos do plano Profissional e Clínica (DRE, fluxo, conciliação, régua, rateio). */
export const financeAdvanced = cache(async (tenantId: string): Promise<boolean> => {
  const sub = await prisma.subscription
    .findUnique({ where: { tenantId }, select: { complimentary: true, plan: { select: { advancedReports: true } } } })
    .catch(() => null);
  return Boolean(sub?.complimentary || sub?.plan?.advancedReports);
});
