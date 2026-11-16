import type { Day } from './dates';

/**
 * Situação de um título. "Vencido" não é gravado: é um título em aberto (ou
 * pago em parte) com vencimento no passado, calculado na hora.
 * Puro e testado em `title-status.test.ts`.
 */

export type TitleStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'CANCELLED' | 'RENEGOTIATED';
export type TitleDisplay = TitleStatus | 'OVERDUE';

/** Quanto falta quitar. */
export const openCents = (amountCents: number, paidCents: number): number => Math.max(0, amountCents - paidCents);

/**
 * A situação que deve ficar gravada depois de uma baixa ou de um estorno.
 * CANCELADO e RENEGOCIADO não mudam por aqui: saem só pela ação própria.
 */
export function settledStatus(amountCents: number, paidCents: number, current: TitleStatus = 'OPEN'): TitleStatus {
  if (current === 'CANCELLED' || current === 'RENEGOTIATED') return current;
  if (paidCents <= 0) return 'OPEN';
  return paidCents >= amountCents ? 'PAID' : 'PARTIAL';
}

export const isOpenStatus = (s: TitleStatus): boolean => s === 'OPEN' || s === 'PARTIAL';

export const isOverdue = (status: TitleStatus, dueDate: Day, today: Day): boolean => isOpenStatus(status) && dueDate < today;

/** A situação que a tela mostra (com "Vencida" calculada). */
export const displayStatus = (status: TitleStatus, dueDate: Day, today: Day): TitleDisplay => (isOverdue(status, dueDate, today) ? 'OVERDUE' : status);

/** No feminino, porque acompanha "conta": "Conta aberta", "Conta vencida". */
export const TITLE_STATUS_LABEL: Record<TitleDisplay, string> = {
  OPEN: 'Aberta',
  PARTIAL: 'Paga em parte',
  PAID: 'Paga',
  CANCELLED: 'Cancelada',
  RENEGOTIATED: 'Renegociada',
  OVERDUE: 'Vencida',
};

/** Faixas de atraso do relatório de inadimplência. */
export function agingBucket(daysLate: number): '1-30' | '31-60' | '61-90' | '90+' | null {
  if (daysLate <= 0) return null;
  if (daysLate <= 30) return '1-30';
  if (daysLate <= 60) return '31-60';
  if (daysLate <= 90) return '61-90';
  return '90+';
}
