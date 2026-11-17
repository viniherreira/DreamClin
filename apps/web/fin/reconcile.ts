import 'server-only';

import { randomUUID } from 'node:crypto';
import type { TenantPrismaClient } from '@clinicaiq/db';
import { accountAllowed, type FinAccessInput } from '@/lib/financeiro/access';
import { addDays, competenceOf, dateToDay, dayToDate, type Day } from '@/lib/financeiro/dates';
import { SYSTEM_CATEGORY } from '@/lib/financeiro/defaults';
import { fromCents, toCents } from '@/lib/financeiro/money';
import type { FinanceSettings } from '@/lib/financeiro/settings';
import { matchStatement, type StatementLineIn } from '@/lib/financeiro/statement';
import { nextCode } from './codes';
import { reverseTransactionTx } from './reverse';
import { categoryId } from './setup';
import type { Tx } from './titles';
import { transferTx } from './transfers';

/**
 * Conciliação bancária (extrato OFX/CSV × movimentos da conta) e de cartões e
 * cheques (recebíveis × o que a operadora pagou). Nada é apagado: desfazer
 * desliga a linha do movimento, e o movimento criado pela conciliação é
 * estornado.
 */

type Db = Tx | TenantPrismaClient;

export interface RecEnv {
  tenantId: string;
  userId: string | null;
  unitId?: string | null;
  access: FinAccessInput;
  settings: FinanceSettings;
  today: Day;
}

export type RecResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const no = (message: string): { ok: false; message: string } => ({ ok: false, message });

async function contaOk(db: Db, env: RecEnv, accountId: string) {
  const c = await db.financialAccount.findFirst({ where: { tenantId: env.tenantId, id: accountId }, select: { id: true, name: true } });
  if (!c) return null;
  if (!accountAllowed(env.access, accountId)) return null;
  return c;
}

/** Movimentos da conta que ainda podem casar com o extrato (não conciliados, não estornados). */
async function candidatos(db: Db, tenantId: string, accountId: string, from: Day, to: Day) {
  const movs = await db.financialTransaction.findMany({
    where: { tenantId, accountId, reconciledAt: null, reversedAt: null, kind: { not: 'REVERSAL' }, paidOn: { gte: dayToDate(addDays(from, -5)), lt: dayToDate(addDays(to, 6)) } },
    select: { id: true, paidOn: true, signedAmount: true, description: true, code: true },
  });
  return movs.filter((m) => toCents(m.signedAmount) !== 0).map((m) => ({ id: m.id, date: dateToDay(m.paidOn), amount: toCents(m.signedAmount), description: m.description ?? '', code: m.code }));
}

async function marcar(tx: Tx, env: RecEnv, lineId: string, transactionId: string, status: 'MATCHED' | 'CREATED' | 'TRANSFER') {
  await tx.financialTransaction.updateMany({ where: { tenantId: env.tenantId, id: transactionId }, data: { reconciledAt: new Date(), statementLineId: lineId } });
  await tx.bankStatementLine.updateMany({ where: { tenantId: env.tenantId, id: lineId }, data: { status, transactionId, resolvedAt: new Date(), resolvedById: env.userId } });
}

