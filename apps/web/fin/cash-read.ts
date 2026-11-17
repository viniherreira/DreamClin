import 'server-only';

import { cashSummary, countRows, expectedCash, openTooLong, ZERO_COUNT, COUNT_GROUPS, type CashSummary, type CountGroup, type Counted, type CountRow } from '@/lib/financeiro/cash';
import { addDays, dayToDate, daysBetween, type Day } from '@/lib/financeiro/dates';
import { toCents } from '@/lib/financeiro/money';
import { clinicDayOf, clinicToday } from '@/lib/tz';
import type { FinContext } from './guard';

/**
 * Leituras do caixa para as telas e para o relatório. Nada aqui grava.
 * Quem não gerencia o caixa dos outros só enxerga o próprio.
 */

export interface CashMovementRow {
  id: string;
  code: number;
  kind: string;
  methodKind: string | null;
  methodName: string;
  /** Efeito no caixa, em centavos (negativo sai). */
  signedCents: number;
  description: string;
  party: string;
  /** Instante do lançamento (ISO). */
  at: string;
  reversed: boolean;
}

export interface CashView {
  id: string;
  code: number;
  status: 'OPEN' | 'CLOSED';
  mine: boolean;
  userName: string;
  unitName: string | null;
  accountId: string;
  accountName: string;
  openedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  openingCents: number;
  daysOpen: number;
  blind: boolean;
  closingNote: string | null;
  /** Nulo na conferência cega, enquanto o caixa está aberto. */
  expected: Counted | null;
  summary: CashSummary | null;
  /** A conferência: do fechamento, ou a contagem cega já registrada. */
  counts: CountRow[];
  /** Contagem cega registrada, esperando a justificativa. */
  pendingCount: boolean;
  movements: CashMovementRow[];
  byProfessional: { name: string; cents: number }[];
}

const manages = (ctx: FinContext) => ctx.can('fin_caixas_outros');

async function names(ctx: FinContext, userIds: string[], unitIds: (string | null)[]) {
  const uids = [...new Set(userIds)];
  const nids = [...new Set(unitIds.filter((x): x is string => Boolean(x)))];
  const [users, units, totalUnits] = await Promise.all([
    uids.length ? ctx.db.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true } }) : [],
    nids.length ? ctx.db.clinicUnit.findMany({ where: { id: { in: nids } }, select: { id: true, name: true } }) : [],
    ctx.db.clinicUnit.count({ where: { active: true } }),
  ]);
  const u = new Map(users.map((x) => [x.id, x.name]));
  const n = new Map(units.map((x) => [x.id, x.name]));
  return { user: (id: string | null) => (id ? (u.get(id) ?? 'Usuário removido') : ''), unit: (id: string | null) => (totalUnits > 1 && id ? (n.get(id) ?? null) : null) };
}

