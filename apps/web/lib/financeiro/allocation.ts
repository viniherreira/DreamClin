import { percentOf } from './money';

/**
 * Rateio de um título entre categorias e centros de custo. A soma das partes
 * tem de bater com o valor do título. Puro e testado em `allocation.test.ts`.
 */

export interface AllocationPart {
  categoryId: string;
  costCenterId?: string | null;
  amount: number;
}

export type AllocationCheck = { ok: true } | { ok: false; difference: number; message: string };

/** Confere o rateio. Sem partes, vale a categoria do próprio título. */
export function checkAllocation(totalCents: number, parts: readonly AllocationPart[]): AllocationCheck {
  if (parts.length === 0) return { ok: true };
  if (parts.some((p) => p.amount <= 0)) return { ok: false, difference: 0, message: 'Cada parte do rateio precisa de um valor maior que zero.' };
  const soma = parts.reduce((s, p) => s + p.amount, 0);
  const difference = totalCents - soma;
  if (difference === 0) return { ok: true };
  const reais = (Math.abs(difference) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return { ok: false, difference, message: difference > 0 ? `Faltam ${reais} para o rateio fechar com o valor.` : `O rateio passa ${reais} do valor.` };
}

/** Divide um valor por porcentagens; a sobra de centavos vai para a última parte. */
export function allocateByPercent(totalCents: number, percents: readonly number[]): number[] {
  if (percents.length === 0) return [];
  const out = percents.map((p) => percentOf(totalCents, p));
  out[out.length - 1] = totalCents - out.slice(0, -1).reduce((s, v) => s + v, 0);
  return out;
}

/**
 * Reparte um valor na proporção de outros (ex.: o que foi recebido entre os
 * itens, para a comissão proporcional). A soma devolvida é exatamente `amount`.
 */
export function prorate(amountCents: number, weights: readonly number[]): number[] {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (weights.length === 0) return [];
  if (total <= 0) return weights.map(() => 0);
  let resto = amountCents;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return resto;
    const parte = Math.floor((amountCents * Math.max(0, w)) / total);
    resto -= parte;
    return parte;
  });
}
