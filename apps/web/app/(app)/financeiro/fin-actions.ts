'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@clinicaiq/db';
import { finRead, finWrite, type FinContext } from '@/fin/guard';
import { ensureLegacyMigrated } from '@/fin/quotes';
import { relatedTransactions, reverseTransactionTx } from '@/fin/reverse';
import { settleTitleTx, type SettleLine, type SettleResult } from '@/fin/settle';
import { ensureFinanceSetup } from '@/fin/setup';
import { cancelTitle, createRecurrence, createTitles, updateTitle, type TitleInput } from '@/fin/titles';
import { accountAllowed, discountLimitPercent } from '@/lib/financeiro/access';
import { addDays, dateToDay, dayToDate, isCompetence, isDay } from '@/lib/financeiro/dates';
import { lateCharges } from '@/lib/financeiro/interest';
import { toCents } from '@/lib/financeiro/money';
import { displayStatus, type TitleDisplay } from '@/lib/financeiro/title-status';
import { clinicToday } from '@/lib/tz';

/**
 * Ações do financeiro completo: contas a receber e a pagar, recebimento,
 * movimentações, estornos e liberações. Toda ação passa por `finRead` ou
 * `finWrite` (login, bandeira, perfil, permissão do usuário e, ao gravar, se a
 * conta pode gravar).
 */

export type ActionResult<T = undefined> = (T extends undefined ? { ok: true } : { ok: true; data: T }) | { ok: false; message: string; code?: string };

const fail = (message: string, code?: string) => ({ ok: false as const, message, code });

async function ready(ctx: FinContext) {
  await ensureFinanceSetup(ctx.tenantId);
  await ensureLegacyMigrated(ctx.tenantId);
}

const env = (ctx: FinContext) => ({
  tenantId: ctx.tenantId,
  userId: ctx.userId,
  access: { role: ctx.role, permission: ctx.permission, professionalSeesCommissions: ctx.settings.professionalSeesCommissions },
  settings: ctx.settings,
  today: clinicToday(),
});

function refresh(patientId?: string | null) {
  revalidatePath('/financeiro', 'layout');
  revalidatePath('/orcamentos');
  revalidatePath('/dashboard');
  if (patientId) revalidatePath(`/pacientes/${patientId}`);
}

// ─── Lista de contas ─────────────────────────────────────────────────────────

const PAGE = 50;

const listSchema = z.object({
  tab: z.enum(['RECEIVABLE', 'PAYABLE', 'ALL']).default('RECEIVABLE'),
  view: z.enum(['open', 'overdue', 'paid', 'all']).default('open'),
  dateField: z.enum(['dueDate', 'issueDate', 'competence']).default('dueDate'),
  from: z.string().optional(),
  to: z.string().optional(),
  party: z.string().trim().max(80).optional(),
  patientId: z.string().optional(),
  contactId: z.string().optional(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
  methodId: z.string().optional(),
  origin: z.string().optional(),
  originCode: z.string().trim().max(40).optional(),
  professionalId: z.string().optional(),
  createdById: z.string().optional(),
  unitId: z.string().optional(),
  minCents: z.number().int().optional(),
  maxCents: z.number().int().optional(),
  description: z.string().trim().max(80).optional(),
  document: z.string().trim().max(40).optional(),
  page: z.number().int().min(1).default(1),
});

export type TitleFilters = z.input<typeof listSchema>;

const ORIGINS = ['MANUAL', 'APPOINTMENT', 'QUOTE', 'COMMISSION', 'CARD_FEE', 'RENEGOTIATION', 'WALLET', 'RECURRENCE', 'TRANSFER'] as const;

function titleWhere(f: z.output<typeof listSchema>, today: string): Prisma.FinancialTitleWhereInput {
  const and: Prisma.FinancialTitleWhereInput[] = [];
  if (f.tab !== 'ALL') and.push({ direction: f.tab });
  if (f.view === 'open') and.push({ status: { in: ['OPEN', 'PARTIAL'] } });
  if (f.view === 'overdue') and.push({ status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: dayToDate(today) } });
  if (f.view === 'paid') and.push({ status: 'PAID' });
  if (f.view === 'all') and.push({ status: { not: 'CANCELLED' } });
  if (f.dateField === 'competence') {
    const de = f.from && isDay(f.from) ? f.from.slice(0, 7) : undefined;
    const ate = f.to && isDay(f.to) ? f.to.slice(0, 7) : undefined;
    if (de || ate) and.push({ competence: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } });
  } else {
    const range: Prisma.DateTimeFilter = {};
    if (f.from && isDay(f.from)) range.gte = dayToDate(f.from);
    if (f.to && isDay(f.to)) range.lte = dayToDate(f.to);
    if (range.gte || range.lte) and.push({ [f.dateField]: range });
  }
  if (f.party) and.push({ OR: [{ patient: { name: { contains: f.party, mode: 'insensitive' } } }, { contact: { name: { contains: f.party, mode: 'insensitive' } } }] });
  if (f.patientId) and.push({ patientId: f.patientId });
  if (f.contactId) and.push({ contactId: f.contactId });
  if (f.categoryId) and.push({ OR: [{ categoryId: f.categoryId }, { category: { parentId: f.categoryId } }] });
  if (f.accountId) and.push({ accountId: f.accountId });
  if (f.methodId) and.push({ methodId: f.methodId });
  if (f.origin && (ORIGINS as readonly string[]).includes(f.origin)) and.push({ origin: f.origin as (typeof ORIGINS)[number] });
  if (f.professionalId) and.push({ professionalId: f.professionalId });
  if (f.createdById) and.push({ createdById: f.createdById });
  if (f.unitId) and.push({ unitId: f.unitId });
  if (f.minCents != null) and.push({ amount: { gte: f.minCents / 100 } });
  if (f.maxCents != null) and.push({ amount: { lte: f.maxCents / 100 } });
  if (f.description) and.push({ description: { contains: f.description, mode: 'insensitive' } });
  if (f.document) and.push({ OR: [{ documentNumber: { contains: f.document, mode: 'insensitive' } }, { document: { contains: f.document, mode: 'insensitive' } }] });
  if (f.originCode) {
    const n = Number(f.originCode.replace(/\D/g, ''));
    and.push({ OR: [{ originId: f.originCode }, ...(Number.isInteger(n) && n > 0 ? [{ code: n }] : [])] });
  }
  return { AND: and };
}

