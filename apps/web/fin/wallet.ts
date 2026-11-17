import 'server-only';

import { randomUUID } from 'node:crypto';
import type { TenantPrismaClient } from '@clinicaiq/db';
import { accountAllowed, type FinAccessInput } from '@/lib/financeiro/access';
import { competenceOf, dayToDate, isDay, type Day } from '@/lib/financeiro/dates';
import { SYSTEM_CATEGORY } from '@/lib/financeiro/defaults';
import { fromCents, toCents } from '@/lib/financeiro/money';
import type { FinanceSettings } from '@/lib/financeiro/settings';
import { openCashOf } from './cash';
import { nextCode } from './codes';
import { lockWallet } from './settle';
import { categoryId, defaultAccountId } from './setup';
import type { Tx } from './titles';

/**
 * Carteira do paciente: crédito que a clínica guarda para ele (adiantamento,
 * troco, sobra). Adicionar crédito entra dinheiro de verdade numa conta e põe
 * o mesmo valor na carteira; devolver crédito tira dinheiro e zera o que foi
 * devolvido. Usar o crédito é a forma "Carteira" da tela de recebimento.
 * O saldo nunca é guardado: é a soma das linhas.
 */

export interface WalletEnv {
  tenantId: string;
  userId: string | null;
  unitId?: string | null;
  access: FinAccessInput;
  settings: FinanceSettings;
  today: Day;
}

export type WalletResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; code?: string };
const no = (message: string, code?: string): { ok: false; message: string; code?: string } => ({ ok: false, message, code });

interface MoveInput {
  patientId: string;
  amountCents: number;
  methodId: string;
  accountId?: string | null;
  paidOn: Day;
  description?: string | null;
}

/** A conta e o caixa de um movimento em dinheiro ou outra forma (mesma regra da baixa). */
async function destino(tx: Tx, env: WalletEnv, methodId: string, accountId: string | null | undefined, entrando: boolean) {
  const forma = await tx.finPaymentMethod.findFirst({ where: { tenantId: env.tenantId, id: methodId, active: true }, select: { id: true, kind: true, accountId: true, name: true } });
  if (!forma) return no('Forma de pagamento não encontrada.');
  if (forma.kind === 'WALLET') return no('Escolha como o dinheiro entra ou sai (dinheiro, PIX, cartão…), não a própria carteira.');
  const caixa = await openCashOf(tx, env.tenantId, env.userId, env.unitId, true);
  if (forma.kind === 'CASH' && entrando && !caixa && env.settings.requireOpenCashForCash) return no('Abra o caixa para receber em dinheiro.', 'CASH_CLOSED');
  const padrao = (await tx.financialAccount.findFirst({ where: { tenantId: env.tenantId, isDefault: true, active: true }, select: { id: true } }))?.id ?? defaultAccountId(env.tenantId);
  const conta = forma.kind === 'CASH' && caixa ? (accountId ?? caixa.accountId) : (accountId ?? forma.accountId ?? padrao);
  const existe = await tx.financialAccount.findFirst({ where: { tenantId: env.tenantId, id: conta, active: true }, select: { id: true } });
  if (!existe) return no('Conta não encontrada ou desativada.');
  if (!accountAllowed(env.access, conta)) return no('Seu acesso não permite movimentar esta conta.');
  const cashSessionId = caixa && (forma.kind === 'CASH' ? conta === caixa.accountId : entrando) ? caixa.id : null;
  return { ok: true as const, forma, accountId: conta, cashSessionId };
}

function checa(input: MoveInput, today: Day): string | null {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return 'Informe o valor.';
  if (input.amountCents > 100_000_000) return 'Valor alto demais.';
  if (!isDay(input.paidOn)) return 'Confira a data.';
  if (input.paidOn > today) return 'A data não pode ser no futuro.';
  if ((input.description ?? '').length > 300) return 'A observação tem no máximo 300 letras.';
  return null;
}