/** Importa o extrato: linhas novas entram, as já importadas (mesmo identificador) são puladas, e as exatas já casam. */
export async function importStatementTx(tx: Tx, env: RecEnv, input: { accountId: string; filename: string; format: 'OFX' | 'CSV'; lines: StatementLineIn[] }): Promise<RecResult<{ importId: string; added: number; skipped: number; matched: number }>> {
  if (!(await contaOk(tx, env, input.accountId))) return no('Conta não encontrada.');
  if (!input.lines.length) return no('Não achei lançamentos neste arquivo. Confira se é um extrato OFX ou um CSV com data, descrição e valor.');
  if (input.lines.length > 5000) return no('O arquivo tem lançamentos demais. Importe um período menor.');
  const ids = input.lines.map((l) => l.externalId).filter((x): x is string => Boolean(x));
  const ja = new Set((ids.length ? await tx.bankStatementLine.findMany({ where: { tenantId: env.tenantId, accountId: input.accountId, externalId: { in: ids } }, select: { externalId: true } }) : []).map((l) => l.externalId));
  const novas = input.lines.filter((l) => !l.externalId || !ja.has(l.externalId));
  const datas = input.lines.map((l) => l.date).sort();
  const importId = randomUUID();
  await tx.bankStatementImport.create({ data: { id: importId, tenantId: env.tenantId, accountId: input.accountId, filename: input.filename.slice(-120), format: input.format, periodFrom: dayToDate(datas[0]), periodTo: dayToDate(datas[datas.length - 1]), lineCount: novas.length, createdById: env.userId } });
  const criadas = novas.map((l) => ({ id: randomUUID(), tenantId: env.tenantId, importId, accountId: input.accountId, date: dayToDate(l.date), amount: fromCents(l.amount), description: l.description, externalId: l.externalId }));
  if (criadas.length) await tx.bankStatementLine.createMany({ data: criadas });

  // As exatas (mesmo valor e mesmo dia) já casam sozinhas.
  const cand = novas.length ? await candidatos(tx, env.tenantId, input.accountId, datas[0], datas[datas.length - 1]) : [];
  const pares = matchStatement(novas, cand).filter((m) => m.exact);
  for (const p of pares) await marcar(tx, env, criadas[p.lineIndex].id, p.candidateId, 'MATCHED');
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'STATEMENT_IMPORT', entity: 'FinancialAccount', entityId: input.accountId, metadata: { linhas: novas.length, puladas: input.lines.length - novas.length, casadas: pares.length } } });
  return { ok: true, importId, added: novas.length, skipped: input.lines.length - novas.length, matched: pares.length };
}

export interface PendingLine {
  id: string;
  date: Day;
  amountCents: number;
  description: string;
  status: string;
  transactionCode: number | null;
  suggestion: { id: string; code: number; date: Day; description: string } | null;
}

/** As linhas do extrato da conta: pendentes (com a sugestão aproximada, se houver) e as resolvidas. */
export async function statementLines(db: TenantPrismaClient, accountId: string, show: 'pending' | 'all' = 'pending'): Promise<PendingLine[]> {
  const linhas = await db.bankStatementLine.findMany({ where: { accountId, ...(show === 'pending' ? { status: 'PENDING' } : {}) }, orderBy: [{ date: 'desc' }, { createdAt: 'asc' }], take: 500 });
  const pend = linhas.filter((l) => l.status === 'PENDING');
  const tenantId = linhas[0]?.tenantId;
  let sug = new Map<string, PendingLine['suggestion']>();
  if (pend.length && tenantId) {
    const datas = pend.map((l) => dateToDay(l.date)).sort();
    const cand = await candidatos(db, tenantId, accountId, datas[0], datas[datas.length - 1]);
    const pares = matchStatement(pend.map((l) => ({ date: dateToDay(l.date), amount: toCents(l.amount) })), cand);
    sug = new Map(pares.map((p) => {
      const c = cand.find((x) => x.id === p.candidateId)!;
      return [pend[p.lineIndex].id, { id: c.id, code: c.code, date: c.date, description: c.description }];
    }));
  }
  const codigos = new Map((await db.financialTransaction.findMany({ where: { id: { in: linhas.map((l) => l.transactionId).filter((x): x is string => Boolean(x)) } }, select: { id: true, code: true } })).map((t) => [t.id, t.code]));
  return linhas.map((l) => ({ id: l.id, date: dateToDay(l.date), amountCents: toCents(l.amount), description: l.description, status: l.status, transactionCode: l.transactionId ? (codigos.get(l.transactionId) ?? null) : null, suggestion: sug.get(l.id) ?? null }));
}

/** Movimentos da conta que podem ser ligados a uma linha ("Buscar"): mesmo valor, perto da data. */
export async function lineCandidates(db: TenantPrismaClient, lineId: string) {
  const l = await db.bankStatementLine.findFirst({ where: { id: lineId } });
  if (!l) return [];
  const d = dateToDay(l.date);
  const cand = await candidatos(db, l.tenantId, l.accountId, addDays(d, -25), addDays(d, 25));
  const valor = toCents(l.amount);
  return cand.filter((c) => c.amount === valor).sort((a, b) => Math.abs(new Date(a.date).getTime() - new Date(d).getTime()) - Math.abs(new Date(b.date).getTime() - new Date(d).getTime())).slice(0, 20);
}

