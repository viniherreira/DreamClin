import 'server-only';

import { randomUUID } from 'node:crypto';
import type { Prisma, TenantPrismaClient } from '@clinicaiq/db';
import { checkAllocation, type AllocationPart } from '@/lib/financeiro/allocation';
import { addMonths, competenceOf, dayToDate, isCompetence, isDay, type Day } from '@/lib/financeiro/dates';
import { MAX_RECURRENCE_DATES, recurrenceDates, simulateInstallments, type InstallmentInterval, type RecurrenceSpec } from '@/lib/financeiro/installments';
import { fromCents, toCents } from '@/lib/financeiro/money';
import { clinicToday } from '@/lib/tz';
import { nextCode } from './codes';

/**
 * Títulos: criar (à vista, parcelado ou recorrente), editar e cancelar.
 * Regras de dinheiro em `lib/financeiro/`; aqui só o que precisa do banco.
 */

export type Tx = Parameters<Parameters<TenantPrismaClient['$transaction']>[0]>[0];

export interface FinActor {
  tenantId: string;
  userId: string | null;
  db: TenantPrismaClient;
}

export type FinResult<T = undefined> = (T extends undefined ? { ok: true } : { ok: true; data: T }) | { ok: false; message: string };

export const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

export type Origin = 'MANUAL' | 'APPOINTMENT' | 'QUOTE' | 'COMMISSION' | 'CARD_FEE' | 'RENEGOTIATION' | 'WALLET' | 'RECURRENCE' | 'TRANSFER';

export interface TitleInput {
  direction: 'RECEIVABLE' | 'PAYABLE';
  origin?: Origin;
  originId?: string | null;
  patientId?: string | null;
  contactId?: string | null;
  professionalId?: string | null;
  unitId?: string | null;
  appointmentId?: string | null;
  quoteId?: string | null;
  categoryId: string;
  costCenterId?: string | null;
  accountId?: string | null;
  methodId?: string | null;
  issueDate: Day;
  /** Vencimento (da primeira parcela, quando parcelado). */
  dueDate: Day;
  /** "AAAA-MM". Em branco, o mês do vencimento de cada parcela. */
  competence?: string | null;
  amountCents: number;
  document?: string | null;
  documentNumber?: string | null;
  description?: string | null;
  allocations?: AllocationPart[];
  /** Parcelamento: quantas e de quanto em quanto tempo. */
  installments?: number;
  interval?: InstallmentInterval;
  /** Tabela já simulada e ajustada na tela (substitui `installments`/`interval`). */
  schedule?: { dueDate: Day; amountCents: number }[];
  groupId?: string | null;
  recurrenceId?: string | null;
  renegotiationId?: string | null;
}

export const MAX_INSTALLMENTS = 60;
export const MAX_AMOUNT_CENTS = 99_999_999_99;

/** Confere as referências (categoria, conta, forma, pessoa) dentro da clínica. */
async function checkRefs(tx: Tx, tenantId: string, t: TitleInput): Promise<string | null> {
  const cat = await tx.financialCategory.findFirst({ where: { tenantId, id: t.categoryId }, select: { direction: true, active: true } });
  if (!cat) return 'Categoria não encontrada.';
  if (cat.direction !== t.direction) return t.direction === 'RECEIVABLE' ? 'Escolha uma categoria de receita.' : 'Escolha uma categoria de despesa.';
  if (t.costCenterId && !(await tx.costCenter.findFirst({ where: { tenantId, id: t.costCenterId }, select: { id: true } }))) return 'Centro de custo não encontrado.';
  if (t.accountId && !(await tx.financialAccount.findFirst({ where: { tenantId, id: t.accountId }, select: { id: true } }))) return 'Conta não encontrada.';
  if (t.methodId && !(await tx.finPaymentMethod.findFirst({ where: { tenantId, id: t.methodId }, select: { id: true } }))) return 'Forma de pagamento não encontrada.';
  if (t.patientId && !(await tx.patient.findFirst({ where: { tenantId, id: t.patientId }, select: { id: true } }))) return 'Paciente não encontrado.';
  if (t.contactId && !(await tx.finContact.findFirst({ where: { tenantId, id: t.contactId }, select: { id: true } }))) return 'Cliente ou fornecedor não encontrado.';
  if (t.professionalId && !(await tx.professional.findFirst({ where: { tenantId, id: t.professionalId }, select: { id: true } }))) return 'Profissional não encontrado.';
  if (t.unitId && !(await tx.clinicUnit.findFirst({ where: { tenantId, id: t.unitId }, select: { id: true } }))) return 'Unidade não encontrada.';
  for (const a of t.allocations ?? []) {
    const c = await tx.financialCategory.findFirst({ where: { tenantId, id: a.categoryId }, select: { direction: true } });
    if (!c || c.direction !== t.direction) return 'Uma categoria do rateio não serve para este tipo de conta.';
    if (a.costCenterId && !(await tx.costCenter.findFirst({ where: { tenantId, id: a.costCenterId }, select: { id: true } }))) return 'Um centro de custo do rateio não foi encontrado.';
  }
  return null;
}

