/**
 * A situação financeira de um agendamento, a partir dos itens e dos títulos
 * ligados a ele. Tudo em centavos inteiros. Puro e testado em `billing.test.ts`.
 */

export type BillingStatus = 'NONE' | 'TO_RECEIVE' | 'BILLED' | 'PARTIAL' | 'PAID' | 'NO_CHARGE';

export const BILLING_LABEL: Record<BillingStatus, string> = {
  NONE: 'Sem valor',
  TO_RECEIVE: 'A receber',
  BILLED: 'Faturado',
  PARTIAL: 'Pago em parte',
  PAID: 'Pago',
  NO_CHARGE: 'Não cobrar',
};

/** A cor do cifrão no card da agenda. */
export const BILLING_TONE: Record<BillingStatus, 'gray' | 'amber' | 'blue' | 'green'> = {
  NONE: 'gray',
  NO_CHARGE: 'gray',
  TO_RECEIVE: 'amber',
  BILLED: 'blue',
  PARTIAL: 'blue',
  PAID: 'green',
};

/** Falta dinheiro entrar: é o filtro "Só quem falta pagar". */
export const owesMoney = (s: BillingStatus | null | undefined): boolean => s === 'TO_RECEIVE' || s === 'BILLED' || s === 'PARTIAL';

export interface BillingItem {
  quantity: number;
  /** Preço unitário, em centavos. */
  unitPrice: number;
  /** Desconto do item, em centavos. */
  discount: number;
  /** Veio de orçamento aprovado: já está cobrado lá. */
  covered: boolean;
}

/** Total do item: quantidade × preço − desconto (nunca negativo). */
export const itemTotal = (i: Pick<BillingItem, 'quantity' | 'unitPrice' | 'discount'>): number => Math.max(0, i.quantity * i.unitPrice - i.discount);

export interface BillingTitle {
  status: 'OPEN' | 'PARTIAL' | 'PAID' | 'CANCELLED' | 'RENEGOTIATED';
  amount: number;
  paid: number;
}

export interface BillingInput {
  type: 'PARTICULAR' | 'CONVENIO' | 'CORTESIA';
  items: readonly BillingItem[];
  titles: readonly BillingTitle[];
  noCharge: boolean;
}

export interface Billing {
  status: BillingStatus;
  /** Soma de todos os itens (inclusive os cobertos por orçamento). */
  total: number;
  /** O que este agendamento cobra: fora cortesia e itens cobertos por orçamento. */
  chargeable: number;
  /** Já virou título (títulos vivos). */
  billed: number;
  /** Já recebido nesses títulos. */
  paid: number;
  /** Faturado e ainda não pago. */
  open: number;
  /** Ainda sem título. */
  unbilled: number;
}

/**
 * Cortesia não cobra nada. Item coberto por orçamento não gera cobrança nova.
 * Título cancelado não conta; renegociado conta como faturado (a dívida mudou
 * de lugar, não sumiu).
 */
export function billingOf(input: BillingInput): Billing {
  const total = input.items.reduce((s, i) => s + itemTotal(i), 0);
  const chargeable = input.type === 'CORTESIA' ? 0 : input.items.reduce((s, i) => s + (i.covered ? 0 : itemTotal(i)), 0);
  const vivos = input.titles.filter((t) => t.status !== 'CANCELLED');
  const billed = vivos.reduce((s, t) => s + t.amount, 0);
  const paid = vivos.reduce((s, t) => s + Math.min(t.paid, t.amount), 0);
  const open = Math.max(0, billed - paid);
  const unbilled = input.noCharge ? 0 : Math.max(0, chargeable - billed);

  let status: BillingStatus;
  if (billed === 0) status = input.noCharge ? 'NO_CHARGE' : chargeable === 0 ? 'NONE' : 'TO_RECEIVE';
  else if (open === 0 && unbilled === 0) status = 'PAID';
  else if (paid > 0) status = 'PARTIAL';
  else status = 'BILLED';

  return { status, total, chargeable, billed, paid, open, unbilled };
}

/** Situação de um agendamento que ainda não tem itens gravados: sai do preço do procedimento. */
export function billingFromProcedure(type: BillingInput['type'], priceCents: number | null | undefined): BillingStatus {
  return type === 'CORTESIA' || !priceCents || priceCents <= 0 ? 'NONE' : 'TO_RECEIVE';
}

export type StartRule = 'OFF' | 'BILLED' | 'PAID';

/**
 * "Bloquear o início do atendimento sem pagamento". Devolve a mensagem do
 * bloqueio, ou nulo quando pode começar.
 */
export function startBlocked(rule: StartRule, status: BillingStatus): string | null {
  if (rule === 'OFF' || status === 'NONE' || status === 'NO_CHARGE' || status === 'PAID') return null;
  if (rule === 'BILLED') return status === 'TO_RECEIVE' ? 'A clínica só começa o atendimento depois de faturar. Fature ou receba este agendamento primeiro.' : null;
  return 'A clínica só começa o atendimento depois do pagamento. Receba este agendamento primeiro.';
}