export interface TitleRow {
  id: string;
  code: number;
  direction: 'RECEIVABLE' | 'PAYABLE';
  origin: string;
  originId: string | null;
  quoteId: string | null;
  appointmentId: string | null;
  patientId: string | null;
  party: string;
  category: string;
  description: string | null;
  issueDate: string;
  dueDate: string;
  competence: string;
  amountCents: number;
  paidCents: number;
  openCents: number;
  status: string;
  display: TitleDisplay;
  installment: string | null;
  recurring: boolean;
}

const TITLE_LIST_SELECT = {
  id: true,
  code: true,
  direction: true,
  origin: true,
  originId: true,
  quoteId: true,
  appointmentId: true,
  patientId: true,
  description: true,
  issueDate: true,
  dueDate: true,
  competence: true,
  amount: true,
  paidAmount: true,
  status: true,
  installmentNumber: true,
  installmentTotal: true,
  recurrenceId: true,
  patient: { select: { name: true } },
  contact: { select: { name: true } },
  category: { select: { name: true } },
} satisfies Prisma.FinancialTitleSelect;

type TitleListRow = Prisma.FinancialTitleGetPayload<{ select: typeof TITLE_LIST_SELECT }>;

function toRow(t: TitleListRow, today: string): TitleRow {
  const amountCents = toCents(t.amount);
  const paidCents = toCents(t.paidAmount);
  const dueDate = dateToDay(t.dueDate);
  return {
    id: t.id,
    code: t.code,
    direction: t.direction,
    origin: t.origin,
    originId: t.originId,
    quoteId: t.quoteId,
    appointmentId: t.appointmentId,
    patientId: t.patientId,
    party: t.patient?.name ?? t.contact?.name ?? '',
    category: t.category.name,
    description: t.description,
    issueDate: dateToDay(t.issueDate),
    dueDate,
    competence: t.competence,
    amountCents,
    paidCents,
    openCents: Math.max(0, amountCents - paidCents),
    status: t.status,
    display: displayStatus(t.status, dueDate, today),
    installment: t.installmentTotal > 1 ? `${t.installmentNumber}/${t.installmentTotal}` : null,
    recurring: Boolean(t.recurrenceId),
  };
}

export interface TitleList {
  rows: TitleRow[];
  total: number;
  pages: number;
  /** Resultado do período, com os mesmos filtros: o que falta receber, o que falta pagar e o saldo. */
  totals: { receivableCents: number; payableCents: number; balanceCents: number };
}

export async function listTitles(filters: TitleFilters): Promise<TitleList> {
  const vazio: TitleList = { rows: [], total: 0, pages: 0, totals: { receivableCents: 0, payableCents: 0, balanceCents: 0 } };
  const gate = await finRead('fin_ver');
  if (!gate.ok) return vazio;
  const parsed = listSchema.safeParse(filters);
  if (!parsed.success) return vazio;
  const f = parsed.data;
  const { db } = gate.ctx;
  await ready(gate.ctx);
  const today = clinicToday();
  const where = titleWhere(f, today);

  const [rows, total, somas] = await Promise.all([
    db.financialTitle.findMany({ where, select: TITLE_LIST_SELECT, orderBy: [{ dueDate: 'asc' }, { code: 'asc' }], skip: (f.page - 1) * PAGE, take: PAGE }),
    db.financialTitle.count({ where }),
    db.financialTitle.groupBy({ by: ['direction'], where, _sum: { amount: true, paidAmount: true } }),
  ]);
  const aberto = (d: 'RECEIVABLE' | 'PAYABLE') => {
    const s = somas.find((x) => x.direction === d);
    return s ? toCents(s._sum.amount) - toCents(s._sum.paidAmount) : 0;
  };
  const receivableCents = aberto('RECEIVABLE');
  const payableCents = aberto('PAYABLE');
  return { rows: rows.map((t) => toRow(t, today)), total, pages: Math.ceil(total / PAGE), totals: { receivableCents, payableCents, balanceCents: receivableCents - payableCents } };
}

/** As linhas para exportar (até 5.000), com os mesmos filtros da tela. */
export async function exportTitles(filters: TitleFilters): Promise<TitleRow[]> {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return [];
  const parsed = listSchema.safeParse(filters);
  if (!parsed.success) return [];
  const today = clinicToday();
  const rows = await gate.ctx.db.financialTitle.findMany({ where: titleWhere(parsed.data, today), select: TITLE_LIST_SELECT, orderBy: [{ dueDate: 'asc' }, { code: 'asc' }], take: 5000 });
  return rows.map((t) => toRow(t, today));
}

// ─── Detalhe ─────────────────────────────────────────────────────────────────