/** Adicionar crédito (adiantamento): recebimento normal + crédito na carteira. Sai com recibo. */
export async function addCreditTx(tx: Tx, env: WalletEnv, input: MoveInput): Promise<WalletResult<{ transactionId: string; receiptGroupId: string }>> {
  const erro = checa(input, env.today);
  if (erro) return no(erro);
  const p = await tx.patient.findFirst({ where: { tenantId: env.tenantId, id: input.patientId }, select: { id: true } });
  if (!p) return no('Paciente não encontrado.');
  const d = await destino(tx, env, input.methodId, input.accountId, true);
  if (!d.ok) return d;
  await lockWallet(tx, env.tenantId, input.patientId);
  const id = randomUUID();
  const receiptGroupId = randomUUID();
  const code = await nextCode(tx, env.tenantId, 'transaction');
  await tx.financialTransaction.create({
    data: {
      id,
      tenantId: env.tenantId,
      code,
      kind: 'RECEIPT',
      origin: 'WALLET',
      originId: input.patientId,
      accountId: d.accountId,
      cashSessionId: d.cashSessionId,
      methodId: d.forma.id,
      methodKind: d.forma.kind,
      patientId: input.patientId,
      categoryId: categoryId(env.tenantId, SYSTEM_CATEGORY.carteira),
      amount: fromCents(input.amountCents),
      signedAmount: fromCents(input.amountCents),
      paidOn: dayToDate(input.paidOn),
      competence: competenceOf(input.paidOn),
      receiptGroupId,
      description: input.description?.trim() || 'Crédito na carteira (adiantamento)',
      createdById: env.userId,
    },
  });
  await tx.walletEntry.create({ data: { tenantId: env.tenantId, patientId: input.patientId, amount: fromCents(input.amountCents), reason: 'ADVANCE', transactionId: id, description: input.description?.trim() || 'Adiantamento', createdById: env.userId } });
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'WALLET_CREDIT', entity: 'Patient', entityId: input.patientId, metadata: { valor: fromCents(input.amountCents) } } });
  return { ok: true, transactionId: id, receiptGroupId };
}

/** Devolver crédito: sai dinheiro de uma conta e o valor deixa a carteira. Não passa do saldo. */
export async function refundCreditTx(tx: Tx, env: WalletEnv, input: MoveInput): Promise<WalletResult<{ transactionId: string }>> {
  const erro = checa(input, env.today);
  if (erro) return no(erro);
  const saldo = await lockWallet(tx, env.tenantId, input.patientId);
  if (input.amountCents > saldo) return no(`O saldo da carteira é ${(saldo / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Não dá para devolver mais que isso.`);
  const d = await destino(tx, env, input.methodId, input.accountId, false);
  if (!d.ok) return d;
  const id = randomUUID();
  const code = await nextCode(tx, env.tenantId, 'transaction');
  await tx.financialTransaction.create({
    data: {
      id,
      tenantId: env.tenantId,
      code,
      kind: 'PAYMENT',
      origin: 'WALLET',
      originId: input.patientId,
      accountId: d.accountId,
      cashSessionId: d.cashSessionId,
      methodId: d.forma.id,
      methodKind: d.forma.kind,
      patientId: input.patientId,
      categoryId: categoryId(env.tenantId, SYSTEM_CATEGORY.devolucaoCarteira),
      amount: fromCents(input.amountCents),
      signedAmount: fromCents(-input.amountCents),
      paidOn: dayToDate(input.paidOn),
      competence: competenceOf(input.paidOn),
      description: input.description?.trim() || 'Devolução de crédito da carteira',
      createdById: env.userId,
    },
  });
  await tx.walletEntry.create({ data: { tenantId: env.tenantId, patientId: input.patientId, amount: fromCents(-input.amountCents), reason: 'REFUND', transactionId: id, description: input.description?.trim() || 'Devolvido ao paciente', createdById: env.userId } });
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'WALLET_REFUND', entity: 'Patient', entityId: input.patientId, metadata: { valor: fromCents(input.amountCents) } } });
  return { ok: true, transactionId: id };
}