async function linhaPendente(tx: Tx, env: RecEnv, lineId: string) {
  const l = await tx.bankStatementLine.findFirst({ where: { tenantId: env.tenantId, id: lineId } });
  if (!l) return null;
  if (!accountAllowed(env.access, l.accountId)) return null;
  return l;
}

/** "Buscar": liga a linha a um movimento que já existe na conta, de mesmo valor. */
export async function linkLineTx(tx: Tx, env: RecEnv, lineId: string, transactionId: string): Promise<RecResult> {
  const l = await linhaPendente(tx, env, lineId);
  if (!l) return no('Linha não encontrada.');
  if (l.status !== 'PENDING') return no('Esta linha já foi resolvida.');
  const m = await tx.financialTransaction.findFirst({ where: { tenantId: env.tenantId, id: transactionId } });
  if (!m || m.accountId !== l.accountId) return no('Escolha um movimento desta conta.');
  if (m.reconciledAt) return no('Este movimento já está conciliado.');
  if (toCents(m.signedAmount) !== toCents(l.amount)) return no('O valor do movimento não bate com o do extrato.');
  await marcar(tx, env, l.id, m.id, 'MATCHED');
  return { ok: true };
}

/** "Lançar": cria o movimento que faltava (tarifa, rendimento, pagamento esquecido), já conciliado. */
export async function createFromLineTx(tx: Tx, env: RecEnv, lineId: string, input: { categoryId: string; description?: string | null }): Promise<RecResult<{ transactionId: string }>> {
  const l = await linhaPendente(tx, env, lineId);
  if (!l) return no('Linha não encontrada.');
  if (l.status !== 'PENDING') return no('Esta linha já foi resolvida.');
  const valor = toCents(l.amount);
  const cat = await tx.financialCategory.findFirst({ where: { tenantId: env.tenantId, id: input.categoryId }, select: { direction: true } });
  if (!cat) return no('Escolha a categoria.');
  if ((valor > 0) !== (cat.direction === 'RECEIVABLE')) return no(valor > 0 ? 'Entrada no extrato pede uma categoria de receita.' : 'Saída no extrato pede uma categoria de despesa.');
  const dia = dateToDay(l.date);
  const id = randomUUID();
  await tx.financialTransaction.create({
    data: { id, tenantId: env.tenantId, code: await nextCode(tx, env.tenantId, 'transaction'), kind: valor > 0 ? 'RECEIPT' : 'PAYMENT', origin: 'MANUAL', accountId: l.accountId, categoryId: input.categoryId, amount: fromCents(Math.abs(valor)), signedAmount: fromCents(valor), paidOn: dayToDate(dia), competence: competenceOf(dia), description: input.description?.trim().slice(0, 300) || l.description, createdById: env.userId },
  });
  await marcar(tx, env, l.id, id, 'CREATED');
  return { ok: true, transactionId: id };
}

/** "Transferência": a linha é dinheiro que veio de outra conta da clínica (ou foi para ela). */
export async function transferFromLineTx(tx: Tx, env: RecEnv, lineId: string, otherAccountId: string): Promise<RecResult> {
  const l = await linhaPendente(tx, env, lineId);
  if (!l) return no('Linha não encontrada.');
  if (l.status !== 'PENDING') return no('Esta linha já foi resolvida.');
  const valor = toCents(l.amount);
  const r = await transferTx(tx, { tenantId: env.tenantId, userId: env.userId, access: env.access, today: env.today }, { fromAccountId: valor < 0 ? l.accountId : otherAccountId, toAccountId: valor < 0 ? otherAccountId : l.accountId, amountCents: Math.abs(valor), date: dateToDay(l.date) > env.today ? env.today : dateToDay(l.date), description: l.description });
  if (!r.ok) return r;
  const perna = await tx.financialTransaction.findFirst({ where: { tenantId: env.tenantId, transferId: r.transferId, accountId: l.accountId } });
  if (perna) await marcar(tx, env, l.id, perna.id, 'TRANSFER');
  return { ok: true };
}