export async function getTitle(id: string) {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return null;
  const { db } = gate.ctx;
  const today = clinicToday();
  const t = await db.financialTitle.findFirst({
    where: { id },
    include: {
      patient: { select: { name: true } },
      contact: { select: { name: true } },
      category: { select: { name: true } },
      allocations: true,
      transactions: { orderBy: { code: 'asc' } },
    },
  });
  if (!t) return null;
  const [conta, forma, centro, criador, anexos, formas, categorias, centros] = await Promise.all([
    t.accountId ? db.financialAccount.findFirst({ where: { id: t.accountId }, select: { name: true } }) : null,
    t.methodId ? db.finPaymentMethod.findFirst({ where: { id: t.methodId }, select: { name: true } }) : null,
    t.costCenterId ? db.costCenter.findFirst({ where: { id: t.costCenterId }, select: { name: true } }) : null,
    t.createdById ? db.user.findFirst({ where: { id: t.createdById }, select: { name: true } }) : null,
    db.financialAttachment.findMany({ where: { titleId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, filename: true, sizeBytes: true, createdAt: true } }),
    db.finPaymentMethod.findMany({ where: { id: { in: t.transactions.map((m) => m.methodId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
    db.financialCategory.findMany({ where: { id: { in: t.allocations.map((a) => a.categoryId) } }, select: { id: true, name: true } }),
    db.costCenter.findMany({ where: { id: { in: t.allocations.map((a) => a.costCenterId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
  ]);
  const nomeForma = new Map(formas.map((f) => [f.id, f.name]));
  const nomeCat = new Map(categorias.map((c) => [c.id, c.name]));
  const nomeCentro = new Map(centros.map((c) => [c.id, c.name]));
  const amountCents = toCents(t.amount);
  const paidCents = toCents(t.paidAmount);
  const dueDate = dateToDay(t.dueDate);
  return {
    id: t.id,
    code: t.code,
    direction: t.direction,
    origin: t.origin,
    originId: t.originId,
    quoteId: t.quoteId,
    appointmentId: t.appointmentId,
    patientId: t.patientId,
    contactId: t.contactId,
    professionalId: t.professionalId,
    party: t.patient?.name ?? t.contact?.name ?? '',
    categoryId: t.categoryId,
    category: t.category.name,
    costCenterId: t.costCenterId,
    costCenter: centro?.name ?? null,
    accountId: t.accountId,
    account: conta?.name ?? null,
    methodId: t.methodId,
    method: forma?.name ?? null,
    issueDate: dateToDay(t.issueDate),
    dueDate,
    competence: t.competence,
    amountCents,
    paidCents,
    openCents: Math.max(0, amountCents - paidCents),
    status: t.status,
    display: displayStatus(t.status, dueDate, today),
    installment: t.installmentTotal > 1 ? `${t.installmentNumber}/${t.installmentTotal}` : null,
    recurring: Boolean(t.recurrenceId),
    document: t.document,
    documentNumber: t.documentNumber,
    description: t.description,
    cancelReason: t.cancelReason,
    createdBy: criador?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    allocations: t.allocations.map((a) => ({ category: nomeCat.get(a.categoryId) ?? '', costCenter: a.costCenterId ? (nomeCentro.get(a.costCenterId) ?? '') : null, amountCents: toCents(a.amount) })),
    transactions: t.transactions.map((m) => ({
      id: m.id,
      code: m.code,
      kind: m.kind,
      method: m.methodId ? (nomeForma.get(m.methodId) ?? '') : '',
      paidOn: dateToDay(m.paidOn),
      amountCents: toCents(m.amount),
      discountCents: toCents(m.discount),
      extraCents: toCents(m.surcharge) + toCents(m.interest) + toCents(m.fine),
      reversed: Boolean(m.reversedAt),
      reverseReason: m.reverseReason,
      receiptGroupId: m.receiptGroupId,
    })),
    attachments: anexos.map((a) => ({ id: a.id, filename: a.filename, sizeBytes: a.sizeBytes, createdAt: a.createdAt.toISOString() })),
  };
}

export type TitleDetail = NonNullable<Awaited<ReturnType<typeof getTitle>>>;

// ─── Novo título ─────────────────────────────────────────────────────────────

const day = z.string().refine(isDay, 'Data inválida.');
const cents = z.number().int().positive('O valor precisa ser maior que zero.');

const newTitleSchema = z.object({
  direction: z.enum(['RECEIVABLE', 'PAYABLE']),
  patientId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  professionalId: z.string().optional().nullable(),
  unitId: z.string().optional().nullable(),
  categoryId: z.string().min(1, 'Escolha a categoria.'),
  costCenterId: z.string().optional().nullable(),
  accountId: z.string().optional().nullable(),
  methodId: z.string().optional().nullable(),
  issueDate: day,
  dueDate: day,
  competence: z.string().refine(isCompetence, 'Confira o mês de competência.').optional().nullable(),
  amountCents: cents,
  document: z.string().trim().max(40).optional().nullable(),
  documentNumber: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(300).optional().nullable(),
  allocations: z.array(z.object({ categoryId: z.string(), costCenterId: z.string().optional().nullable(), amount: cents })).max(20).optional(),
  schedule: z.array(z.object({ dueDate: day, amountCents: cents })).max(60).optional(),
  recurrence: z
    .object({
      every: z.number().int().min(1).max(365),
      unit: z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR']),
      start: day,
      end: day.optional().nullable(),
      occurrences: z.number().int().min(1).max(240).optional().nullable(),
    })
    .optional()
    .nullable(),
});

export type NewTitleInput = z.input<typeof newTitleSchema>;

export async function createTitleAction(input: NewTitleInput): Promise<ActionResult<{ created: number; firstId: string | null }>> {
  const parsed = newTitleSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const d = parsed.data;
  const gate = await finWrite(d.direction === 'RECEIVABLE' ? 'fin_receber' : 'fin_pagar');
  if (!gate.ok) return gate;
  const { ctx } = gate;
  await ready(ctx);
  if (d.recurrence && d.schedule && d.schedule.length > 1) return fail('Escolha entre parcelar e repetir: um lançamento não faz os dois.');
  if (d.accountId && !accountAllowed({ role: ctx.role, permission: ctx.permission }, d.accountId)) return fail('Seu acesso não permite usar esta conta.');

  const titulo: TitleInput = {
    direction: d.direction,
    patientId: d.patientId || null,
    contactId: d.contactId || null,
    professionalId: d.professionalId || null,
    unitId: d.unitId || null,
    categoryId: d.categoryId,
    costCenterId: d.costCenterId || null,
    accountId: d.accountId || null,
    methodId: d.methodId || null,
    issueDate: d.issueDate,
    dueDate: d.dueDate,
    competence: d.competence || null,
    amountCents: d.amountCents,
    document: d.document || null,
    documentNumber: d.documentNumber || null,
    description: d.description || null,
    allocations: d.allocations?.map((a) => ({ categoryId: a.categoryId, costCenterId: a.costCenterId || null, amount: a.amount })),
    schedule: d.schedule && d.schedule.length > 1 ? d.schedule : undefined,
  };
  const actor = { tenantId: ctx.tenantId, userId: ctx.userId, db: ctx.db };

  if (d.recurrence) {
    const r = await createRecurrence(actor, titulo, { every: d.recurrence.every, unit: d.recurrence.unit, start: d.recurrence.start, end: d.recurrence.end || null, occurrences: d.recurrence.occurrences ?? null });
    if (!r.ok) return r;
    refresh(d.patientId);
    return { ok: true, data: { created: r.data.created, firstId: null } };
  }
  const r = await createTitles(actor, titulo);
  if (!r.ok) return r;
  refresh(d.patientId);
  return { ok: true, data: { created: r.data.ids.length, firstId: r.data.ids[0] ?? null } };
}

const editSchema = z.object({
  id: z.string(),
  scope: z.enum(['one', 'following']).default('one'),
  categoryId: z.string().optional(),
  costCenterId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  methodId: z.string().nullable().optional(),
  dueDate: day.optional(),
  competence: z.string().refine(isCompetence).optional(),
  amountCents: cents.optional(),
  document: z.string().trim().max(40).nullable().optional(),
  documentNumber: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  contactId: z.string().nullable().optional(),
  professionalId: z.string().nullable().optional(),
});

export async function updateTitleAction(input: z.input<typeof editSchema>): Promise<ActionResult> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const { id, scope, ...edit } = parsed.data;
  const gate = await finWrite('fin_ver');
  if (!gate.ok) return gate;
  const { ctx } = gate;
  const t = await ctx.db.financialTitle.findFirst({ where: { id }, select: { direction: true, patientId: true } });
  if (!t) return fail('Conta não encontrada.');
  if (!ctx.can(t.direction === 'RECEIVABLE' ? 'fin_receber' : 'fin_pagar')) return fail('Seu acesso não permite editar esta conta.');
  const r = await updateTitle({ tenantId: ctx.tenantId, userId: ctx.userId, db: ctx.db }, id, edit, scope);
  if (r.ok) refresh(t.patientId);
  return r;
}

export async function cancelTitleAction(id: string, reason: string, scope: 'one' | 'following' = 'one'): Promise<ActionResult<{ cancelled: number }>> {
  const gate = await finWrite('fin_estornar');
  if (!gate.ok) return gate;
  const { ctx } = gate;
  const t = await ctx.db.financialTitle.findFirst({ where: { id }, select: { patientId: true } });
  const r = await cancelTitle({ tenantId: ctx.tenantId, userId: ctx.userId, db: ctx.db }, id, reason, scope);
  if (r.ok) refresh(t?.patientId);
  return r;
}

// ─── Receber e pagar ─────────────────────────────────────────────────────────

/** Tudo o que a tela de recebimento precisa para abrir já preenchida. */
export async function settleContext(titleId: string) {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return null;
  const { ctx } = gate;
  const { db, settings } = ctx;
  await ready(ctx);
  const t = await db.financialTitle.findFirst({ where: { id: titleId }, include: { patient: { select: { name: true } }, contact: { select: { name: true } } } });
  if (!t) return null;
  const receber = t.direction === 'RECEIVABLE';
  if (!ctx.can(receber ? 'fin_receber' : 'fin_pagar')) return null;
  const today = clinicToday();
  const openCents = Math.max(0, toCents(t.amount) - toCents(t.paidAmount));
  const dueDate = dateToDay(t.dueDate);
  const [formas, contas, carteira, caixa] = await Promise.all([
    db.finPaymentMethod.findMany({ where: { active: true, usage: { in: receber ? ['RECEIVE', 'BOTH'] : ['PAY', 'BOTH'] } }, orderBy: [{ order: 'asc' }, { name: 'asc' }], include: { fees: { orderBy: { upToInstallments: 'asc' } } } }),
    db.financialAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true, isDefault: true, kind: true } }),
    receber && t.patientId ? db.walletEntry.aggregate({ where: { patientId: t.patientId }, _sum: { amount: true } }) : null,
    db.cashSession.findFirst({ where: { userId: ctx.userId, status: 'OPEN' }, select: { id: true, accountId: true } }),
  ]);
  const acesso = { role: ctx.role, permission: ctx.permission };
  const atraso = receber && settings.lateChargesEnabled ? lateCharges(openCents, dueDate, today, { finePercent: settings.finePercent, dailyInterestPercent: settings.dailyInterestPercent }) : null;
  return {
    title: {
      id: t.id,
      code: t.code,
      direction: t.direction,
      party: t.patient?.name ?? t.contact?.name ?? '',
      patientId: t.patientId,
      description: t.description,
      dueDate,
      amountCents: toCents(t.amount),
      paidCents: toCents(t.paidAmount),
      openCents,
      status: t.status,
      methodId: t.methodId,
      accountId: t.accountId,
    },
    today,
    methods: formas
      .filter((f) => f.kind !== 'WALLET' || (receber && t.patientId))
      .map((f) => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        accountId: f.accountId,
        maxInstallments: f.maxInstallments,
        requireDocNumber: f.requireDocNumber,
        settlementType: f.settlementType,
        settlementValue: f.settlementValue,
        fees: f.fees.map((x) => ({ upToInstallments: x.upToInstallments, percent: x.percent == null ? null : Number(x.percent), fixedCents: x.fixed == null ? null : toCents(x.fixed) })),
      })),
    accounts: contas.filter((c) => accountAllowed(acesso, c.id)),
    walletCents: carteira ? toCents(carteira._sum.amount) : 0,
    cashSession: caixa,
    late: atraso && atraso.daysLate > 0 ? atraso : null,
    discountLimitPercent: receber ? discountLimitPercent(acesso, settings.defaultMaxDiscountPercent) : 100,
    requireCardData: settings.requireCardData,
    requireOpenCashForCash: settings.requireOpenCashForCash,
    canWaiveLate: ctx.role === 'OWNER' || ctx.role === 'ADMIN',
  };
}

export type SettleContext = NonNullable<Awaited<ReturnType<typeof settleContext>>>;

const lineSchema = z.object({
  methodId: z.string().min(1),
  accountId: z.string().optional().nullable(),
  amountCents: cents,
  paidOn: day,
  document: z.string().trim().max(40).optional().nullable(),
  documentNumber: z.string().trim().max(60).optional().nullable(),
  installments: z.number().int().min(1).max(24).optional(),
  cardBrand: z.string().trim().max(30).optional().nullable(),
  nsu: z.string().trim().max(40).optional().nullable(),
  checkBank: z.string().trim().max(40).optional().nullable(),
  checkNumber: z.string().trim().max(40).optional().nullable(),
  checkHolder: z.string().trim().max(80).optional().nullable(),
  checkDate: day.optional().nullable(),
});

const settleSchema = z.object({
  titleId: z.string(),
  expectedOpenCents: z.number().int().optional(),
  lines: z.array(lineSchema).min(1).max(10),
  discountCents: z.number().int().min(0).optional(),
  surchargeCents: z.number().int().min(0).optional(),
  interestCents: z.number().int().min(0).optional(),
  fineCents: z.number().int().min(0).optional(),
  change: z.enum(['RETURN', 'WALLET']).optional(),
  releaseId: z.string().optional().nullable(),
  description: z.string().trim().max(300).optional().nullable(),
});

export type SettleActionResult = SettleResult;

export async function settleAction(input: z.input<typeof settleSchema>): Promise<SettleActionResult> {
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Confira os campos.', code: 'INVALID' };
  const gate = await finWrite('fin_ver');
  if (!gate.ok) return { ok: false, message: gate.message, code: 'INVALID' };
  const { ctx } = gate;
  const t = await ctx.db.financialTitle.findFirst({ where: { id: parsed.data.titleId }, select: { direction: true, patientId: true } });
  if (!t) return { ok: false, message: 'Conta não encontrada.', code: 'INVALID' };
  if (!ctx.can(t.direction === 'RECEIVABLE' ? 'fin_receber' : 'fin_pagar')) {
    return { ok: false, message: t.direction === 'RECEIVABLE' ? 'Seu acesso não permite receber.' : 'Seu acesso não permite pagar contas.', code: 'INVALID' };
  }
  const r = await ctx.db.$transaction((tx) => settleTitleTx(tx, env(ctx), parsed.data as Parameters<typeof settleTitleTx>[2]));
  if (r.ok) {
    await ctx.db.auditLog.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, action: t.direction === 'RECEIVABLE' ? 'RECEIVE' : 'PAY', entity: 'FinancialTitle', entityId: parsed.data.titleId, metadata: { recibo: r.receiptGroupId, movimentos: r.transactionIds.length } } });
    refresh(t.patientId);
  }
  return r;
}

const batchSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  methodId: z.string().min(1),
  accountId: z.string().optional().nullable(),
  paidOn: day,
  document: z.string().trim().max(40).optional().nullable(),
  documentNumber: z.string().trim().max(60).optional().nullable(),
});

