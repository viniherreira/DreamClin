'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, type Prisma } from '@clinicaiq/db';
import { adjustCommissionTx, approveCommissionsTx, invoiceCommissionsTx, listCommissions, type CommissionRow } from '@/fin/commission';
import { finRead, finWrite } from '@/fin/guard';
import { ensureFinanceSetup } from '@/fin/setup';
import { isDay, type Day } from '@/lib/financeiro/dates';
import { fromCents, toCents } from '@/lib/financeiro/money';
import { cleanFinanceSettings, readFinanceSettings, type FinanceSettings } from '@/lib/financeiro/settings';
import { clinicToday } from '@/lib/tz';

/**
 * Comissões: a conferência (listar, ajustar, aprovar, faturar) e a
 * configuração (regra da clínica, exceções, repasses e custo dos
 * procedimentos). O profissional, com a liberação da clínica, só lista as dele.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const day = z.string().refine(isDay, 'Data inválida.');

const filtersSchema = z.object({
  from: day,
  to: day,
  professionalId: z.string().optional().nullable(),
  status: z.enum(['ALL', 'PENDING', 'APPROVED', 'BILLED', 'PAID', 'REVERSED']).optional(),
});

/** Gestão vê todas; o profissional (com `fin_comissoes_proprias`) só as dele. */
export async function listCommissionsAction(input: z.input<typeof filtersSchema>): Promise<{ rows: CommissionRow[]; own: boolean } | null> {
  const parsed = filtersSchema.safeParse(input);
  if (!parsed.success) return null;
  const gestao = await finRead('fin_comissoes');
  if (gestao.ok) {
    await ensureFinanceSetup(gestao.ctx.tenantId);
    return { rows: await listCommissions(gestao.ctx.db, { ...parsed.data, from: parsed.data.from as Day, to: parsed.data.to as Day }), own: false };
  }
  const proprias = await finRead('fin_comissoes_proprias');
  if (!proprias.ok) return null;
  const prof = await proprias.ctx.db.professional.findFirst({ where: { userId: proprias.ctx.userId }, select: { id: true } });
  if (!prof) return { rows: [], own: true };
  return { rows: await listCommissions(proprias.ctx.db, { ...parsed.data, from: parsed.data.from as Day, to: parsed.data.to as Day, professionalId: prof.id }), own: true };
}

export async function adjustCommissionAction(id: string, adjustmentCents: number, reason: string): Promise<Result> {
  const gate = await finWrite('fin_comissoes');
  if (!gate.ok) return gate;
  const r = await gate.ctx.db.$transaction((tx) => adjustCommissionTx(tx, { tenantId: gate.ctx.tenantId, userId: gate.ctx.userId }, id, Math.round(adjustmentCents), reason));
  if (r.ok) revalidatePath('/financeiro/comissoes');
  return r;
}

export async function approveCommissionsAction(ids: string[]): Promise<Result<{ approved: number }>> {
  const gate = await finWrite('fin_comissoes');
  if (!gate.ok) return gate;
  if (!ids.length || ids.length > 500) return { ok: false, message: 'Marque as linhas.' };
  const r = await gate.ctx.db.$transaction((tx) => approveCommissionsTx(tx, { tenantId: gate.ctx.tenantId, userId: gate.ctx.userId }, ids));
  revalidatePath('/financeiro/comissoes');
  return r;
}

const invoiceSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500), dueDate: day, methodId: z.string().min(1).optional().nullable() });

export async function invoiceCommissionsAction(input: z.input<typeof invoiceSchema>): Promise<Result<{ totalCents: number }>> {
  const gate = await finWrite('fin_comissoes');
  if (!gate.ok) return gate;
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Confira os dados.' };
  const { ctx } = gate;
  const r = await ctx.db.$transaction((tx) => invoiceCommissionsTx(tx, { tenantId: ctx.tenantId, userId: ctx.userId, settings: ctx.settings, today: clinicToday() as Day }, { ...parsed.data, dueDate: parsed.data.dueDate as Day }));
  if (!r.ok) return r;
  revalidatePath('/financeiro', 'layout');
  return { ok: true, totalCents: r.totalCents };
}