function checkShape(t: TitleInput): string | null {
  if (!isDay(t.issueDate) || !isDay(t.dueDate)) return 'Confira as datas.';
  if (t.competence && !isCompetence(t.competence)) return 'Confira o mês de competência.';
  if (!Number.isInteger(t.amountCents) || t.amountCents <= 0) return 'O valor precisa ser maior que zero.';
  if (t.amountCents > MAX_AMOUNT_CENTS) return 'Valor alto demais.';
  if ((t.description ?? '').length > 300) return 'A descrição tem no máximo 300 letras.';
  const n = t.schedule ? t.schedule.length : (t.installments ?? 1);
  if (n < 1 || n > MAX_INSTALLMENTS) return `O parcelamento vai de 1 a ${MAX_INSTALLMENTS} parcelas.`;
  if (t.schedule) {
    if (t.schedule.some((p) => !isDay(p.dueDate) || !Number.isInteger(p.amountCents) || p.amountCents <= 0)) return 'Confira as parcelas.';
    if (t.schedule.reduce((s, p) => s + p.amountCents, 0) !== t.amountCents) return 'A soma das parcelas não bate com o valor.';
  }
  const rateio = checkAllocation(t.amountCents, t.allocations ?? []);
  if (!rateio.ok) return rateio.message;
  return null;
}

/** As linhas de um título (à vista ou parcelado), prontas para gravar. */
function titleRows(tenantId: string, userId: string | null, t: TitleInput, firstCode: number) {
  const parcelas = t.schedule ?? simulateInstallments(t.amountCents, t.installments ?? 1, t.dueDate, t.interval).map((l) => ({ dueDate: l.dueDate, amountCents: l.amount }));
  const groupId = t.groupId ?? (parcelas.length > 1 ? randomUUID() : null);
  return parcelas.map((p, i) => ({
    id: randomUUID(),
    tenantId,
    code: firstCode + i,
    direction: t.direction,
    origin: t.origin ?? 'MANUAL',
    originId: t.originId ?? null,
    patientId: t.patientId ?? null,
    contactId: t.contactId ?? null,
    professionalId: t.professionalId ?? null,
    unitId: t.unitId ?? null,
    appointmentId: t.appointmentId ?? null,
    quoteId: t.quoteId ?? null,
    categoryId: t.categoryId,
    costCenterId: t.costCenterId ?? null,
    accountId: t.accountId ?? null,
    methodId: t.methodId ?? null,
    issueDate: dayToDate(t.issueDate),
    dueDate: dayToDate(p.dueDate),
    competence: t.competence && parcelas.length === 1 ? t.competence : competenceOf(p.dueDate),
    amount: fromCents(p.amountCents),
    installmentNumber: i + 1,
    installmentTotal: parcelas.length,
    groupId,
    recurrenceId: t.recurrenceId ?? null,
    renegotiationId: t.renegotiationId ?? null,
    document: t.document || null,
    documentNumber: t.documentNumber || null,
    description: t.description || null,
    createdById: userId,
    _amountCents: p.amountCents,
  }));
}

/**
 * Grava um título (ou as parcelas dele) dentro de uma transação que já existe.
 * Devolve os ids na ordem das parcelas.
 */