/** Baixa em lote: quita cada título pelo valor em aberto, com a mesma conta, data e documento. */
export async function settleBatchAction(input: z.input<typeof batchSchema>): Promise<ActionResult<{ done: number; skipped: { code: number; reason: string }[] }>> {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const gate = await finWrite('fin_ver');
  if (!gate.ok) return gate;
  const { ctx } = gate;
  const d = parsed.data;
  const titulos = await ctx.db.financialTitle.findMany({ where: { id: { in: d.ids } }, select: { id: true, code: true, direction: true, amount: true, paidAmount: true, status: true } });
  const skipped: { code: number; reason: string }[] = [];
  let done = 0;
  for (const t of titulos) {
    if (!ctx.can(t.direction === 'RECEIVABLE' ? 'fin_receber' : 'fin_pagar')) {
      skipped.push({ code: t.code, reason: 'Seu acesso não permite esta baixa.' });
      continue;
    }
    const aberto = toCents(t.amount) - toCents(t.paidAmount);
    if (aberto <= 0 || (t.status !== 'OPEN' && t.status !== 'PARTIAL')) {
      skipped.push({ code: t.code, reason: 'Já não tem valor em aberto.' });
      continue;
    }
    const line: SettleLine = { methodId: d.methodId, accountId: d.accountId || null, amountCents: aberto, paidOn: d.paidOn, document: d.document || null, documentNumber: d.documentNumber || null };
    const r = await ctx.db.$transaction((tx) => settleTitleTx(tx, env(ctx), { titleId: t.id, expectedOpenCents: aberto, lines: [line] }));
    if (r.ok) done += 1;
    else skipped.push({ code: t.code, reason: r.message });
  }
  if (done) {
    await ctx.db.auditLog.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, action: 'BATCH_SETTLE', entity: 'FinancialTitle', entityId: d.ids[0], metadata: { quantidade: done } } });
    refresh();
  }
  return { ok: true, data: { done, skipped } };
}