// ─── Configuração ────────────────────────────────────────────────────────────

export interface CommissionConfig {
  rules: Pick<FinanceSettings, 'commissionEnabled' | 'commissionParticular' | 'commissionConvenio' | 'commissionBase' | 'commissionDeductCost' | 'commissionWhen' | 'commissionCategoryId' | 'commissionAccountId' | 'professionalSeesCommissions'>;
  professionals: { id: string; name: string; percent: number | null }[];
  procedures: { id: string; name: string; priceCents: number; costCents: number | null }[];
  exceptions: { id: string; professionalId: string; procedureId: string | null; mode: 'PERCENT' | 'FIXED'; value: number }[];
  transferTypes: { id: string; name: string; mode: 'PERCENT' | 'FIXED'; value: number; contactId: string | null; procedureIds: string[]; active: boolean }[];
  contacts: { id: string; name: string }[];
}

export async function commissionConfig(): Promise<CommissionConfig | null> {
  const gate = await finRead('fin_config');
  if (!gate.ok) return null;
  const { db, settings: s } = gate.ctx;
  const [profs, procs, exc, tipos, contatos] = await Promise.all([
    db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, commissionPercent: true } }),
    db.procedure.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, basePrice: true, costPrice: true } }),
    db.commissionException.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } }),
    db.transferType.findMany({ orderBy: { name: 'asc' } }),
    db.finContact.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true }, take: 500 }),
  ]);
  return {
    rules: {
      commissionEnabled: s.commissionEnabled,
      commissionParticular: s.commissionParticular,
      commissionConvenio: s.commissionConvenio,
      commissionBase: s.commissionBase,
      commissionDeductCost: s.commissionDeductCost,
      commissionWhen: s.commissionWhen,
      commissionCategoryId: s.commissionCategoryId,
      commissionAccountId: s.commissionAccountId,
      professionalSeesCommissions: s.professionalSeesCommissions,
    },
    professionals: profs.map((p) => ({ id: p.id, name: p.name, percent: p.commissionPercent != null ? Number(p.commissionPercent) : null })),
    procedures: procs.map((p) => ({ id: p.id, name: p.name, priceCents: toCents(p.basePrice), costCents: p.costPrice != null ? toCents(p.costPrice) : null })),
    exceptions: exc.map((e) => ({ id: e.id, professionalId: e.professionalId, procedureId: e.procedureId, mode: e.mode === 'FIXED' ? 'FIXED' : 'PERCENT', value: Number(e.value) })),
    transferTypes: tipos.map((t) => ({ id: t.id, name: t.name, mode: t.mode === 'PERCENT' ? 'PERCENT' : 'FIXED', value: Number(t.value), contactId: t.contactId, procedureIds: t.procedureIds, active: t.active })),
    contacts: contatos,
  };
}

const modeValue = z.object({ mode: z.enum(['PERCENT', 'FIXED']), value: z.number().min(0).max(100_000) });
const rulesSchema = z.object({
  commissionEnabled: z.boolean(),
  commissionParticular: modeValue,
  commissionConvenio: modeValue,
  commissionBase: z.enum(['CHARGED', 'TABLE']),
  commissionDeductCost: z.boolean(),
  commissionWhen: z.enum(['EXECUTION', 'BILLING', 'RECEIPT']),
  commissionCategoryId: z.string().min(1).nullable(),
  commissionAccountId: z.string().min(1).nullable(),
  professionalSeesCommissions: z.boolean(),
});

