import 'server-only';

import { randomUUID } from 'node:crypto';
import { Prisma, type TenantPrismaClient } from '@clinicaiq/db';
import { closeCheck, expectedCash, ZERO_COUNT, COUNT_GROUPS, type CashMovement, type CountGroup, type Counted, type CountRow } from '@/lib/financeiro/cash';
import { competenceOf, dayToDate, type Day } from '@/lib/financeiro/dates';
import { fromCents, toCents } from '@/lib/financeiro/money';
import { nextCode } from './codes';
import type { Tx } from './titles';

/**
 * O caixa: uma sessão por pessoa e por unidade. Abrir, reforço, sangria e
 * fechar com conferência. O saldo nunca é guardado: sai sempre dos movimentos
 * ligados à sessão (`cashSessionId`). Caixa fechado não muda mais.
 */

export interface CashEnv {
  tenantId: string;
  userId: string;
  unitId: string | null;
  today: Day;
  /** Dono e administrador: mexem no caixa dos outros. */
  manageOthers: boolean;
}

export type CashResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; code?: string };

const no = (message: string, code?: string): { ok: false; message: string; code?: string } => ({ ok: false, message, code });

export interface OpenCash {
  id: string;
  accountId: string;
  unitId: string | null;
  userId: string;
}

/**
 * O caixa aberto desta pessoa: o da unidade em que ela está, senão o mais
 * recente. Dentro de uma transação, segura a sessão (`FOR SHARE`): se alguém
 * estiver fechando agora, espera e devolve nulo, para nenhum movimento entrar
 * num caixa já fechado.
 */
export async function openCashOf(db: Tx | TenantPrismaClient, tenantId: string, userId: string | null, unitId?: string | null, lock = false): Promise<OpenCash | null> {
  if (!userId) return null;
  const abertos = await db.cashSession.findMany({ where: { tenantId, userId, status: 'OPEN' }, orderBy: { openedAt: 'desc' }, select: { id: true, accountId: true, unitId: true, userId: true } });
  const escolhido = (unitId ? abertos.find((c) => c.unitId === unitId) : undefined) ?? abertos[0];
  if (!escolhido) return null;
  if (!lock) return escolhido;
  const vivo = await (db as Tx).$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "cash_sessions" WHERE "id" = ${escolhido.id} AND "tenantId" = ${tenantId} AND "status" = 'OPEN' FOR SHARE`);
  return vivo.length ? escolhido : null;
}

/** Trava a sessão para mexer nela. Devolve a linha, ou nulo se não existe. */
async function lockSession(tx: Tx, tenantId: string, sessionId: string) {
  await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "cash_sessions" WHERE "id" = ${sessionId} AND "tenantId" = ${tenantId} FOR UPDATE`);
  return tx.cashSession.findFirst({ where: { tenantId, id: sessionId } });
}

/** Abre o caixa. Um aberto por pessoa e por unidade. */
export async function openCashTx(tx: Tx, env: CashEnv, input: { openingCents: number; accountId?: string | null }): Promise<CashResult<{ id: string; code: number }>> {
  if (!Number.isInteger(input.openingCents) || input.openingCents < 0) return no('O troco inicial não pode ser negativo.');
  // A fila do número do caixa também segura duas aberturas juntas da mesma pessoa.
  const code = await nextCode(tx, env.tenantId, 'cash');
  const jaAberto = await tx.cashSession.findFirst({ where: { tenantId: env.tenantId, userId: env.userId, unitId: env.unitId, status: 'OPEN' }, select: { code: true } });
  if (jaAberto) return no(`Você já tem o caixa nº ${jaAberto.code} aberto nesta unidade.`, 'ALREADY_OPEN');

  const contas = await tx.financialAccount.findMany({ where: { tenantId: env.tenantId, active: true, kind: 'CASH' }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true, unitId: true } });
  const conta = input.accountId ? contas.find((c) => c.id === input.accountId) : (contas.find((c) => c.unitId && c.unitId === env.unitId) ?? contas[0]);
  if (!conta) return no(input.accountId ? 'A conta escolhida não é um caixa interno ativo.' : 'Cadastre uma conta do tipo caixa interno em Configurações › Financeiro › Contas.');

  const id = randomUUID();
  await tx.cashSession.create({ data: { id, tenantId: env.tenantId, code, userId: env.userId, unitId: env.unitId, accountId: conta.id, openingAmount: fromCents(input.openingCents) } });
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'OPEN', entity: 'CashSession', entityId: id, metadata: { troco: fromCents(input.openingCents) } } });
  return { ok: true, id, code };
}