// ─── Movimentações e estornos ────────────────────────────────────────────────

const txListSchema = z.object({
  dateField: z.enum(['paidOn', 'competence']).default('paidOn'),
  from: z.string().optional(),
  to: z.string().optional(),
  direction: z.enum(['IN', 'OUT', 'ALL']).default('ALL'),
  accountId: z.string().optional(),
  methodId: z.string().optional(),
  categoryId: z.string().optional(),
  party: z.string().trim().max(80).optional(),
  origin: z.string().optional(),
  createdById: z.string().optional(),
  minCents: z.number().int().optional(),
  maxCents: z.number().int().optional(),
  document: z.string().trim().max(40).optional(),
  description: z.string().trim().max(80).optional(),
  reconciled: z.enum(['yes', 'no', 'all']).default('all'),
  onlyReversals: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
});

export type TxFilters = z.input<typeof txListSchema>;

function txWhere(f: z.output<typeof txListSchema>): Prisma.FinancialTransactionWhereInput {
  const and: Prisma.FinancialTransactionWhereInput[] = [];
  if (f.onlyReversals) and.push({ kind: 'REVERSAL' });
  if (f.dateField === 'competence') {
    const de = f.from && isDay(f.from) ? f.from.slice(0, 7) : undefined;
    const ate = f.to && isDay(f.to) ? f.to.slice(0, 7) : undefined;
    if (de || ate) and.push({ competence: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } });
  } else {
    const range: Prisma.DateTimeFilter = {};
    if (f.from && isDay(f.from)) range.gte = dayToDate(f.from);
    if (f.to && isDay(f.to)) range.lte = dayToDate(f.to);
    if (range.gte || range.lte) and.push({ paidOn: range });
  }
  if (f.direction === 'IN') and.push({ signedAmount: { gt: 0 } });
  if (f.direction === 'OUT') and.push({ signedAmount: { lt: 0 } });
  if (f.accountId) and.push({ accountId: f.accountId });
  if (f.methodId) and.push({ methodId: f.methodId });
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.origin && (ORIGINS as readonly string[]).includes(f.origin)) and.push({ origin: f.origin as (typeof ORIGINS)[number] });
  if (f.createdById) and.push({ createdById: f.createdById });
  if (f.minCents != null) and.push({ amount: { gte: f.minCents / 100 } });
  if (f.maxCents != null) and.push({ amount: { lte: f.maxCents / 100 } });
  if (f.document) and.push({ documentNumber: { contains: f.document, mode: 'insensitive' } });
  if (f.description) and.push({ description: { contains: f.description, mode: 'insensitive' } });
  if (f.reconciled === 'yes') and.push({ reconciledAt: { not: null } });
  if (f.reconciled === 'no') and.push({ reconciledAt: null });
  if (f.party) and.push({ title: { OR: [{ patient: { name: { contains: f.party, mode: 'insensitive' } } }, { contact: { name: { contains: f.party, mode: 'insensitive' } } }] } });
  return { AND: and };
}

