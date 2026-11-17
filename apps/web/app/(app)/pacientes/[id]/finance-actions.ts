'use server';

import { finRead } from '@/fin/guard';
import { ensureLegacyMigrated } from '@/fin/quotes';
import { ensureFinanceSetup } from '@/fin/setup';
import { dateToDay, type Day } from '@/lib/financeiro/dates';
import { toCents } from '@/lib/financeiro/money';
import { displayStatus, type TitleDisplay } from '@/lib/financeiro/title-status';
import { ORIGIN_LABEL } from '@/lib/financeiro/defaults';
import { clinicToday } from '@/lib/tz';

/**
 * A aba Financeiro da ficha do paciente, no financeiro completo: as contas
 * dele (abertas, vencidas, pagas), os pagamentos, o saldo da carteira e os
 * totais do topo (devendo, vencido, pago no ano).
 */

export interface PatientFinance {
  owingCents: number;
  overdueCents: number;
  paidThisYearCents: number;
  walletCents: number;
  titles: { id: string; code: number; dueDate: Day; description: string; origin: string; originHref: string | null; amountCents: number; openCents: number; display: TitleDisplay; installment: string | null }[];
  payments: { id: string; code: number; paidOn: Day; method: string; amountCents: number; receiptGroupId: string | null; reversed: boolean; isReversal: boolean }[];
  can: { receive: boolean; reverse: boolean };
}

export async function patientFinance(patientId: string): Promise<PatientFinance | null> {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return null;
  const { ctx } = gate;
  const { db } = ctx;
  await ensureFinanceSetup(ctx.tenantId);
  await ensureLegacyMigrated(ctx.tenantId);
  const p = await db.patient.findFirst({ where: { id: patientId }, select: { id: true } });
  if (!p) return null;
  const hoje = clinicToday() as Day;
  const ano = `${hoje.slice(0, 4)}-01-01`;

  const [titulos, carteira, movimentos] = await Promise.all([
    db.financialTitle.findMany({
      where: { patientId, direction: 'RECEIVABLE', status: { not: 'CANCELLED' } },
      orderBy: [{ dueDate: 'desc' }, { code: 'desc' }],
      take: 200,
      select: { id: true, code: true, dueDate: true, description: true, origin: true, appointmentId: true, quoteId: true, amount: true, paidAmount: true, status: true, installmentNumber: true, installmentTotal: true },
    }),
    db.walletEntry.aggregate({ where: { patientId }, _sum: { amount: true } }),
    db.financialTransaction.findMany({
      where: { patientId, kind: { in: ['RECEIPT', 'REVERSAL'] } },
      orderBy: [{ paidOn: 'desc' }, { code: 'desc' }],
      take: 100,
      select: { id: true, code: true, kind: true, paidOn: true, amount: true, principal: true, methodId: true, receiptGroupId: true, reversedAt: true },
    }),
  ]);
  const formas = new Map((await db.finPaymentMethod.findMany({ where: { id: { in: [...new Set(movimentos.map((m) => m.methodId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } })).map((f) => [f.id, f.name]));

  let owing = 0;
  let overdue = 0;
  const titles = titulos.map((t) => {
    const due = dateToDay(t.dueDate);
    const open = t.status === 'OPEN' || t.status === 'PARTIAL' ? Math.max(0, toCents(t.amount) - toCents(t.paidAmount)) : 0;
    const display = displayStatus(t.status, due, hoje);
    owing += open;
    if (display === 'OVERDUE') overdue += open;
    return {
      id: t.id,
      code: t.code,
      dueDate: due,
      description: t.description ?? ORIGIN_LABEL[t.origin as keyof typeof ORIGIN_LABEL] ?? '',
      origin: ORIGIN_LABEL[t.origin as keyof typeof ORIGIN_LABEL] ?? '',
      originHref: t.quoteId ? `/orcamentos/${t.quoteId}` : null,
      amountCents: toCents(t.amount),
      openCents: open,
      display,
      installment: t.installmentTotal > 1 ? `${t.installmentNumber}/${t.installmentTotal}` : null,
    };
  });
  const paidThisYear = movimentos.filter((m) => dateToDay(m.paidOn) >= ano).reduce((s, m) => s + (m.kind === 'REVERSAL' ? -toCents(m.principal) : toCents(m.principal)), 0);

  return {
    owingCents: owing,
    overdueCents: overdue,
    paidThisYearCents: Math.max(0, paidThisYear),
    walletCents: toCents(carteira._sum.amount),
    titles,
    payments: movimentos.map((m) => ({
      id: m.id,
      code: m.code,
      paidOn: dateToDay(m.paidOn),
      method: m.methodId ? (formas.get(m.methodId) ?? '') : '',
      amountCents: toCents(m.amount),
      receiptGroupId: m.receiptGroupId,
      reversed: Boolean(m.reversedAt),
      isReversal: m.kind === 'REVERSAL',
    })),
    can: { receive: ctx.can('fin_receber'), reverse: ctx.can('fin_estornar') },
  };
}