export async function discardLineTx(tx: Tx, env: RecEnv, lineId: string): Promise<RecResult> {
  const l = await linhaPendente(tx, env, lineId);
  if (!l) return no('Linha não encontrada.');
  if (l.status !== 'PENDING') return no('Esta linha já foi resolvida.');
  await tx.bankStatementLine.updateMany({ where: { tenantId: env.tenantId, id: l.id }, data: { status: 'DISCARDED', resolvedAt: new Date(), resolvedById: env.userId } });
  return { ok: true };
}

/** Desfaz: a linha volta a ficar pendente. Movimento criado pela conciliação é estornado. */
export async function undoLineTx(tx: Tx, env: RecEnv, lineId: string): Promise<RecResult> {
  const l = await linhaPendente(tx, env, lineId);
  if (!l) return no('Linha não encontrada.');
  if (l.status === 'PENDING') return no('Esta linha já está pendente.');
  if (l.transactionId) {
    await tx.financialTransaction.updateMany({ where: { tenantId: env.tenantId, id: l.transactionId }, data: { reconciledAt: null, statementLineId: null } });
    if (l.status === 'CREATED') {
      const r = await reverseTransactionTx(tx, { tenantId: env.tenantId, userId: env.userId, today: env.today, unitId: env.unitId }, { transactionId: l.transactionId, reason: 'Conciliação desfeita' });
      if (!r.ok) return r;
    }
  }
  await tx.bankStatementLine.updateMany({ where: { tenantId: env.tenantId, id: l.id }, data: { status: 'PENDING', transactionId: null, resolvedAt: null, resolvedById: null } });
  return { ok: true };
}

/** Conciliação manual no extrato da conta: marca ou desmarca um movimento como conferido. */
export async function setReconciledTx(tx: Tx, env: RecEnv, transactionId: string, value: boolean): Promise<RecResult> {
  const m = await tx.financialTransaction.findFirst({ where: { tenantId: env.tenantId, id: transactionId }, select: { accountId: true, statementLineId: true } });
  if (!m?.accountId || !accountAllowed(env.access, m.accountId)) return no('Movimento não encontrado.');
  if (!value && m.statementLineId) return no('Este movimento foi conciliado pelo extrato. Desfaça pela linha do extrato.');
  await tx.financialTransaction.updateMany({ where: { tenantId: env.tenantId, id: transactionId }, data: { reconciledAt: value ? new Date() : null } });
  return { ok: true };
}

/** As contas com o saldo geral, o conciliado e quantas linhas do extrato faltam resolver. */
export async function accountsReconSummary(db: TenantPrismaClient) {
  const [contas, geral, conciliado, pendentes] = await Promise.all([
    db.financialAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true, kind: true, openingBalance: true } }),
    db.financialTransaction.groupBy({ by: ['accountId'], where: { accountId: { not: null } }, _sum: { signedAmount: true } }),
    db.financialTransaction.groupBy({ by: ['accountId'], where: { accountId: { not: null }, reconciledAt: { not: null } }, _sum: { signedAmount: true } }),
    db.bankStatementLine.groupBy({ by: ['accountId'], where: { status: 'PENDING' }, _count: { _all: true } }),
  ]);
  const g = new Map(geral.map((x) => [x.accountId!, toCents(x._sum.signedAmount)]));
  const c = new Map(conciliado.map((x) => [x.accountId!, toCents(x._sum.signedAmount)]));
  const p = new Map(pendentes.map((x) => [x.accountId, x._count._all]));
  return contas.map((a) => ({ id: a.id, name: a.name, kind: a.kind, balanceCents: toCents(a.openingBalance) + (g.get(a.id) ?? 0), reconciledCents: toCents(a.openingBalance) + (c.get(a.id) ?? 0), pendingLines: p.get(a.id) ?? 0 }));
}