export interface TxRow {
  id: string;
  code: number;
  kind: string;
  origin: string;
  titleId: string | null;
  titleCode: number | null;
  party: string;
  category: string;
  account: string;
  method: string;
  paidOn: string;
  competence: string;
  titleAmountCents: number | null;
  amountCents: number;
  signedCents: number;
  documentNumber: string | null;
  description: string | null;
  reversed: boolean;
  reverseReason: string | null;
  reconciled: boolean;
  receiptGroupId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface TxList {
  rows: TxRow[];
  total: number;
  pages: number;
  /** Entradas, saídas e saldo do período, por conta. */
  byAccount: { account: string; inCents: number; outCents: number }[];
}

export async function listTransactions(filters: TxFilters): Promise<TxList> {
  const vazio: TxList = { rows: [], total: 0, pages: 0, byAccount: [] };
  const gate = await finRead('fin_ver');
  if (!gate.ok) return vazio;
  const parsed = txListSchema.safeParse(filters);
  if (!parsed.success) return vazio;
  const f = parsed.data;
  const { db } = gate.ctx;
  await ready(gate.ctx);
  const where = txWhere(f);
  const [rows, total, entradas, saidas] = await Promise.all([
    db.financialTransaction.findMany({
      where,
      orderBy: [{ paidOn: 'desc' }, { code: 'desc' }],
      skip: (f.page - 1) * PAGE,
      take: PAGE,
      include: { title: { select: { code: true, amount: true, patient: { select: { name: true } }, contact: { select: { name: true } } } }, account: { select: { name: true } } },
    }),
    db.financialTransaction.count({ where }),
    db.financialTransaction.groupBy({ by: ['accountId'], where: { AND: [where, { signedAmount: { gt: 0 } }] }, _sum: { signedAmount: true } }),
    db.financialTransaction.groupBy({ by: ['accountId'], where: { AND: [where, { signedAmount: { lt: 0 } }] }, _sum: { signedAmount: true } }),
  ]);
  const ids = <T extends string | null>(xs: T[]) => [...new Set(xs.filter((x): x is NonNullable<T> => Boolean(x)))];
  const [cats, formas, pessoas, contas, pacientes] = await Promise.all([
    db.financialCategory.findMany({ where: { id: { in: ids(rows.map((r) => r.categoryId)) } }, select: { id: true, name: true } }),
    db.finPaymentMethod.findMany({ where: { id: { in: ids(rows.map((r) => r.methodId)) } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { id: { in: ids(rows.map((r) => r.createdById)) } }, select: { id: true, name: true } }),
    db.financialAccount.findMany({ select: { id: true, name: true } }),
    db.patient.findMany({ where: { id: { in: ids(rows.filter((r) => !r.title).map((r) => r.patientId)) } }, select: { id: true, name: true } }),
  ]);
  const nome = <T extends { id: string; name: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x.name]));
  const [nCat, nForma, nPessoa, nConta, nPaciente] = [nome(cats), nome(formas), nome(pessoas), nome(contas), nome(pacientes)];
  const porConta = new Map<string, { inCents: number; outCents: number }>();
  for (const e of entradas) porConta.set(e.accountId ?? '', { inCents: toCents(e._sum.signedAmount), outCents: 0 });
  for (const s of saidas) porConta.set(s.accountId ?? '', { inCents: porConta.get(s.accountId ?? '')?.inCents ?? 0, outCents: -toCents(s._sum.signedAmount) });
  return {
    rows: rows.map((m) => ({
      id: m.id,
      code: m.code,
      kind: m.kind,
      origin: m.origin,
      titleId: m.titleId,
      titleCode: m.title?.code ?? null,
      party: m.title?.patient?.name ?? m.title?.contact?.name ?? (m.patientId ? (nPaciente.get(m.patientId) ?? '') : ''),
      category: m.categoryId ? (nCat.get(m.categoryId) ?? '') : '',
      account: m.account?.name ?? (m.methodKind === 'WALLET' ? 'Carteira do paciente' : ''),
      method: m.methodId ? (nForma.get(m.methodId) ?? '') : '',
      paidOn: dateToDay(m.paidOn),
      competence: m.competence,
      titleAmountCents: m.title ? toCents(m.title.amount) : null,
      amountCents: toCents(m.amount),
      signedCents: toCents(m.signedAmount),
      documentNumber: m.documentNumber,
      description: m.description,
      reversed: Boolean(m.reversedAt),
      reverseReason: m.reverseReason,
      reconciled: Boolean(m.reconciledAt),
      receiptGroupId: m.receiptGroupId,
      createdBy: m.createdById ? (nPessoa.get(m.createdById) ?? '') : '',
      createdAt: m.createdAt.toISOString(),
    })),
    total,
    pages: Math.ceil(total / PAGE),
    byAccount: [...porConta.entries()].filter(([id]) => id).map(([id, v]) => ({ account: nConta.get(id) ?? '', ...v })),
  };
}