export async function saveCommissionRules(input: z.input<typeof rulesSchema>): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const parsed = rulesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Confira as regras.' };
  const { tenantId, userId, db } = gate.ctx;
  if (parsed.data.commissionCategoryId && !(await db.financialCategory.findFirst({ where: { id: parsed.data.commissionCategoryId, direction: 'PAYABLE' }, select: { id: true } }))) return { ok: false, message: 'Escolha uma categoria de despesa.' };
  if (parsed.data.commissionAccountId && !(await db.financialAccount.findFirst({ where: { id: parsed.data.commissionAccountId }, select: { id: true } }))) return { ok: false, message: 'Conta não encontrada.' };
  // `Tenant` não passa pelo filtro de clínica: o id vem da sessão, nunca do formulário.
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const atual = (tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {}) as Record<string, unknown>;
  const novo = cleanFinanceSettings({ ...readFinanceSettings(atual), ...parsed.data });
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: { ...atual, finance: novo } as unknown as Prisma.InputJsonValue } });
  await db.auditLog.create({ data: { tenantId, userId, action: 'UPDATE', entity: 'CommissionRules', entityId: tenantId } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

const exceptionSchema = z.object({ professionalId: z.string().min(1), procedureId: z.string().min(1).nullable(), mode: z.enum(['PERCENT', 'FIXED']), value: z.number().min(0).max(100_000) });

export async function saveCommissionException(input: z.input<typeof exceptionSchema>): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const parsed = exceptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Confira a exceção.' };
  const d = parsed.data;
  if (d.mode === 'PERCENT' && d.value > 100) return { ok: false, message: 'A porcentagem vai até 100%.' };
  const { db, tenantId, userId } = gate.ctx;
  if (!(await db.professional.findFirst({ where: { id: d.professionalId }, select: { id: true } }))) return { ok: false, message: 'Profissional não encontrado.' };
  if (d.procedureId && !(await db.procedure.findFirst({ where: { id: d.procedureId }, select: { id: true } }))) return { ok: false, message: 'Procedimento não encontrado.' };
  // Uma exceção por profissional e procedimento: a nova substitui a de antes.
  await db.commissionException.deleteMany({ where: { professionalId: d.professionalId, procedureId: d.procedureId } });
  await db.commissionException.create({ data: { tenantId, professionalId: d.professionalId, procedureId: d.procedureId, mode: d.mode, value: d.value } });
  await db.auditLog.create({ data: { tenantId, userId, action: 'UPDATE', entity: 'CommissionException', entityId: d.professionalId } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

export async function deleteCommissionException(id: string): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  await gate.ctx.db.commissionException.deleteMany({ where: { id } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

const transferTypeSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(80),
  mode: z.enum(['PERCENT', 'FIXED']),
  value: z.number().min(0).max(100_000),
  contactId: z.string().min(1).nullable(),
  procedureIds: z.array(z.string().min(1)).max(200),
  active: z.boolean(),
});

export async function saveTransferType(input: z.input<typeof transferTypeSchema>): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const parsed = transferTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Confira o repasse: nome com 2 letras ou mais e um valor.' };
  const d = parsed.data;
  const { db, tenantId, userId } = gate.ctx;
  if (d.contactId && !(await db.finContact.findFirst({ where: { id: d.contactId }, select: { id: true } }))) return { ok: false, message: 'Quem recebe não foi encontrado.' };
  const validos = d.procedureIds.length ? (await db.procedure.findMany({ where: { id: { in: d.procedureIds } }, select: { id: true } })).map((p) => p.id) : [];
  const dados = { name: d.name, mode: d.mode, value: d.value, contactId: d.contactId, procedureIds: validos, active: d.active };
  if (d.id) {
    const r = await db.transferType.updateMany({ where: { id: d.id }, data: dados });
    if (!r.count) return { ok: false, message: 'Repasse não encontrado.' };
  } else {
    await db.transferType.create({ data: { tenantId, ...dados } });
  }
  await db.auditLog.create({ data: { tenantId, userId, action: 'UPDATE', entity: 'TransferType', entityId: d.id ?? 'novo' } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

/** Custo de material de um procedimento (usado quando a clínica desconta o custo da comissão). */
export async function saveProcedureCost(procedureId: string, costCents: number | null): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  if (costCents != null && (!Number.isInteger(costCents) || costCents < 0 || costCents > 100_000_000)) return { ok: false, message: 'Confira o custo.' };
  const r = await gate.ctx.db.procedure.updateMany({ where: { id: procedureId }, data: { costPrice: costCents == null ? null : fromCents(costCents) } });
  if (!r.count) return { ok: false, message: 'Procedimento não encontrado.' };
  revalidatePath('/configuracoes');
  return { ok: true };
}