/** Uma sessão de caixa por inteiro: cabeçalho, esperado, conferência e movimentos. */
export async function cashView(ctx: FinContext, sessionId: string): Promise<CashView | null> {
  const s = await ctx.db.cashSession.findFirst({ where: { id: sessionId }, include: { account: { select: { name: true } }, counts: true } });
  if (!s) return null;
  if (s.userId !== ctx.userId && !manages(ctx)) return null;

  const txs = await ctx.db.financialTransaction.findMany({
    where: { cashSessionId: s.id },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, kind: true, methodKind: true, methodId: true, signedAmount: true, description: true, patientId: true, contactId: true, createdAt: true, reversedAt: true, title: { select: { professionalId: true, description: true } } },
  });
  const ids = <T,>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => Boolean(x)))];
  const [nm, metodos, pacientes, contatos, profissionais] = await Promise.all([
    names(ctx, [s.userId, ...(s.closedById ? [s.closedById] : [])], [s.unitId]),
    ctx.db.finPaymentMethod.findMany({ where: { id: { in: ids(txs.map((t) => t.methodId)) } }, select: { id: true, name: true } }),
    ctx.db.patient.findMany({ where: { id: { in: ids(txs.map((t) => t.patientId)) } }, select: { id: true, name: true } }),
    ctx.db.finContact.findMany({ where: { id: { in: ids(txs.map((t) => t.contactId)) } }, select: { id: true, name: true } }),
    ctx.db.professional.findMany({ where: { id: { in: ids(txs.map((t) => t.title?.professionalId ?? null)) } }, select: { id: true, name: true } }),
  ]);
  const de = (lista: { id: string; name: string }[]) => new Map(lista.map((x) => [x.id, x.name]));
  const metodo = de(metodos);
  const paciente = de(pacientes);
  const contato = de(contatos);
  const profissional = de(profissionais);

  const linhas = txs.map((t) => ({ kind: t.kind, methodKind: t.methodKind, signedAmount: toCents(t.signedAmount) }));
  const esperado = expectedCash(toCents(s.openingAmount), linhas);
  const aberto = s.status === 'OPEN';
  const cega = aberto && ctx.settings.blindCashCount && !manages(ctx);

  const contado: Counted = { ...ZERO_COUNT };
  for (const c of s.counts) if ((COUNT_GROUPS as readonly string[]).includes(c.methodKind)) contado[c.methodKind as CountGroup] = toCents(c.counted);
  // Fechado: o esperado é o gravado no fechamento. Aberto com contagem cega registrada: o de agora.
  const esperadoGravado: Counted = { ...ZERO_COUNT };
  for (const c of s.counts) if ((COUNT_GROUPS as readonly string[]).includes(c.methodKind)) esperadoGravado[c.methodKind as CountGroup] = toCents(c.expected);
  const counts = s.counts.length ? countRows(aberto ? esperado : esperadoGravado, contado) : [];

  const porProfissional = new Map<string, number>();
  for (const t of txs) {
    if (t.kind !== 'RECEIPT' && t.kind !== 'REVERSAL') continue;
    if (t.methodKind === 'WALLET') continue;
    const nome = t.title?.professionalId ? (profissional.get(t.title.professionalId) ?? 'Profissional removido') : 'Sem profissional';
    porProfissional.set(nome, (porProfissional.get(nome) ?? 0) + toCents(t.signedAmount));
  }

  return {
    id: s.id,
    code: s.code,
    status: s.status,
    mine: s.userId === ctx.userId,
    userName: nm.user(s.userId),
    unitName: nm.unit(s.unitId),
    accountId: s.accountId,
    accountName: s.account.name,
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt?.toISOString() ?? null,
    closedByName: s.closedById ? nm.user(s.closedById) : null,
    openingCents: toCents(s.openingAmount),
    daysOpen: daysBetween(clinicDayOf(s.openedAt) as Day, clinicToday() as Day),
    blind: aberto ? ctx.settings.blindCashCount : s.blind,
    closingNote: s.closingNote,
    expected: cega && !s.counts.length ? null : aberto ? esperado : s.counts.length ? esperadoGravado : esperado,
    summary: cega ? null : cashSummary(linhas),
    counts: cega && !s.counts.length ? [] : counts,
    pendingCount: aberto && s.counts.length > 0,
    movements: txs.map((t) => ({
      id: t.id,
      code: t.code,
      kind: t.kind,
      methodKind: t.methodKind,
      methodName: t.methodId ? (metodo.get(t.methodId) ?? '') : '',
      signedCents: toCents(t.signedAmount),
      description: t.description ?? t.title?.description ?? '',
      party: t.patientId ? (paciente.get(t.patientId) ?? '') : t.contactId ? (contato.get(t.contactId) ?? '') : '',
      at: t.createdAt.toISOString(),
      reversed: Boolean(t.reversedAt),
    })),
    byProfessional: [...porProfissional.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents),
  };
}

export interface CashListRow {
  id: string;
  code: number;
  userName: string;
  unitName: string | null;
  mine: boolean;
  openedAt: string;
  closedAt: string | null;
  daysOpen: number;
  differenceCents: number;
  hasDifference: boolean;
  tooLong: boolean;
}

type Row = { id: string; code: number; userId: string; unitId: string | null; openedAt: Date; closedAt: Date | null; difference: unknown; closingNote: string | null };

async function toRows(ctx: FinContext, lista: Row[]): Promise<CashListRow[]> {
  const nm = await names(ctx, lista.map((s) => s.userId), lista.map((s) => s.unitId));
  const hoje = clinicToday() as Day;
  return lista.map((s) => {
    const dias = daysBetween(clinicDayOf(s.openedAt) as Day, hoje);
    return {
      id: s.id,
      code: s.code,
      userName: nm.user(s.userId),
      unitName: nm.unit(s.unitId),
      mine: s.userId === ctx.userId,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      daysOpen: dias,
      differenceCents: s.difference == null ? 0 : toCents(s.difference as never),
      hasDifference: Boolean(s.closingNote),
      tooLong: !s.closedAt && openTooLong(dias, ctx.settings.openCashAlertDays),
    };
  });
}

const LISTA = { id: true, code: true, userId: true, unitId: true, openedAt: true, closedAt: true, difference: true, closingNote: true } as const;