const txEditSchema = z.object({
  id: z.string(),
  categoryId: z.string().nullable().optional(),
  costCenterId: z.string().nullable().optional(),
  documentNumber: z.string().trim().max(60).nullable().optional(),
  paidOn: day.optional(),
  competence: z.string().refine(isCompetence).optional(),
  description: z.string().trim().max(300).nullable().optional(),
});

/** Edita o que não é valor: categoria, centro de custo, documento, data, competência e descrição. */
export async function updateTransactionAction(input: z.input<typeof txEditSchema>): Promise<ActionResult> {
  const parsed = txEditSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const gate = await finWrite('fin_estornar');
  if (!gate.ok) return gate;
  const { db, tenantId, userId } = gate.ctx;
  const { id, ...d } = parsed.data;
  const m = await db.financialTransaction.findFirst({ where: { id }, select: { id: true, kind: true, reversedAt: true, cashSessionId: true } });
  if (!m) return fail('Movimento não encontrado.');
  if (m.kind === 'REVERSAL' || m.reversedAt) return fail('Movimento estornado não pode ser editado.');
  if (d.paidOn && d.paidOn > clinicToday()) return fail('A data não pode ser no futuro.');
  if (d.paidOn && m.cashSessionId) {
    const caixa = await db.cashSession.findFirst({ where: { id: m.cashSessionId }, select: { status: true } });
    if (caixa?.status === 'CLOSED') return fail('Este movimento está num caixa já fechado: a data não muda.');
  }
  if (d.categoryId && !(await db.financialCategory.findFirst({ where: { id: d.categoryId }, select: { id: true } }))) return fail('Categoria não encontrada.');
  if (d.costCenterId && !(await db.costCenter.findFirst({ where: { id: d.costCenterId }, select: { id: true } }))) return fail('Centro de custo não encontrado.');
  await db.financialTransaction.update({
    where: { id },
    data: {
      ...(d.categoryId !== undefined ? { categoryId: d.categoryId } : {}),
      ...(d.costCenterId !== undefined ? { costCenterId: d.costCenterId } : {}),
      ...(d.documentNumber !== undefined ? { documentNumber: d.documentNumber || null } : {}),
      ...(d.paidOn ? { paidOn: dayToDate(d.paidOn) } : {}),
      ...(d.competence ? { competence: d.competence } : {}),
      ...(d.description !== undefined ? { description: d.description || null } : {}),
    },
  });
  await db.auditLog.create({ data: { tenantId, userId, action: 'UPDATE', entity: 'FinancialTransaction', entityId: id, metadata: d as Prisma.InputJsonValue } });
  refresh();
  return { ok: true };
}

/** O que vai junto num estorno: a taxa do cartão (sempre) e os outros meios do mesmo recebimento (a pessoa escolhe). */
export async function reverseContext(transactionId: string) {
  const gate = await finRead('fin_estornar');
  if (!gate.ok) return null;
  const { db, tenantId } = gate.ctx;
  const m = await db.financialTransaction.findFirst({ where: { id: transactionId }, include: { title: { select: { code: true, origin: true } } } });
  if (!m) return null;
  const relacionados = await db.$transaction((tx) => relatedTransactions(tx, tenantId, transactionId));
  return {
    id: m.id,
    code: m.code,
    kind: m.kind,
    amountCents: toCents(m.amount),
    titleCode: m.title?.code ?? null,
    related: relacionados.map((r) => ({ id: r.id, code: r.code, kind: r.kind, amountCents: toCents(r.amount), description: r.description, automatic: r.origin === 'CARD_FEE' && r.originId === m.id })),
  };
}

const reverseSchema = z.object({
  transactionId: z.string(),
  reason: z.string().trim().min(3, 'Diga o motivo do estorno.').max(150, 'O motivo tem no máximo 150 letras.'),
  alsoIds: z.array(z.string()).max(20).optional(),
  confirmOutOfOrder: z.boolean().optional(),
});

export async function reverseAction(input: z.input<typeof reverseSchema>): Promise<ActionResult<{ reversed: number }>> {
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const gate = await finWrite('fin_estornar');
  if (!gate.ok) return gate;
  const { ctx } = gate;
  const r = await ctx.db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: ctx.tenantId, userId: ctx.userId, today: clinicToday() }, parsed.data));
  if (!r.ok) return fail(r.message, r.code);
  await ctx.db.auditLog.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, action: 'REVERSE', entity: 'FinancialTransaction', entityId: parsed.data.transactionId, metadata: { motivo: parsed.data.reason, movimentos: r.reversedIds.length } } });
  const titulo = r.reopenedTitleIds[0] ? await ctx.db.financialTitle.findFirst({ where: { id: r.reopenedTitleIds[0] }, select: { patientId: true } }) : null;
  refresh(titulo?.patientId);
  return { ok: true, data: { reversed: r.reversedIds.length } };
}

// ─── Liberações ──────────────────────────────────────────────────────────────

const RELEASE_MINUTES = 30;

