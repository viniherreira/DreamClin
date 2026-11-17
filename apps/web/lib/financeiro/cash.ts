/**
 * As contas do caixa: o que o sistema espera por meio de pagamento, a
 * conferência do fechamento (esperado × contado) e o resumo do relatório.
 * Tudo em centavos inteiros. Puro e testado em `cash.test.ts`.
 */

import type { TxKind } from './balance';

/** Os grupos da conferência. Cheque, boleto, transferência e convênio caem em "Outros". */
export const COUNT_GROUPS = ['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'OTHER'] as const;
export type CountGroup = (typeof COUNT_GROUPS)[number];

export const COUNT_GROUP_LABEL: Record<CountGroup, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  OTHER: 'Outros',
};

export type Counted = Record<CountGroup, number>;

export const ZERO_COUNT: Counted = { CASH: 0, PIX: 0, CREDIT_CARD: 0, DEBIT_CARD: 0, OTHER: 0 };

export const countGroupOf = (methodKind: string | null | undefined): CountGroup =>
  methodKind === 'CASH' || methodKind === 'PIX' || methodKind === 'CREDIT_CARD' || methodKind === 'DEBIT_CARD' ? methodKind : 'OTHER';

export interface CashMovement {
  kind: TxKind;
  methodKind: string | null;
  /** Efeito no saldo: positivo entra, negativo sai. */
  signedAmount: number;
}

/**
 * O que o sistema espera em cada meio. O dinheiro começa com o troco inicial e
 * soma reforços, sangrias, recebimentos, pagamentos e estornos em dinheiro. A
 * carteira do paciente não entra (não movimenta dinheiro: efeito zero).
 */
export function expectedCash(openingCents: number, movements: readonly CashMovement[]): Counted {
  const out: Counted = { ...ZERO_COUNT, CASH: openingCents };
  for (const m of movements) {
    if (m.methodKind === 'WALLET') continue;
    out[countGroupOf(m.methodKind)] += m.signedAmount;
  }
  return out;
}

export interface CountRow {
  group: CountGroup;
  expected: number;
  counted: number;
  /** Contado menos esperado: positivo sobrou, negativo faltou. */
  diff: number;
}

export function countRows(expected: Counted, counted: Counted): CountRow[] {
  return COUNT_GROUPS.map((group) => ({ group, expected: expected[group], counted: counted[group], diff: counted[group] - expected[group] }));
}

export type CloseCheck =
  | { ok: true; rows: CountRow[]; difference: number }
  | { ok: false; code: 'NEGATIVE_CASH' | 'INVALID' | 'NEEDS_JUSTIFICATION'; message: string; rows: CountRow[]; difference: number };

/**
 * Pode fechar? Não fecha com o dinheiro esperado negativo (saiu mais dinheiro
 * do que havia: falta lançar um reforço). Diferença pede justificativa.
 */
export function closeCheck(expected: Counted, counted: Counted, justification?: string | null): CloseCheck {
  const rows = countRows(expected, counted);
  const difference = rows.reduce((s, r) => s + r.diff, 0);
  if (COUNT_GROUPS.some((g) => !Number.isInteger(counted[g]) || counted[g] < 0)) return { ok: false, code: 'INVALID', message: 'Os valores contados não podem ser negativos.', rows, difference };
  if (expected.CASH < 0) return { ok: false, code: 'NEGATIVE_CASH', message: 'O dinheiro deste caixa está negativo: saiu mais do que entrou. Lance um reforço com o valor que faltou antes de fechar.', rows, difference };
  const comDiferenca = rows.some((r) => r.diff !== 0);
  if (comDiferenca && (justification?.trim().length ?? 0) < 5) return { ok: false, code: 'NEEDS_JUSTIFICATION', message: 'O contado não bate com o esperado. Escreva a justificativa da diferença.', rows, difference };
  return { ok: true, rows, difference };
}

export interface CashSummary {
  /** Recebimentos (todos os meios). */
  receipts: number;
  /** Pagamentos feitos pelo caixa. */
  payments: number;
  reinforcements: number;
  withdrawals: number;
  /** Estornos: efeito líquido (negativo quando devolveu dinheiro). */
  reversals: number;
}

/** O resumo do relatório do caixa: entradas, saídas, reforços, sangrias e estornos. */
export function cashSummary(movements: readonly CashMovement[]): CashSummary {
  const s: CashSummary = { receipts: 0, payments: 0, reinforcements: 0, withdrawals: 0, reversals: 0 };
  for (const m of movements) {
    if (m.methodKind === 'WALLET') continue;
    const v = Math.abs(m.signedAmount);
    if (m.kind === 'RECEIPT' || m.kind === 'TRANSFER_IN') s.receipts += v;
    else if (m.kind === 'PAYMENT' || m.kind === 'FEE' || m.kind === 'TRANSFER_OUT') s.payments += v;
    else if (m.kind === 'REINFORCEMENT') s.reinforcements += v;
    else if (m.kind === 'WITHDRAWAL') s.withdrawals += v;
    else s.reversals += m.signedAmount;
  }
  return s;
}

/** Caixa aberto há dias demais? `limitDays` 0 desliga o aviso. */
export const openTooLong = (daysOpen: number, limitDays: number): boolean => limitDays > 0 && daysOpen > limitDays;