export async function createTitlesTx(tx: Tx, tenantId: string, userId: string | null, t: TitleInput): Promise<FinResult<{ ids: string[]; groupId: string | null }>> {
  const forma = checkShape(t);
  if (forma) return fail(forma);
  const ref = await checkRefs(tx, tenantId, t);
  if (ref) return fail(ref);

  const primeiro = await nextCode(tx, tenantId, 'title');
  const linhas = titleRows(tenantId, userId, t, primeiro);
  await tx.financialTitle.createMany({ data: linhas.map(({ _amountCents: _a, ...l }) => l) });

  // Rateio: cada parcela leva a mesma proporção; a sobra de centavos fica na última parte.
  const partes = t.allocations ?? [];
  if (partes.length) {
    const data: Prisma.FinancialTitleAllocationCreateManyInput[] = [];
    for (const l of linhas) {
      let resto = l._amountCents;
      partes.forEach((p, i) => {
        const valor = i === partes.length - 1 ? resto : Math.floor((l._amountCents * p.amount) / t.amountCents);
        resto -= valor;
        if (valor > 0) data.push({ tenantId, titleId: l.id, categoryId: p.categoryId, costCenterId: p.costCenterId ?? null, amount: fromCents(valor) });
      });
    }
    await tx.financialTitleAllocation.createMany({ data });
  }
  return { ok: true, data: { ids: linhas.map((l) => l.id), groupId: linhas[0]?.groupId ?? null } };
}

export async function createTitles(actor: FinActor, t: TitleInput): Promise<FinResult<{ ids: string[]; groupId: string | null }>> {
  const r = await actor.db.$transaction((tx) => createTitlesTx(tx, actor.tenantId, actor.userId, t));
  if (r.ok) {
    await actor.db.auditLog.create({ data: { tenantId: actor.tenantId, userId: actor.userId, action: 'CREATE', entity: 'FinancialTitle', entityId: r.data.ids[0], metadata: { parcelas: r.data.ids.length } } });
  }
  return r;
}

// ─── Recorrência ─────────────────────────────────────────────────────────────

/** Quantos meses à frente os lançamentos recorrentes ficam gerados. */
export const RECURRENCE_HORIZON_MONTHS = 12;

type RecurrenceTemplate = Omit<TitleInput, 'issueDate' | 'dueDate' | 'installments' | 'interval' | 'schedule' | 'competence'>;

/** Cria a regra e já gera os títulos dos próximos 12 meses. */
export async function createRecurrence(actor: FinActor, t: TitleInput, spec: RecurrenceSpec): Promise<FinResult<{ ruleId: string; created: number }>> {
  if (!isDay(spec.start)) return fail('Confira a data de início.');
  if (spec.end && (!isDay(spec.end) || spec.end < spec.start)) return fail('O fim da repetição vem depois do início.');
  if (!Number.isInteger(spec.every) || spec.every < 1 || spec.every > 365) return fail('Confira de quanto em quanto tempo o lançamento repete.');
  if (spec.occurrences != null && (spec.occurrences < 1 || spec.occurrences > MAX_RECURRENCE_DATES)) return fail(`A repetição vai de 1 a ${MAX_RECURRENCE_DATES} vezes.`);
  const forma = checkShape({ ...t, dueDate: spec.start, installments: 1, schedule: undefined });
  if (forma) return fail(forma);

  const { issueDate: _i, dueDate: _d, installments: _n, interval: _v, schedule: _s, competence: _c, ...template } = t;
  const r = await actor.db.$transaction(async (tx) => {
    const ref = await checkRefs(tx, actor.tenantId, t);
    if (ref) return fail(ref);
    const regra = await tx.recurrenceRule.create({
      data: {
        tenantId: actor.tenantId,
        every: spec.every,
        unit: spec.unit,
        startDate: dayToDate(spec.start),
        endDate: spec.end ? dayToDate(spec.end) : null,
        occurrences: spec.occurrences ?? null,
        template: template as unknown as Prisma.InputJsonValue,
        createdById: actor.userId,
      },
    });
    const created = await generateRuleTx(tx, actor.tenantId, regra.id, clinicToday());
    return { ok: true as const, data: { ruleId: regra.id, created } };
  });
  return r;
}