/** O extrato da conta no sistema, para conciliar item a item. */
export async function accountMovements(db: TenantPrismaClient, accountId: string, from: Day, to: Day) {
  const movs = await db.financialTransaction.findMany({ where: { accountId, paidOn: { gte: dayToDate(from), lt: dayToDate(addDays(to, 1)) } }, orderBy: [{ paidOn: 'asc' }, { code: 'asc' }], take: 1000, select: { id: true, code: true, kind: true, paidOn: true, signedAmount: true, description: true, reconciledAt: true, statementLineId: true, reversedAt: true } });
  return movs.map((m) => ({ id: m.id, code: m.code, kind: m.kind, date: dateToDay(m.paidOn), amountCents: toCents(m.signedAmount), description: m.description ?? '', reconciled: Boolean(m.reconciledAt), byStatement: Boolean(m.statementLineId), reversed: Boolean(m.reversedAt) }));
}

// ─── Cartões e cheques ───────────────────────────────────────────────────────

export interface ReceivableRow {
  id: string;
  kind: 'CARD' | 'CHECK';
  code: number;
  party: string;
  methodName: string;
  installment: string;
  expectedDate: Day;
  receivedOn: Day;
  grossCents: number;
  feeCents: number;
  netCents: number;
  nsu: string | null;
  documentNumber: string | null;
  status: string;
  reconciledAt: string | null;
  anticipated: boolean;
}