export const WALLET_REASON_LABEL: Record<string, string> = {
  ADVANCE: 'Adiantamento',
  CHANGE: 'Troco guardado',
  REVERSAL: 'Estorno',
  RENEGOTIATION: 'Renegociação',
  USE: 'Usado em pagamento',
  REFUND: 'Devolvido ao paciente',
};

export interface WalletRow {
  patientId: string;
  patientName: string;
  creditsCents: number;
  debitsCents: number;
  balanceCents: number;
  lastAt: string;
}

/** As carteiras da clínica. `filter`: com saldo, sem saldo ou todas. */
export async function walletList(db: TenantPrismaClient, filter: 'with' | 'without' | 'all', search?: string): Promise<WalletRow[]> {
  const [creditos, debitos, ultimos] = await Promise.all([
    db.walletEntry.groupBy({ by: ['patientId'], where: { amount: { gt: 0 } }, _sum: { amount: true } }),
    db.walletEntry.groupBy({ by: ['patientId'], where: { amount: { lt: 0 } }, _sum: { amount: true } }),
    db.walletEntry.groupBy({ by: ['patientId'], _max: { createdAt: true } }),
  ]);
  const c = new Map(creditos.map((x) => [x.patientId, toCents(x._sum.amount)]));
  const d = new Map(debitos.map((x) => [x.patientId, -toCents(x._sum.amount)]));
  const ids = ultimos.map((u) => u.patientId);
  const nomes = new Map((ids.length ? await db.patient.findMany({ where: { id: { in: ids }, ...(search?.trim() ? { name: { contains: search.trim(), mode: 'insensitive' } } : {}) }, select: { id: true, name: true } }) : []).map((p) => [p.id, p.name]));
  return ultimos
    .filter((u) => nomes.has(u.patientId))
    .map((u) => {
      const cr = c.get(u.patientId) ?? 0;
      const db_ = d.get(u.patientId) ?? 0;
      return { patientId: u.patientId, patientName: nomes.get(u.patientId)!, creditsCents: cr, debitsCents: db_, balanceCents: cr - db_, lastAt: (u._max.createdAt ?? new Date(0)).toISOString() };
    })
    .filter((r) => (filter === 'with' ? r.balanceCents !== 0 : filter === 'without' ? r.balanceCents === 0 : true))
    .sort((a, b) => b.balanceCents - a.balanceCents || a.patientName.localeCompare(b.patientName, 'pt-BR'));
}

export interface WalletStatementLine {
  id: string;
  at: string;
  reason: string;
  reasonLabel: string;
  description: string | null;
  amountCents: number;
  receiptGroupId: string | null;
}

/** O extrato da carteira de um paciente, do mais novo para o mais antigo, com o saldo. */
export async function walletStatement(db: TenantPrismaClient, patientId: string): Promise<{ balanceCents: number; lines: WalletStatementLine[] }> {
  const linhas = await db.walletEntry.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, createdAt: true, reason: true, description: true, amount: true, transactionId: true } });
  const txs = linhas.map((l) => l.transactionId).filter((x): x is string => Boolean(x));
  const recibos = new Map((txs.length ? await db.financialTransaction.findMany({ where: { id: { in: txs }, kind: 'RECEIPT' }, select: { id: true, receiptGroupId: true } }) : []).map((t) => [t.id, t.receiptGroupId]));
  const soma = await db.walletEntry.aggregate({ where: { patientId }, _sum: { amount: true } });
  return {
    balanceCents: toCents(soma._sum.amount),
    lines: linhas.map((l) => ({
      id: l.id,
      at: l.createdAt.toISOString(),
      reason: l.reason,
      reasonLabel: WALLET_REASON_LABEL[l.reason] ?? l.reason,
      description: l.description,
      amountCents: toCents(l.amount),
      receiptGroupId: l.reason === 'ADVANCE' && l.transactionId ? (recibos.get(l.transactionId) ?? null) : null,
    })),
  };
}