/** Gera o que falta de uma regra até o horizonte. Devolve quantos títulos criou. */
export async function generateRuleTx(tx: Tx, tenantId: string, ruleId: string, today: Day): Promise<number> {
  const regra = await tx.recurrenceRule.findFirst({ where: { tenantId, id: ruleId, active: true } });
  if (!regra) return 0;
  const spec: RecurrenceSpec = {
    every: regra.every,
    unit: regra.unit === 'DAY' || regra.unit === 'WEEK' || regra.unit === 'YEAR' ? regra.unit : 'MONTH',
    start: regra.startDate.toISOString().slice(0, 10),
    end: regra.endDate ? regra.endDate.toISOString().slice(0, 10) : null,
    occurrences: regra.occurrences,
  };
  const ja = regra.generatedUntil ? regra.generatedUntil.toISOString().slice(0, 10) : null;
  const datas = recurrenceDates(spec, addMonths(today, RECURRENCE_HORIZON_MONTHS), ja);
  if (datas.length === 0) return 0;
  const template = regra.template as unknown as RecurrenceTemplate;
  let criados = 0;
  for (const dia of datas) {
    const r = await createTitlesTx(tx, tenantId, regra.createdById, { ...template, origin: 'RECURRENCE', originId: regra.id, recurrenceId: regra.id, issueDate: dia, dueDate: dia, installments: 1 });
    // Categoria ou conta desativada depois: para de gerar em vez de quebrar a rotina.
    if (!r.ok) break;
    criados += 1;
    await tx.recurrenceRule.update({ where: { id: regra.id }, data: { generatedUntil: dayToDate(dia) } });
  }
  return criados;
}

/** Rotina diária: estica todas as regras ativas da clínica até o horizonte. */
export async function extendRecurrences(db: TenantPrismaClient, tenantId: string, today: Day = clinicToday()): Promise<number> {
  const regras = await db.recurrenceRule.findMany({ where: { active: true }, select: { id: true } });
  let total = 0;
  for (const r of regras) total += await db.$transaction((tx) => generateRuleTx(tx, tenantId, r.id, today));
  return total;
}

// ─── Editar e cancelar ───────────────────────────────────────────────────────

export interface TitleEdit {
  categoryId?: string;
  costCenterId?: string | null;
  accountId?: string | null;
  methodId?: string | null;
  dueDate?: Day;
  competence?: string;
  amountCents?: number;
  document?: string | null;
  documentNumber?: string | null;
  description?: string | null;
  contactId?: string | null;
  professionalId?: string | null;
}

/**
 * Edita um título. Com pagamento, o valor não muda (estorna primeiro).
 * `scope: 'following'` leva a mudança para este e os próximos da mesma recorrência.
 */