type Line = { kind: CashMovement['kind']; methodKind: string | null; signedAmount: Prisma.Decimal };
const asMovement = (m: Line): CashMovement => ({ kind: m.kind, methodKind: m.methodKind, signedAmount: toCents(m.signedAmount) });

/** O que o sistema espera em cada meio, agora. */
export async function expectedOf(db: Tx | TenantPrismaClient, tenantId: string, session: { id: string; openingAmount: Prisma.Decimal }): Promise<Counted> {
  const movimentos = await db.financialTransaction.findMany({ where: { tenantId, cashSessionId: session.id }, select: { kind: true, methodKind: true, signedAmount: true } });
  return expectedCash(toCents(session.openingAmount), movimentos.map(asMovement));
}

export interface CashMoveInput {
  sessionId: string;
  kind: 'REINFORCEMENT' | 'WITHDRAWAL';
  amountCents: number;
  /** Reforço: de onde veio o dinheiro. Sangria: para onde foi (cofre, banco). */
  otherAccountId?: string | null;
  description?: string | null;
}

/** Reforço (entra dinheiro para troco) ou sangria (sai dinheiro por segurança). Com a outra conta, vira uma transferência. */
export async function cashMoveTx(tx: Tx, env: CashEnv, input: CashMoveInput): Promise<CashResult<{ transactionId: string }>> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return no('Informe o valor.');
  const sessao = await lockSession(tx, env.tenantId, input.sessionId);
  if (!sessao) return no('Caixa não encontrado.');
  if (sessao.status !== 'OPEN') return no('Este caixa já foi fechado.');
  if (sessao.userId !== env.userId && !env.manageOthers) return no('Este caixa é de outra pessoa.');
  const sangria = input.kind === 'WITHDRAWAL';

  let outra: { id: string; name: string } | null = null;
  if (input.otherAccountId) {
    if (input.otherAccountId === sessao.accountId) return no('Escolha uma conta diferente da conta do caixa.');
    outra = await tx.financialAccount.findFirst({ where: { tenantId: env.tenantId, id: input.otherAccountId, active: true }, select: { id: true, name: true } });
    if (!outra) return no('Conta não encontrada.');
  }
  if (sangria) {
    const esperado = await expectedOf(tx, env.tenantId, sessao);
    if (input.amountCents > esperado.CASH) return no(`O caixa tem ${(Math.max(0, esperado.CASH) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em dinheiro. Não dá para tirar mais do que isso.`);
  }

  const nota = input.description?.trim().slice(0, 300) || null;
  const transferId = outra ? randomUUID() : null;
  let code = await nextCode(tx, env.tenantId, 'transaction');
  const base = { tenantId: env.tenantId, origin: outra ? ('TRANSFER' as const) : ('MANUAL' as const), amount: fromCents(input.amountCents), paidOn: dayToDate(env.today), competence: competenceOf(env.today), transferId, createdById: env.userId };
  const id = randomUUID();
  await tx.financialTransaction.create({
    data: {
      ...base,
      id,
      code: code++,
      kind: input.kind,
      methodKind: 'CASH',
      accountId: sessao.accountId,
      cashSessionId: sessao.id,
      signedAmount: fromCents(sangria ? -input.amountCents : input.amountCents),
      description: nota ?? (sangria ? `Sangria${outra ? ` para ${outra.name}` : ''}` : `Reforço${outra ? ` vindo de ${outra.name}` : ''}`),
    },
  });
  if (outra) {
    await tx.financialTransaction.create({
      data: {
        ...base,
        code: code++,
        kind: sangria ? 'TRANSFER_IN' : 'TRANSFER_OUT',
        accountId: outra.id,
        signedAmount: fromCents(sangria ? input.amountCents : -input.amountCents),
        description: sangria ? `Sangria do caixa nº ${sessao.code}` : `Reforço do caixa nº ${sessao.code}`,
      },
    });
  }
  return { ok: true, transactionId: id };
}

