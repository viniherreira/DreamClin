/**
 * As contas da renegociação: o valor corrigido de cada conta vencida (multa
 * e juros até hoje), o total, o desconto, a entrada e as parcelas novas com os
 * juros do parcelamento. Centavos inteiros. Puro e testado em `renegotiation.test.ts`.
 */

import { addDays, addMonths, type Day } from './dates';
import { financedInstallments, lateCharges, type LateRule } from './interest';

export interface OldTitle {
  id: string;
  openCents: number;
  dueDate: Day;
}

export interface CorrectedTitle extends OldTitle {
  daysLate: number;
  fine: number;
  interest: number;
  corrected: number;
}

/** Valor corrigido de cada conta: em aberto + multa + juros ao dia até hoje (se a clínica cobra). */
export function correctTitles(titles: readonly OldTitle[], today: Day, rule: LateRule | null): CorrectedTitle[] {
  return titles.map((t) => {
    const c = rule ? lateCharges(t.openCents, t.dueDate, today, rule) : { daysLate: 0, fine: 0, interest: 0, total: t.openCents };
    return { ...t, daysLate: c.daysLate, fine: c.fine, interest: c.interest, corrected: c.total };
  });
}

export interface PlanInput {
  correctedTotal: number;
  discount: number;
  downPayment: number;
  installments: number;
  monthlyInterestPercent: number;
  mode: 'SIMPLE' | 'PRICE';
  firstDueDate: Day;
  interval: { kind: 'monthly' } | { kind: 'days'; days: number };
}

export interface PlanLine {
  number: number;
  dueDate: Day;
  amount: number;
}

export type Plan =
  | { ok: true; financed: number; total: number; interest: number; lines: PlanLine[] }
  | { ok: false; message: string };

export const MAX_RENEGOTIATION_INSTALLMENTS = 60;

/**
 * As parcelas novas. A entrada sai do total; o resto é parcelado com os juros
 * do parcelamento (simples ou Price). Os centavos vão para a última parcela.
 */
export function planRenegotiation(p: PlanInput): Plan {
  if (!Number.isInteger(p.correctedTotal) || p.correctedTotal <= 0) return { ok: false, message: 'Escolha as contas a renegociar.' };
  if (!Number.isInteger(p.discount) || p.discount < 0 || p.discount >= p.correctedTotal) return { ok: false, message: 'O desconto precisa ser menor que o total.' };
  const liquido = p.correctedTotal - p.discount;
  if (!Number.isInteger(p.downPayment) || p.downPayment < 0 || p.downPayment > liquido) return { ok: false, message: 'A entrada não pode passar do total com desconto.' };
  const financiado = liquido - p.downPayment;
  if (financiado === 0) return { ok: true, financed: 0, total: liquido, interest: 0, lines: [] };
  if (!Number.isInteger(p.installments) || p.installments < 1 || p.installments > MAX_RENEGOTIATION_INSTALLMENTS) return { ok: false, message: `O parcelamento vai de 1 a ${MAX_RENEGOTIATION_INSTALLMENTS} parcelas.` };
  if (p.monthlyInterestPercent < 0 || p.monthlyInterestPercent > 20) return { ok: false, message: 'Os juros vão de 0% a 20% ao mês.' };
  const valores = financedInstallments(financiado, p.installments, p.monthlyInterestPercent, p.mode);
  const lines = valores.map((amount, i) => ({
    number: i + 1,
    dueDate: p.interval.kind === 'monthly' ? addMonths(p.firstDueDate, i) : addDays(p.firstDueDate, i * p.interval.days),
    amount,
  }));
  const somaParcelas = valores.reduce((s, v) => s + v, 0);
  return { ok: true, financed: financiado, total: p.downPayment + somaParcelas, interest: somaParcelas - financiado, lines };
}