export async function updateTitle(actor: FinActor, id: string, edit: TitleEdit, scope: 'one' | 'following' = 'one'): Promise<FinResult> {
  const r = await actor.db.$transaction(async (tx) => {
    const t = await tx.financialTitle.findFirst({ where: { tenantId: actor.tenantId, id } });
    if (!t) return fail('Conta não encontrada.');
    if (t.status === 'CANCELLED' || t.status === 'RENEGOTIATED') return fail('Esta conta está encerrada e não pode ser editada.');
    const pago = toCents(t.paidAmount) > 0;
    if (edit.amountCents != null && edit.amountCents !== toCents(t.amount)) {
      if (pago) return fail('Esta conta já tem pagamento. Para mudar o valor, estorne o pagamento primeiro.');
      if (!Number.isInteger(edit.amountCents) || edit.amountCents <= 0 || edit.amountCents > MAX_AMOUNT_CENTS) return fail('O valor precisa ser maior que zero.');
    }
    if (edit.dueDate && !isDay(edit.dueDate)) return fail('Confira o vencimento.');
    if (edit.competence && !isCompetence(edit.competence)) return fail('Confira o mês de competência.');
    if ((edit.description ?? '').length > 300) return fail('A descrição tem no máximo 300 letras.');
    const ref = await checkRefs(tx, actor.tenantId, {
      direction: t.direction,
      categoryId: edit.categoryId ?? t.categoryId,
      costCenterId: edit.costCenterId,
      accountId: edit.accountId,
      methodId: edit.methodId,
      contactId: edit.contactId,
      professionalId: edit.professionalId,
      issueDate: '2000-01-01',
      dueDate: '2000-01-01',
      amountCents: 1,
    });
    if (ref) return fail(ref);

    const data: Prisma.FinancialTitleUncheckedUpdateManyInput = {};
    if (edit.categoryId) data.categoryId = edit.categoryId;
    if (edit.costCenterId !== undefined) data.costCenterId = edit.costCenterId;
    if (edit.accountId !== undefined) data.accountId = edit.accountId;
    if (edit.methodId !== undefined) data.methodId = edit.methodId;
    if (edit.document !== undefined) data.document = edit.document || null;
    if (edit.documentNumber !== undefined) data.documentNumber = edit.documentNumber || null;
    if (edit.description !== undefined) data.description = edit.description || null;
    if (edit.contactId !== undefined) data.contactId = edit.contactId;
    if (edit.professionalId !== undefined) data.professionalId = edit.professionalId;

    // Só este: também o vencimento, a competência e o valor.
    const soEste: Prisma.FinancialTitleUncheckedUpdateManyInput = { ...data };
    if (edit.dueDate) soEste.dueDate = dayToDate(edit.dueDate);
    if (edit.competence) soEste.competence = edit.competence;
    if (edit.amountCents != null) soEste.amount = fromCents(edit.amountCents);
    await tx.financialTitle.updateMany({ where: { tenantId: actor.tenantId, id }, data: soEste });
    // Rateio antigo deixa de bater se a categoria ou o valor mudou: volta para a categoria do título.
    if (edit.categoryId || edit.amountCents != null) await tx.financialTitleAllocation.deleteMany({ where: { tenantId: actor.tenantId, titleId: id } });

    if (scope === 'following' && t.recurrenceId) {
      // Os próximos, ainda sem pagamento: mesmos dados e, se mudou, o mesmo valor. Cada um mantém o seu vencimento.
      const proximos: Prisma.FinancialTitleUncheckedUpdateManyInput = { ...data };
      if (edit.amountCents != null) proximos.amount = fromCents(edit.amountCents);
      await tx.financialTitle.updateMany({ where: { tenantId: actor.tenantId, recurrenceId: t.recurrenceId, dueDate: { gt: t.dueDate }, status: 'OPEN' }, data: proximos });
      // E o molde, para o que ainda vai ser gerado.
      const regra = await tx.recurrenceRule.findFirst({ where: { tenantId: actor.tenantId, id: t.recurrenceId } });
      if (regra) {
        const molde = { ...(regra.template as Record<string, unknown>) };
        for (const k of ['categoryId', 'costCenterId', 'accountId', 'methodId', 'document', 'documentNumber', 'description', 'contactId', 'professionalId', 'amountCents'] as const) {
          if (edit[k] !== undefined) molde[k] = edit[k];
        }
        if (edit.categoryId || edit.amountCents != null) delete molde.allocations;
        await tx.recurrenceRule.update({ where: { id: regra.id }, data: { template: molde as Prisma.InputJsonValue } });
      }
    }
    return { ok: true as const };
  });
  if (r.ok) await actor.db.auditLog.create({ data: { tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE', entity: 'FinancialTitle', entityId: id, metadata: { scope } } });
  return r;
}

/** Cancela um título sem pagamento. Com pagamento, é preciso estornar antes. */
export async function cancelTitle(actor: FinActor, id: string, reason: string, scope: 'one' | 'following' = 'one'): Promise<FinResult<{ cancelled: number }>> {
  const motivo = reason.trim();
  if (motivo.length < 3) return fail('Diga o motivo do cancelamento.');
  if (motivo.length > 150) return fail('O motivo tem no máximo 150 letras.');
  const r = await actor.db.$transaction(async (tx) => {
    const t = await tx.financialTitle.findFirst({ where: { tenantId: actor.tenantId, id } });
    if (!t) return fail('Conta não encontrada.');
    if (t.status === 'CANCELLED') return fail('Esta conta já está cancelada.');
    if (t.status === 'RENEGOTIATED') return fail('Esta conta foi renegociada. Desfaça a renegociação para mexer nela.');
    if (toCents(t.paidAmount) > 0) return fail('Esta conta tem pagamento. Estorne o pagamento antes de cancelar.');
    const dados = { status: 'CANCELLED' as const, cancelReason: motivo, cancelledAt: new Date(), cancelledById: actor.userId };
    let cancelled = (await tx.financialTitle.updateMany({ where: { tenantId: actor.tenantId, id, status: 'OPEN' }, data: dados })).count;
    if (scope === 'following' && t.recurrenceId) {
      cancelled += (await tx.financialTitle.updateMany({ where: { tenantId: actor.tenantId, recurrenceId: t.recurrenceId, dueDate: { gt: t.dueDate }, status: 'OPEN' }, data: dados })).count;
      await tx.recurrenceRule.updateMany({ where: { tenantId: actor.tenantId, id: t.recurrenceId }, data: { active: false } });
    }
    return { ok: true as const, data: { cancelled } };
  });
  if (r.ok) await actor.db.auditLog.create({ data: { tenantId: actor.tenantId, userId: actor.userId, action: 'CANCEL', entity: 'FinancialTitle', entityId: id, metadata: { motivo, scope } } });
  return r;
}