export async function listReceivables(db: TenantPrismaClient, f: { from: Day; to: Day; by: 'expected' | 'reconciled'; status: 'OPEN' | 'RECONCILED' | 'CANCELLED' | 'RETURNED' | 'ALL'; kind?: 'CARD' | 'CHECK' | null }): Promise<ReceivableRow[]> {
  const faixa = { gte: dayToDate(f.from), lt: dayToDate(addDays(f.to, 1)) };
  const linhas = await db.cardReceivable.findMany({
    where: { ...(f.by === 'expected' ? { expectedDate: faixa } : { reconciledAt: faixa }), ...(f.status === 'ALL' ? {} : { status: f.status }), ...(f.kind ? { kind: f.kind } : {}) },
    orderBy: [{ expectedDate: 'asc' }, { installmentNumber: 'asc' }],
    take: 1000,
    include: { transaction: { select: { code: true, paidOn: true, nsu: true, documentNumber: true, checkNumber: true, patientId: true, methodId: true } } },
  });
  const pacientes = new Map((await db.patient.findMany({ where: { id: { in: [...new Set(linhas.map((l) => l.transaction.patientId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const formas = new Map((await db.finPaymentMethod.findMany({ select: { id: true, name: true } })).map((m) => [m.id, m.name]));
  return linhas.map((l) => ({
    id: l.id,
    kind: l.kind === 'CHECK' ? 'CHECK' : 'CARD',
    code: l.transaction.code,
    party: l.transaction.patientId ? (pacientes.get(l.transaction.patientId) ?? '') : '',
    methodName: l.methodId ? (formas.get(l.methodId) ?? '') : '',
    installment: `${l.installmentNumber}/${l.installmentTotal}`,
    expectedDate: dateToDay(l.expectedDate),
    receivedOn: dateToDay(l.transaction.paidOn),
    grossCents: toCents(l.grossAmount),
    feeCents: toCents(l.feeAmount),
    netCents: toCents(l.netAmount),
    nsu: l.transaction.nsu,
    documentNumber: l.kind === 'CHECK' ? l.transaction.checkNumber : l.transaction.documentNumber,
    status: l.status,
    reconciledAt: l.reconciledAt?.toISOString() ?? null,
    anticipated: Boolean(l.anticipatedAt),
  }));
}

/** Concilia recebíveis: a operadora pagou. Com a taxa "na conciliação", a despesa da taxa nasce agora. */
export async function reconcileReceivablesTx(tx: Tx, env: RecEnv, ids: string[]): Promise<RecResult<{ reconciled: number }>> {
  const linhas = await tx.cardReceivable.findMany({ where: { tenantId: env.tenantId, id: { in: ids }, status: 'OPEN' }, include: { transaction: { select: { accountId: true, methodId: true, methodKind: true, receiptGroupId: true } } } });
  let code = await nextCode(tx, env.tenantId, 'transaction');
  for (const l of linhas) {
    if (env.settings.cardFeeWhen === 'RECONCILIATION' && l.kind === 'CARD' && toCents(l.feeAmount) > 0) {
      await tx.financialTransaction.create({
        data: { tenantId: env.tenantId, code: code++, kind: 'FEE', origin: 'CARD_FEE', originId: l.transactionId, accountId: l.transaction.accountId, methodId: l.transaction.methodId, methodKind: l.transaction.methodKind, categoryId: categoryId(env.tenantId, SYSTEM_CATEGORY.taxaCartao), amount: l.feeAmount, signedAmount: fromCents(-toCents(l.feeAmount)), paidOn: dayToDate(env.today), competence: competenceOf(env.today), receiptGroupId: l.transaction.receiptGroupId, description: `Taxa de cartão (parcela ${l.installmentNumber}/${l.installmentTotal})`, createdById: env.userId },
      });
    }
  }
  const r = await tx.cardReceivable.updateMany({ where: { tenantId: env.tenantId, id: { in: linhas.map((l) => l.id) } }, data: { status: 'RECONCILED', reconciledAt: new Date() } });
  return { ok: true, reconciled: r.count };
}

/** Antecipação: a operadora pagou antes, com desconto. A diferença vira despesa de antecipação. */
export async function anticipateTx(tx: Tx, env: RecEnv, input: { ids: string[]; date: Day; receivedCents: number }): Promise<RecResult<{ costCents: number }>> {
  const linhas = await tx.cardReceivable.findMany({ where: { tenantId: env.tenantId, id: { in: input.ids }, status: 'OPEN', kind: 'CARD' }, include: { transaction: { select: { accountId: true } } } });
  if (!linhas.length || linhas.length !== new Set(input.ids).size) return no('Escolha só recebíveis de cartão em aberto.');
  if (input.date > env.today) return no('A data não pode ser no futuro.');
  const liquido = linhas.reduce((s, l) => s + toCents(l.netAmount), 0);
  if (!Number.isInteger(input.receivedCents) || input.receivedCents <= 0 || input.receivedCents > liquido) return no(`O valor recebido vai de R$ 0,01 até o líquido dos recebíveis (${(liquido / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`);
  const custo = liquido - input.receivedCents;
  if (custo > 0) {
    await tx.financialTransaction.create({
      data: { tenantId: env.tenantId, code: await nextCode(tx, env.tenantId, 'transaction'), kind: 'FEE', origin: 'CARD_FEE', accountId: linhas[0].transaction.accountId, categoryId: categoryId(env.tenantId, SYSTEM_CATEGORY.antecipacao), amount: fromCents(custo), signedAmount: fromCents(-custo), paidOn: dayToDate(input.date), competence: competenceOf(input.date), description: `Antecipação de ${linhas.length} recebível(is) de cartão`, createdById: env.userId },
    });
  }
  await tx.cardReceivable.updateMany({ where: { tenantId: env.tenantId, id: { in: linhas.map((l) => l.id) } }, data: { status: 'RECONCILED', reconciledAt: new Date(), anticipatedAt: dayToDate(input.date) } });
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'CARD_ANTICIPATION', entity: 'CardReceivable', entityId: linhas[0].id, metadata: { recebiveis: linhas.length, custo: fromCents(custo) } } });
  return { ok: true, costCents: custo };
}

/** Cheque devolvido: o recebimento é estornado e a conta do paciente reabre. */
export async function checkReturnedTx(tx: Tx, env: RecEnv, receivableId: string): Promise<RecResult> {
  const r = await tx.cardReceivable.findFirst({ where: { tenantId: env.tenantId, id: receivableId } });
  if (!r || r.kind !== 'CHECK') return no('Cheque não encontrado.');
  if (r.status === 'RETURNED') return no('Este cheque já foi marcado como devolvido.');
  const e = await reverseTransactionTx(tx, { tenantId: env.tenantId, userId: env.userId, today: env.today, unitId: env.unitId }, { transactionId: r.transactionId, reason: 'Cheque devolvido', confirmOutOfOrder: true });
  if (!e.ok) return e;
  await tx.cardReceivable.updateMany({ where: { tenantId: env.tenantId, id: r.id }, data: { status: 'RETURNED' } });
  return { ok: true };
}
