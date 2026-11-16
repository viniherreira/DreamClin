import { addDays, addMonths, nextDayOfMonth, type Day } from './dates';
import { splitInstallments } from './installments';
import { percentOf } from './money';

/**
 * Cartão: taxa por faixa de parcelas, valor líquido e data de compensação de
 * cada parcela. Puro e testado em `card.test.ts`.
 */

export interface FeeTier {
  /** A faixa vale até este número de parcelas (inclusive). */
  upToInstallments: number;
  percent?: number | null;
  /** Taxa fixa em centavos, por parcela. */
  fixedCents?: number | null;
}

/** A faixa de taxa para um número de parcelas: a menor faixa que o alcança. */
export function feeTierFor(tiers: readonly FeeTier[], installments: number): FeeTier | null {
  const ordenadas = [...tiers].sort((a, b) => a.upToInstallments - b.upToInstallments);
  return ordenadas.find((t) => installments <= t.upToInstallments) ?? ordenadas[ordenadas.length - 1] ?? null;
}

export type SettlementRule =
  | { type: 'SAME_DAY' }
  /** D+N: a primeira parcela cai N dias depois; as outras, a cada N dias. */
  | { type: 'DAYS'; days: number }
  /** Dia fixo do mês: a primeira no próximo dia fixo; as outras, mês a mês. */
  | { type: 'DAY_OF_MONTH'; day: number };

export function settlementRule(type: string | null | undefined, value: number | null | undefined): SettlementRule {
  if (type === 'DAYS' && value && value > 0) return { type: 'DAYS', days: Math.floor(value) };
  if (type === 'DAY_OF_MONTH' && value && value >= 1 && value <= 31) return { type: 'DAY_OF_MONTH', day: Math.floor(value) };
  return { type: 'SAME_DAY' };
}

/** Quando a parcela `index` (0 = primeira) cai na conta. */
export function settlementDate(paidOn: Day, rule: SettlementRule, index = 0): Day {
  if (rule.type === 'DAYS') return addDays(paidOn, rule.days * (index + 1));
  if (rule.type === 'DAY_OF_MONTH') return addMonths(nextDayOfMonth(paidOn, rule.day), index);
  return paidOn;
}

export interface ReceivableLine {
  number: number;
  total: number;
  gross: number;
  fee: number;
  net: number;
  expectedDate: Day;
}

/**
 * As parcelas a compensar de um recebimento no cartão. A taxa em % é calculada
 * sobre o total e repartida; a sobra de centavos (do valor e da taxa) vai para
 * a última parcela, então as somas batem com o total ao centavo.
 */
export function cardReceivables(amountCents: number, installments: number, tiers: readonly FeeTier[], paidOn: Day, rule: SettlementRule): ReceivableLine[] {
  const n = Math.max(1, Math.floor(installments));
  const brutos = splitInstallments(amountCents, n);
  const faixa = feeTierFor(tiers, n);
  const taxaTotal = faixa ? (faixa.percent ? percentOf(amountCents, faixa.percent) : 0) + (faixa.fixedCents ? faixa.fixedCents * n : 0) : 0;
  const taxas = splitInstallments(Math.min(taxaTotal, amountCents), n);
  return brutos.map((gross, i) => ({
    number: i + 1,
    total: n,
    gross,
    fee: taxas[i],
    net: gross - taxas[i],
    expectedDate: settlementDate(paidOn, rule, i),
  }));
}

export const totalFee = (lines: readonly ReceivableLine[]): number => lines.reduce((s, l) => s + l.fee, 0);
export const totalNet = (lines: readonly ReceivableLine[]): number => lines.reduce((s, l) => s + l.net, 0);
