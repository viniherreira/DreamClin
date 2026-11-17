import 'server-only';

import { randomUUID } from 'node:crypto';
import type { TenantPrismaClient } from '@clinicaiq/db';
import { accountAllowed, type FinAccessInput } from '@/lib/financeiro/access';
import { addDays, competenceOf, dateToDay, dayToDate, isDay, type Day } from '@/lib/financeiro/dates';
import { fromCents, toCents } from '@/lib/financeiro/money';
import { nextCode } from './codes';
import type { Tx } from './titles';

/**
 * Transferência entre contas: uma saída numa conta e uma entrada na outra,
 * ligadas pelo mesmo `transferId`. Não é receita nem despesa (fica fora da DRE).
 * Estornar desfaz as duas pontas (em `reverse.ts`, com `transfer: true`).
 */

export interface TransferEnv {
  tenantId: string;
  userId: string | null;
  access: FinAccessInput;
  today: Day;
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  date: Day;
  description?: string | null;
}

export type TransferResult = { ok: true; transferId: string } | { ok: false; message: string };
const no = (message: string): TransferResult => ({ ok: false, message });

export async function transferTx(tx: Tx, env: TransferEnv, input: TransferInput): Promise<TransferResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return no('Informe o valor.');
  if (input.amountCents > 100_000_000) return no('Valor alto demais.');
  if (!isDay(input.date)) return no('Confira a data.');
  if (input.date > env.today) return no('A data não pode ser no futuro.');
  if (input.fromAccountId === input.toAccountId) return no('Escolha contas diferentes.');
  if ((input.description ?? '').length > 300) return no('A descrição tem no máximo 300 letras.');
  const contas = await tx.financialAccount.findMany({ where: { tenantId: env.tenantId, id: { in: [input.fromAccountId, input.toAccountId] }, active: true }, select: { id: true, name: true } });
  const de = contas.find((c) => c.id === input.fromAccountId);
  const para = contas.find((c) => c.id === input.toAccountId);
  if (!de || !para) return no('Conta não encontrada ou desativada.');
  if (!accountAllowed(env.access, de.id) || !accountAllowed(env.access, para.id)) return no('Seu acesso não permite movimentar uma destas contas.');

  const transferId = randomUUID();
  const code = await nextCode(tx, env.tenantId, 'transaction');
  const nota = input.description?.trim() || null;
  const base = { tenantId: env.tenantId, origin: 'TRANSFER' as const, originId: transferId, transferId, amount: fromCents(input.amountCents), paidOn: dayToDate(input.date), competence: competenceOf(input.date), createdById: env.userId };
  await tx.financialTransaction.create({ data: { ...base, code, kind: 'TRANSFER_OUT', accountId: de.id, signedAmount: fromCents(-input.amountCents), description: nota ?? `Transferência para ${para.name}` } });
  await tx.financialTransaction.create({ data: { ...base, code: code + 1, kind: 'TRANSFER_IN', accountId: para.id, signedAmount: fromCents(input.amountCents), description: nota ?? `Transferência de ${de.name}` } });
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'TRANSFER', entity: 'FinancialAccount', entityId: de.id, metadata: { para: para.id, valor: fromCents(input.amountCents) } } });
  return { ok: true, transferId };
}

export interface TransferRow {
  transferId: string;
  outId: string;
  date: Day;
  fromName: string;
  toName: string;
  amountCents: number;
  description: string | null;
  reversed: boolean;
  /** Sangria ou reforço de caixa (feito pela tela do caixa). */
  fromCash: boolean;
}

/** Transferências no período (pela data), com filtro opcional de conta. */
export async function transferList(db: TenantPrismaClient, from: Day, to: Day, accountId?: string): Promise<TransferRow[]> {
  const pernas = await db.financialTransaction.findMany({
    where: { transferId: { not: null }, kind: { in: ['TRANSFER_OUT', 'TRANSFER_IN', 'WITHDRAWAL', 'REINFORCEMENT'] }, paidOn: { gte: dayToDate(from), lt: dayToDate(addDays(to, 1)) } },
    orderBy: [{ paidOn: 'desc' }, { code: 'desc' }],
    take: 1000,
    select: { id: true, kind: true, transferId: true, accountId: true, amount: true, paidOn: true, description: true, reversedAt: true },
  });
  const contas = new Map((await db.financialAccount.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const grupos = new Map<string, typeof pernas>();
  for (const p of pernas) grupos.set(p.transferId!, [...(grupos.get(p.transferId!) ?? []), p]);
  const rows: TransferRow[] = [];
  for (const [transferId, g] of grupos) {
    // A ponta que sai: a transferência "de"; sangria sai do caixa, reforço sai da outra conta.
    const sai = g.find((p) => p.kind === 'TRANSFER_OUT' || p.kind === 'WITHDRAWAL');
    const entra = g.find((p) => p.kind === 'TRANSFER_IN' || p.kind === 'REINFORCEMENT');
    if (!sai || !entra) continue;
    if (accountId && sai.accountId !== accountId && entra.accountId !== accountId) continue;
    rows.push({
      transferId,
      outId: sai.id,
      date: dateToDay(sai.paidOn),
      fromName: contas.get(sai.accountId ?? '') ?? '',
      toName: contas.get(entra.accountId ?? '') ?? '',
      amountCents: toCents(sai.amount),
      description: sai.description,
      reversed: Boolean(sai.reversedAt),
      fromCash: sai.kind === 'WITHDRAWAL' || entra.kind === 'REINFORCEMENT',
    });
  }
  return rows;
}
