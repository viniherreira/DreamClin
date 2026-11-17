import 'server-only';

import { getTenantClient, prisma } from '@clinicaiq/db';
import { financeEnabled } from './flag';
import { runCollectionsForTenant } from './collection';
import { extendRecurrences } from './titles';
import { clinicToday } from '@/lib/tz';
import type { Day } from '@/lib/financeiro/dates';

/**
 * A rotina diária do financeiro. Pega carona no cron de lembretes (a Vercel no
 * plano Hobby só deixa dois crons, e os dois já estão em uso).
 *
 * Hoje: estica os lançamentos recorrentes, para sempre haver 12 meses gerados.
 * Só olha clínica com regra ativa e com o financeiro novo ligado. A falha de
 * uma clínica não para as outras.
 */
export async function runFinanceRoutine(): Promise<{ tenants: number; recurrences: number; failed: number; collections: { sent: number; skipped: number; failed: number } }> {
  const comRegra = await prisma.recurrenceRule.findMany({ where: { active: true }, select: { tenantId: true }, distinct: ['tenantId'] });
  let recurrences = 0;
  let failed = 0;
  let tenants = 0;
  for (const { tenantId } of comRegra) {
    if (!(await financeEnabled(tenantId))) continue;
    tenants += 1;
    try {
      recurrences += await extendRecurrences(getTenantClient(tenantId), tenantId);
    } catch (e) {
      failed += 1;
      console.error('[financeiro] rotina diária falhou', { tenantId, message: e instanceof Error ? e.message : 'erro desconhecido' });
    }
  }
  // Régua de cobrança: só quem tem o WhatsApp oficial conectado (sem ele, nada sai).
  const collections = { sent: 0, skipped: 0, failed: 0 };
  const hoje = clinicToday() as Day;
  const comWhatsapp = await prisma.whatsAppCloudAccount.findMany({ where: { active: true, status: 'CONNECTED' }, select: { tenantId: true } });
  for (const { tenantId } of comWhatsapp) {
    if (!(await financeEnabled(tenantId))) continue;
    try {
      const r = await runCollectionsForTenant(tenantId, hoje);
      collections.sent += r.sent;
      collections.skipped += r.skipped;
      collections.failed += r.failed;
    } catch (e) {
      failed += 1;
      console.error('[financeiro] régua de cobrança falhou', { tenantId, message: e instanceof Error ? e.message : 'erro desconhecido' });
    }
  }
  return { tenants, recurrences, failed, collections };
}
