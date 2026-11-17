/**
 * Saldos. Nenhum é gravado: saem sempre da soma das linhas, para nunca
 * discordarem do extrato. Puro e testado em `balance.test.ts`.
 */

export type TxKind = 'RECEIPT' | 'PAYMENT' | 'REINFORCEMENT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'REVERSAL' | 'FEE';

/** Entra (+1) ou sai (−1) da conta. O estorno herda o contrário do original. */
export const KIND_SIGN: Record<Exclude<TxKind, 'REVERSAL'>, 1 | -1> = {
  RECEIPT: 1,
  REINFORCEMENT: 1,
  TRANSFER_IN: 1,
  PAYMENT: -1,
  WITHDRAWAL: -1,
  TRANSFER_OUT: -1,
  FEE: -1,
};

/**
 * O efeito de um movimento no saldo da conta (`signedAmount`).
 * A carteira do paciente não movimenta conta: efeito zero.
 */
export function signedAmount(kind: Exclude<TxKind, 'REVERSAL'>, amountCents: number, viaWallet = false): number {
  return viaWallet ? 0 : KIND_SIGN[kind] * Math.abs(amountCents);
}

/** Saldo da conta = saldo inicial + soma dos efeitos dos movimentos. */
export const accountBalance = (openingCents: number, signedSumCents: number): number => openingCents + signedSumCents;

/** Saldo da carteira = soma das linhas (crédito positivo, uso negativo). */
export const walletBalance = (entries: readonly number[]): number => entries.reduce((s, v) => s + v, 0);

export interface CashLine {
  /** Dinheiro, PIX, cartão… */
  methodKind: string | null;
  signedAmount: number;
}

/** O esperado do caixa por meio (dinheiro inclui o troco inicial, reforços e sangrias). */
export function expectedByMethod(lines: readonly CashLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    const k = l.methodKind ?? 'OTHER';
    out.set(k, (out.get(k) ?? 0) + l.signedAmount);
  }
  return out;
}
