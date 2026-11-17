import 'server-only';

import type { TenantPrismaClient } from '@clinicaiq/db';
import { billingOf, type Billing } from '@/lib/financeiro/billing';
import { toCents } from '@/lib/financeiro/money';
import type { Tx } from './titles';

/**
 * A situação financeira do agendamento, guardada em `Appointment.billingStatus`
 * para a agenda e a tela "A faturar" filtrarem rápido. Ela é recalculada aqui
 * toda vez que os itens ou os títulos do agendamento mudam (faturar, receber,
 * estornar, cancelar). Este arquivo não importa o resto do motor, para que a
 * baixa e o estorno possam chamá-lo sem dar a volta.
 */

type Db = Tx | TenantPrismaClient;

/** Agendamento sem itens gravados (criado antes dos itens, pelo site ou pelo CRM): nasce um item do procedimento. */
export async function ensureItemsTx(db: Db, tenantId: string, appointmentId: string): Promise<void> {
  const a = await db.appointment.findFirst({ where: { tenantId, id: appointmentId }, select: { procedureId: true, _count: { select: { items: true } } } });
  if (!a || a._count.items > 0 || !a.procedureId) return;
  const p = await db.procedure.findFirst({ where: { tenantId, id: a.procedureId }, select: { id: true, name: true, basePrice: true } });
  if (!p) return;
  await db.appointmentItem.create({ data: { tenantId, appointmentId, procedureId: p.id, name: p.name, quantity: 1, unitPrice: p.basePrice, discount: 0, total: p.basePrice, order: 0 } });
}

export async function billingFor(db: Db, tenantId: string, appointmentId: string): Promise<Billing | null> {
  const a = await db.appointment.findFirst({
    where: { tenantId, id: appointmentId },
    select: { type: true, noChargeAt: true, items: { select: { quantity: true, unitPrice: true, discount: true, quoteItemId: true } } },
  });
  if (!a) return null;
  const titulos = await db.financialTitle.findMany({ where: { tenantId, appointmentId }, select: { status: true, amount: true, paidAmount: true } });
  return billingOf({
    type: a.type,
    noCharge: Boolean(a.noChargeAt),
    items: a.items.map((i) => ({ quantity: i.quantity, unitPrice: toCents(i.unitPrice), discount: toCents(i.discount), covered: Boolean(i.quoteItemId) })),
    titles: titulos.map((t) => ({ status: t.status, amount: toCents(t.amount), paid: toCents(t.paidAmount) })),
  });
}

/** Recalcula e grava a situação. Devolve as contas, ou nulo se o agendamento não existe. */
export async function refreshBillingTx(db: Db, tenantId: string, appointmentId: string): Promise<Billing | null> {
  await ensureItemsTx(db, tenantId, appointmentId);
  const b = await billingFor(db, tenantId, appointmentId);
  if (!b) return null;
  await db.appointment.updateMany({ where: { tenantId, id: appointmentId }, data: { billingStatus: b.status } });
  return b;
}

/** Depois de mexer em títulos: recalcula os agendamentos ligados a eles. */
export async function refreshBillingOfTitlesTx(db: Db, tenantId: string, titleIds: readonly string[]): Promise<void> {
  if (!titleIds.length) return;
  const ligados = await db.financialTitle.findMany({ where: { tenantId, id: { in: [...titleIds] }, appointmentId: { not: null } }, select: { appointmentId: true } });
  for (const id of new Set(ligados.map((t) => t.appointmentId!))) await refreshBillingTx(db, tenantId, id);
}