/** Caixas abertos: todos para quem gerencia, senão só os da própria pessoa. */
export async function openCashList(ctx: FinContext): Promise<CashListRow[]> {
  const lista = await ctx.db.cashSession.findMany({ where: { status: 'OPEN', ...(manages(ctx) ? {} : { userId: ctx.userId }) }, orderBy: { openedAt: 'asc' }, select: LISTA });
  return toRows(ctx, lista);
}

export interface ClosedFilters {
  from: Day;
  to: Day;
  userId?: string;
  onlyDifference?: boolean;
  page?: number;
}

export const CLOSED_PAGE = 30;

/** Caixas fechados no período (pela data do fechamento, no horário da clínica). */
export async function closedCashList(ctx: FinContext, f: ClosedFilters): Promise<{ rows: CashListRow[]; total: number; users: { id: string; name: string }[] }> {
  // O dia da clínica começa às 3 h UTC (Brasília não tem horário de verão).
  const inicio = new Date(`${f.from}T03:00:00.000Z`);
  const fim = new Date(`${addDays(f.to, 1)}T03:00:00.000Z`);
  const where = {
    status: 'CLOSED' as const,
    closedAt: { gte: inicio, lt: fim },
    ...(manages(ctx) ? (f.userId ? { userId: f.userId } : {}) : { userId: ctx.userId }),
    ...(f.onlyDifference ? { closingNote: { not: null } } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [lista, total, quem] = await Promise.all([
    ctx.db.cashSession.findMany({ where, orderBy: { closedAt: 'desc' }, skip: (page - 1) * CLOSED_PAGE, take: CLOSED_PAGE, select: LISTA }),
    ctx.db.cashSession.count({ where }),
    manages(ctx) ? ctx.db.cashSession.findMany({ distinct: ['userId'], select: { userId: true } }) : [],
  ]);
  const users = quem.length ? await ctx.db.user.findMany({ where: { id: { in: quem.map((q) => q.userId) } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }) : [];
  return { rows: await toRows(ctx, lista), total, users };
}

export interface CashAlerts {
  /** Abertos há mais dias que o limite da clínica. */
  openLong: CashListRow[];
  /** Fechados com diferença nos últimos 14 dias e ainda não vistos por um dono ou administrador. */
  withDifference: CashListRow[];
}

/** Os avisos do caixa. Quem não gerencia só vê o aviso do próprio caixa aberto. */
export async function cashAlerts(ctx: FinContext): Promise<CashAlerts> {
  const abertos = await openCashList(ctx);
  const openLong = abertos.filter((c) => c.tooLong);
  if (!manages(ctx) || !ctx.settings.alertCashDifference) return { openLong, withDifference: [] };
  const desde = dayToDate(addDays(clinicToday() as Day, -14));
  const comDiferenca = await ctx.db.cashSession.findMany({ where: { status: 'CLOSED', closingNote: { not: null }, closedAt: { gte: desde } }, orderBy: { closedAt: 'desc' }, select: LISTA });
  if (!comDiferenca.length) return { openLong, withDifference: [] };
  const vistos = await ctx.db.auditLog.findMany({ where: { entity: 'CashSession', action: 'REVIEW', entityId: { in: comDiferenca.map((c) => c.id) } }, select: { entityId: true } });
  const visto = new Set(vistos.map((v) => v.entityId));
  return { openLong, withDifference: await toRows(ctx, comDiferenca.filter((c) => !visto.has(c.id))) };
}

/** Quantos avisos de caixa esta pessoa tem (o número na aba "Caixa"). */
export async function cashAlertCount(ctx: FinContext): Promise<number> {
  if (!ctx.can('fin_caixa')) return 0;
  const a = await cashAlerts(ctx);
  return a.openLong.length + a.withDifference.length;
}

/** Sugestão de troco inicial: o dinheiro contado no último fechamento desta pessoa nesta unidade. */
export async function suggestedOpening(ctx: FinContext): Promise<number> {
  const ultimo = await ctx.db.cashSession.findFirst({ where: { userId: ctx.userId, unitId: ctx.unitId, status: 'CLOSED' }, orderBy: { closedAt: 'desc' }, select: { counts: { where: { methodKind: 'CASH' }, select: { counted: true } } } });
  return ultimo?.counts[0] ? toCents(ultimo.counts[0].counted) : 0;
}

/** As contas para abrir o caixa (caixas internos) e para o destino da sangria ou a origem do reforço. */
export async function cashAccounts(ctx: FinContext): Promise<{ cash: { id: string; name: string }[]; all: { id: string; name: string }[] }> {
  const contas = await ctx.db.financialAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true, kind: true } });
  return { cash: contas.filter((c) => c.kind === 'CASH').map(({ id, name }) => ({ id, name })), all: contas.map(({ id, name }) => ({ id, name })) };
}
