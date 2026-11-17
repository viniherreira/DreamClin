import { addDays, addMonths, addYears, type Day } from './dates';

/**
 * Parcelamento e recorrência. Puro e testado em `installments.test.ts`.
 */

/**
 * Divide um valor em parcelas iguais; os centavos que sobram vão para a última.
 * R$ 1.000,00 em 3x → 333,33 + 333,33 + 333,34.
 */
export function splitInstallments(totalCents: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const total = Math.max(0, Math.round(totalCents));
  const base = Math.floor(total / n);
  const out = Array.from({ length: n }, () => base);
  out[n - 1] = total - base * (n - 1);
  return out;
}

export type InstallmentInterval = { kind: 'monthly' } | { kind: 'days'; days: number };

export interface InstallmentLine {
  number: number;
  total: number;
  dueDate: Day;
  amount: number;
}

/** A tabela da simulação: número, vencimento e valor de cada parcela. */
export function simulateInstallments(totalCents: number, count: number, firstDue: Day, interval: InstallmentInterval = { kind: 'monthly' }): InstallmentLine[] {
  const valores = splitInstallments(totalCents, count);
  return valores.map((amount, i) => ({
    number: i + 1,
    total: valores.length,
    amount,
    dueDate: interval.kind === 'monthly' ? addMonths(firstDue, i) : addDays(firstDue, Math.max(1, Math.floor(interval.days)) * i),
  }));
}

export type RecurrenceUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export interface RecurrenceSpec {
  every: number;
  unit: RecurrenceUnit;
  start: Day;
  /** Termina nesta data (inclusive)… */
  end?: Day | null;
  /** …ou depois de N vezes. */
  occurrences?: number | null;
}

/** Teto de segurança: nenhuma recorrência gera mais do que isto de uma vez. */
export const MAX_RECURRENCE_DATES = 240;

/** A data da ocorrência de número `index` (0 = a primeira). */
export function recurrenceDate(spec: RecurrenceSpec, index: number): Day {
  const passo = Math.max(1, Math.floor(spec.every)) * index;
  switch (spec.unit) {
    case 'DAY':
      return addDays(spec.start, passo);
    case 'WEEK':
      return addDays(spec.start, passo * 7);
    case 'YEAR':
      return addYears(spec.start, passo);
    default:
      return addMonths(spec.start, passo);
  }
}

/**
 * As datas de um lançamento recorrente até `horizon` (inclusive), respeitando
 * o fim por data ou por número de vezes. `after` pula o que já foi gerado.
 */
export function recurrenceDates(spec: RecurrenceSpec, horizon: Day, after?: Day | null): Day[] {
  const out: Day[] = [];
  const limite = spec.occurrences && spec.occurrences > 0 ? Math.min(spec.occurrences, MAX_RECURRENCE_DATES) : MAX_RECURRENCE_DATES;
  for (let i = 0; i < limite; i++) {
    const dia = recurrenceDate(spec, i);
    if (dia > horizon) break;
    if (spec.end && dia > spec.end) break;
    if (after && dia <= after) continue;
    out.push(dia);
  }
  return out;
}
