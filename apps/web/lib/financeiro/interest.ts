import { daysBetween, type Day } from './dates';
import { percentOf } from './money';

/**
 * Juros e multa de título vencido. Multa: uma vez, em % do valor em aberto.
 * Juros: simples, % ao dia sobre o valor em aberto, pelos dias de atraso.
 * Puro e testado em `interest.test.ts`.
 */

export interface LateRule {
  /** Multa em %, cobrada uma vez. */
  finePercent: number;
  /** Juros em % ao dia. */
  dailyInterestPercent: number;
}

export interface LateCharges {
  daysLate: number;
  fine: number;
  interest: number;
  /** Em aberto + multa + juros. */
  total: number;
}

export function lateCharges(openCents: number, dueDate: Day, today: Day, rule: LateRule): LateCharges {
  const aberto = Math.max(0, Math.round(openCents));
  const dias = Math.max(0, daysBetween(dueDate, today));
  if (dias === 0 || aberto === 0) return { daysLate: dias, fine: 0, interest: 0, total: aberto };
  const fine = rule.finePercent > 0 ? percentOf(aberto, rule.finePercent) : 0;
  // Juros simples: a taxa do período inteiro aplicada uma vez, para arredondar só no fim.
  const interest = rule.dailyInterestPercent > 0 ? percentOf(aberto, rule.dailyInterestPercent * dias) : 0;
  return { daysLate: dias, fine, interest, total: aberto + fine + interest };
}

/**
 * Parcelas com juros ao mês (renegociação).
 * - SIMPLE: juros simples sobre o saldo, pelo número de meses, dividido igual.
 * - PRICE: parcela fixa da tabela Price.
 * Os centavos que sobram vão para a última parcela.
 */
export function financedInstallments(principalCents: number, count: number, monthlyPercent: number, mode: 'SIMPLE' | 'PRICE'): number[] {
  const n = Math.max(1, Math.floor(count));
  const pv = Math.max(0, Math.round(principalCents));
  if (monthlyPercent <= 0 || pv === 0) {
    const base = Math.floor(pv / n);
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? pv - base * (n - 1) : base));
  }
  if (mode === 'SIMPLE') {
    const total = pv + percentOf(pv, monthlyPercent * n);
    const base = Math.floor(total / n);
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * (n - 1) : base));
  }
  const i = monthlyPercent / 100;
  const parcela = Math.round((pv * i) / (1 - Math.pow(1 + i, -n)));
  return Array.from({ length: n }, () => parcela);
}
