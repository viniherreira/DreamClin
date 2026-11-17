/**
 * As contas da comissão: qual regra vale (exceção do profissional no
 * procedimento, exceção do profissional, % do cadastro do profissional ou o
 * padrão da clínica), a base (tabela ou cobrado, menos o custo) e o valor.
 * Centavos inteiros. Puro e testado em `commission.test.ts`.
 */

import { percentOf } from './money';
import type { CommissionDefault } from './settings';

export interface CommissionRule {
  mode: 'PERCENT' | 'FIXED';
  /** % (PERCENT) ou centavos por unidade (FIXED). */
  value: number;
  label: string;
}

export interface ExceptionLike {
  procedureId: string | null;
  mode: 'PERCENT' | 'FIXED';
  /** % ou reais. */
  value: number;
}

const pct = (v: number) => `${String(v).replace('.', ',')}%`;
const reais = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function rule(mode: 'PERCENT' | 'FIXED', value: number, origem: string): CommissionRule {
  const v = mode === 'FIXED' ? Math.round(value * 100) : value;
  return { mode, value: v, label: `${mode === 'PERCENT' ? pct(value) : `${reais(v)} por unidade`} ${origem}` };
}

/** A regra de um item: a mais específica ganha. */
export function ruleFor(input: {
  procedureId: string | null;
  exceptions: readonly ExceptionLike[];
  /** % do cadastro do profissional (a comissão de antes do financeiro novo). */
  professionalPercent: number | null;
  clinicDefault: CommissionDefault;
}): CommissionRule {
  const doProcedimento = input.procedureId ? input.exceptions.find((e) => e.procedureId === input.procedureId) : undefined;
  if (doProcedimento) return rule(doProcedimento.mode, doProcedimento.value, 'da exceção do profissional neste procedimento');
  const geral = input.exceptions.find((e) => !e.procedureId);
  if (geral) return rule(geral.mode, geral.value, 'da exceção do profissional');
  if (input.professionalPercent != null && input.professionalPercent > 0) return rule('PERCENT', input.professionalPercent, 'do cadastro do profissional');
  return rule(input.clinicDefault.mode, input.clinicDefault.value, 'da regra da clínica');
}

export interface ItemBaseInput {
  quantity: number;
  /** Total cobrado do item (já com desconto), em centavos. */
  chargedCents: number;
  /** Preço de tabela do procedimento, por unidade. */
  tablePriceCents: number | null;
  /** Custo de material do procedimento, por unidade. */
  costCents: number | null;
}

/** A base da comissão de um item. Nunca negativa. */
export function baseFor(item: ItemBaseInput, opts: { base: 'CHARGED' | 'TABLE'; deductCost: boolean }): number {
  const bruto = opts.base === 'TABLE' && item.tablePriceCents != null ? item.tablePriceCents * item.quantity : item.chargedCents;
  const custo = opts.deductCost && item.costCents ? item.costCents * item.quantity : 0;
  return Math.max(0, bruto - custo);
}

/** O valor da comissão: % da base, ou o fixo vezes a quantidade (sem passar da base quando há base). */
export function commissionAmount(baseCents: number, quantity: number, r: CommissionRule): number {
  if (r.value <= 0) return 0;
  if (r.mode === 'PERCENT') return percentOf(baseCents, r.value);
  return r.value * Math.max(1, quantity);
}

/**
 * A parte de uma comissão que corresponde a um recebimento. Conta pelo
 * acumulado: o que já devia ter nascido até aqui (comissão × recebido até agora
 * ÷ total) menos o que já nasceu. Assim os centavos fecham quando o paciente
 * termina de pagar, e um recebimento parcial nunca passa do total.
 */
export function proportional(fullCents: number, cumulativeReceivedCents: number, totalCents: number, alreadyCents = 0): number {
  if (totalCents <= 0 || fullCents <= 0 || cumulativeReceivedCents <= 0) return 0;
  const recebido = Math.min(cumulativeReceivedCents, totalCents);
  const devido = recebido >= totalCents ? fullCents : Math.floor((fullCents * recebido) / totalCents);
  return Math.max(0, devido - alreadyCents);
}

export type CommissionDisplay = 'PENDING' | 'APPROVED' | 'BILLED' | 'PAID' | 'REVERSED';

export const COMMISSION_STATUS_LABEL: Record<CommissionDisplay, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  BILLED: 'Faturada',
  PAID: 'Paga',
  REVERSED: 'Estornada',
};

/** A situação para a tela: paga quando a conta a pagar gerada foi paga. */
export function commissionDisplay(status: string, payableTitleStatus: string | null): CommissionDisplay {
  if (status === 'REVERSED') return 'REVERSED';
  if (payableTitleStatus === 'PAID') return 'PAID';
  if (payableTitleStatus && payableTitleStatus !== 'CANCELLED') return 'BILLED';
  return status === 'APPROVED' ? 'APPROVED' : 'PENDING';
}