const releaseSchema = z.object({
  kind: z.enum(['DISCOUNT', 'WAIVE_LATE']),
  titleId: z.string(),
  amountCents: z.number().int().min(0).default(0),
  note: z.string().trim().max(150).optional(),
});

/** Pede a um dono ou administrador para passar do próprio limite (desconto, tirar juros). */
export async function requestRelease(input: z.input<typeof releaseSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const gate = await finWrite('fin_receber');
  if (!gate.ok) return gate;
  const { db, tenantId, userId } = gate.ctx;
  const d = parsed.data;
  const t = await db.financialTitle.findFirst({ where: { id: d.titleId }, select: { amount: true, paidAmount: true } });
  if (!t) return fail('Conta não encontrada.');
  const aberto = toCents(t.amount) - toCents(t.paidAmount);
  if (d.kind === 'DISCOUNT' && (d.amountCents <= 0 || d.amountCents > aberto)) return fail('Confira o valor do desconto.');
  const r = await db.financialRelease.create({
    data: { tenantId, kind: d.kind, titleId: d.titleId, payload: { amountCents: d.amountCents, openCents: aberto, note: d.note ?? '' }, requestedById: userId, expiresAt: new Date(Date.now() + RELEASE_MINUTES * 60_000) },
  });
  revalidatePath('/financeiro', 'layout');
  return { ok: true, data: { id: r.id } };
}

/** A pessoa que pediu fica olhando: aprovada, negada ou ainda esperando. */
export async function releaseStatus(id: string): Promise<'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | null> {
  const gate = await finRead('fin_receber');
  if (!gate.ok) return null;
  const r = await gate.ctx.db.financialRelease.findFirst({ where: { id, requestedById: gate.ctx.userId }, select: { status: true, expiresAt: true, usedAt: true } });
  if (!r) return null;
  if (r.status === 'PENDING' && r.expiresAt < new Date()) return 'EXPIRED';
  return r.status === 'APPROVED' || r.status === 'DENIED' ? r.status : 'PENDING';
}

export interface ReleaseRow {
  id: string;
  kind: string;
  status: string;
  requestedBy: string;
  titleCode: number | null;
  party: string;
  amountCents: number;
  openCents: number;
  note: string;
  createdAt: string;
  expired: boolean;
  decidedBy: string | null;
}

export async function listReleases(): Promise<ReleaseRow[]> {
  const gate = await finRead('fin_estornar');
  if (!gate.ok) return [];
  const { db } = gate.ctx;
  const desde = new Date(Date.now() - 7 * 86_400_000);
  const pedidos = await db.financialRelease.findMany({ where: { createdAt: { gte: desde } }, orderBy: { createdAt: 'desc' }, take: 100 });
  const [pessoas, titulos] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...new Set(pedidos.flatMap((p) => [p.requestedById, p.decidedById].filter((x): x is string => Boolean(x))))] } }, select: { id: true, name: true } }),
    db.financialTitle.findMany({ where: { id: { in: pedidos.map((p) => p.titleId).filter((x): x is string => Boolean(x)) } }, select: { id: true, code: true, patient: { select: { name: true } }, contact: { select: { name: true } } } }),
  ]);
  const nome = new Map(pessoas.map((p) => [p.id, p.name]));
  const titulo = new Map(titulos.map((t) => [t.id, t]));
  const agora = new Date();
  return pedidos.map((p) => {
    const payload = (p.payload ?? {}) as { amountCents?: number; openCents?: number; note?: string };
    const t = p.titleId ? titulo.get(p.titleId) : undefined;
    return {
      id: p.id,
      kind: p.kind,
      status: p.status,
      requestedBy: nome.get(p.requestedById) ?? '',
      titleCode: t?.code ?? null,
      party: t?.patient?.name ?? t?.contact?.name ?? '',
      amountCents: payload.amountCents ?? 0,
      openCents: payload.openCents ?? 0,
      note: payload.note ?? '',
      createdAt: p.createdAt.toISOString(),
      expired: p.status === 'PENDING' && p.expiresAt < agora,
      decidedBy: p.decidedById ? (nome.get(p.decidedById) ?? null) : null,
    };
  });
}

/** Quantos pedidos esperam resposta (o número ao lado de "Liberações"). */
export async function pendingReleases(): Promise<number> {
  const gate = await finRead('fin_estornar');
  if (!gate.ok) return 0;
  return gate.ctx.db.financialRelease.count({ where: { status: 'PENDING', expiresAt: { gt: new Date() } } });
}

export async function decideRelease(id: string, approve: boolean): Promise<ActionResult> {
  const gate = await finWrite('fin_estornar');
  if (!gate.ok) return gate;
  const { db, tenantId, userId, role } = gate.ctx;
  // Liberar é de dono e administrador, mesmo que alguém da recepção possa estornar.
  if (role !== 'OWNER' && role !== 'ADMIN') return fail('Só dono ou administrador libera.');
  const r = await db.financialRelease.findFirst({ where: { id }, select: { status: true, expiresAt: true, requestedById: true } });
  if (!r) return fail('Pedido não encontrado.');
  if (r.status !== 'PENDING') return fail('Este pedido já foi respondido.');
  if (r.expiresAt < new Date()) return fail('Este pedido venceu. Peça para a pessoa pedir de novo.');
  if (r.requestedById === userId) return fail('Quem pede não aprova o próprio pedido.');
  await db.financialRelease.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'DENIED', decidedById: userId, decidedAt: new Date(), expiresAt: new Date(Date.now() + RELEASE_MINUTES * 60_000) } });
  await db.auditLog.create({ data: { tenantId, userId, action: approve ? 'RELEASE_APPROVED' : 'RELEASE_DENIED', entity: 'FinancialRelease', entityId: id } });
  revalidatePath('/financeiro', 'layout');
  return { ok: true };
}

/** Atalho para as datas padrão da lista: 30 dias para trás e 30 para a frente. */
export async function defaultTitleRange(): Promise<{ from: string; to: string }> {
  const hoje = clinicToday();
  return { from: addDays(hoje, -30), to: addDays(hoje, 30) };
}