export interface CloseInput {
  sessionId: string;
  counted: Counted;
  justification?: string | null;
  /** Conferência cega: refazer a contagem já registrada (só dono e administrador). */
  recount?: boolean;
}

export type CloseResult =
  | { ok: true; rows: CountRow[]; difference: number; code: number }
  | { ok: false; message: string; code?: 'NEGATIVE_CASH' | 'INVALID' | 'NEEDS_JUSTIFICATION' | 'BLOCKED'; rows?: CountRow[]; difference?: number };

const countedFrom = (rows: { methodKind: string; counted: Prisma.Decimal }[]): Counted => {
  const out = { ...ZERO_COUNT };
  for (const r of rows) if ((COUNT_GROUPS as readonly string[]).includes(r.methodKind)) out[r.methodKind as CountGroup] = toCents(r.counted);
  return out;
};

/**
 * Fecha o caixa com a conferência por meio. Na conferência cega, a primeira
 * contagem fica registrada antes de a pessoa ver o esperado: se não bater, ela
 * só acrescenta a justificativa (não dá para "ajustar" o contado depois de ver).
 */
export async function closeCashTx(tx: Tx, env: CashEnv, input: CloseInput, opts: { blind: boolean; block?: string | null }): Promise<CloseResult> {
  const sessao = await lockSession(tx, env.tenantId, input.sessionId);
  if (!sessao) return { ok: false, message: 'Caixa não encontrado.' };
  if (sessao.status !== 'OPEN') return { ok: false, message: 'Este caixa já foi fechado.' };
  const deOutro = sessao.userId !== env.userId;
  if (deOutro && !env.manageOthers) return { ok: false, message: 'Este caixa é de outra pessoa.' };
  if (opts.block) return { ok: false, message: opts.block, code: 'BLOCKED' };

  const esperado = await expectedOf(tx, env.tenantId, sessao);
  const guardadas = await tx.cashSessionCount.findMany({ where: { tenantId: env.tenantId, sessionId: sessao.id }, select: { methodKind: true, counted: true } });
  const refazer = Boolean(input.recount) && env.manageOthers;
  const usaGuardada = opts.blind && guardadas.length > 0 && !refazer;
  const contado = usaGuardada ? countedFrom(guardadas) : input.counted;

  const r = closeCheck(esperado, contado, input.justification);
  if (!r.ok) {
    // Cega: a contagem fica gravada agora, antes de o esperado aparecer na tela.
    if (r.code === 'NEEDS_JUSTIFICATION' && opts.blind && !usaGuardada) {
      await tx.cashSessionCount.deleteMany({ where: { tenantId: env.tenantId, sessionId: sessao.id } });
      await tx.cashSessionCount.createMany({ data: r.rows.map((x) => ({ tenantId: env.tenantId, sessionId: sessao.id, methodKind: x.group, expected: fromCents(x.expected), counted: fromCents(x.counted) })) });
    }
    return { ok: false, message: r.message, code: r.code, rows: r.rows, difference: r.difference };
  }

  const justificativa = input.justification?.trim().slice(0, 500) || null;
  await tx.cashSessionCount.deleteMany({ where: { tenantId: env.tenantId, sessionId: sessao.id } });
  await tx.cashSessionCount.createMany({
    data: r.rows.map((x) => ({ tenantId: env.tenantId, sessionId: sessao.id, methodKind: x.group, expected: fromCents(x.expected), counted: fromCents(x.counted), justification: x.diff !== 0 ? justificativa : null })),
  });
  await tx.cashSession.update({ where: { id: sessao.id }, data: { status: 'CLOSED', closedAt: new Date(), closedById: env.userId, blind: opts.blind, difference: fromCents(r.difference), closingNote: justificativa } });
  await tx.auditLog.create({
    data: { tenantId: env.tenantId, userId: env.userId, action: 'CLOSE', entity: 'CashSession', entityId: sessao.id, metadata: { caixa: sessao.code, diferenca: fromCents(r.difference), ...(deOutro ? { caixaDe: sessao.userId } : {}) } },
  });
  return { ok: true, rows: r.rows, difference: r.difference, code: sessao.code };
}
