'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { finRead, finWrite, type FinContext } from '@/fin/guard';
import { ensureLegacyMigrated } from '@/fin/quotes';
import { correctedFor, renegotiateTx, renegotiationList, RenegAbort, undoRenegotiationTx, type RenegEnv } from '@/fin/renegotiation';
import { reverseTransactionTx } from '@/fin/reverse';
import { ensureFinanceSetup } from '@/fin/setup';
import { transferList, transferTx } from '@/fin/transfers';
import { addCreditTx, refundCreditTx, walletList, walletStatement, type WalletEnv } from '@/fin/wallet';
import { dateToDay, isDay, type Day } from '@/lib/financeiro/dates';
import { toCents } from '@/lib/financeiro/money';
import { clinicToday } from '@/lib/tz';

/**
 * Ações da carteira do paciente, das renegociações e das transferências.
 * Todas passam por `finRead`/`finWrite` (login, bandeira, perfil, permissão e,
 * ao gravar, conta que pode gravar).
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string; code?: string };

const env = (ctx: FinContext): WalletEnv & RenegEnv => ({
  tenantId: ctx.tenantId,
  userId: ctx.userId,
  unitId: ctx.unitId,
  access: { role: ctx.role, permission: ctx.permission },
  settings: ctx.settings,
  today: clinicToday() as Day,
});

async function ready(ctx: FinContext) {
  await ensureFinanceSetup(ctx.tenantId);
  await ensureLegacyMigrated(ctx.tenantId);
}

function refresh(patientId?: string | null) {
  revalidatePath('/financeiro', 'layout');
  if (patientId) revalidatePath(`/pacientes/${patientId}`);
}

const day = z.string().refine(isDay, 'Data inválida.');
const cents = z.number().int().positive('Informe o valor.').max(100_000_000);

// ─── Carteira ────────────────────────────────────────────────────────────────

export async function walletListAction(filter: 'with' | 'without' | 'all', search?: string) {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return [];
  await ready(gate.ctx);
  return walletList(gate.ctx.db, filter, search);
}

export async function walletStatementAction(patientId: string) {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return null;
  return walletStatement(gate.ctx.db, patientId);
}

const walletMoveSchema = z.object({
  patientId: z.string().min(1),
  amountCents: cents,
  methodId: z.string().min(1),
  accountId: z.string().min(1).optional().nullable(),
  paidOn: day,
  description: z.string().max(300).optional().nullable(),
});

/** Adicionar crédito (adiantamento do paciente). Devolve o recibo. */
export async function addCreditAction(input: z.input<typeof walletMoveSchema>): Promise<Result<{ receiptGroupId: string }>> {
  const gate = await finWrite('fin_receber');
  if (!gate.ok) return gate;
  const parsed = walletMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Confira os dados.' };
  await ready(gate.ctx);
  const r = await gate.ctx.db.$transaction((tx) => addCreditTx(tx, env(gate.ctx), { ...parsed.data, paidOn: parsed.data.paidOn as Day }));
  if (!r.ok) return r;
  refresh(parsed.data.patientId);
  return { ok: true, receiptGroupId: r.receiptGroupId };
}

/** Devolver crédito em dinheiro, PIX ou outra forma. */
export async function refundCreditAction(input: z.input<typeof walletMoveSchema>): Promise<Result> {
  const gate = await finWrite('fin_pagar');
  if (!gate.ok) return gate;
  const parsed = walletMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Confira os dados.' };
  const r = await gate.ctx.db.$transaction((tx) => refundCreditTx(tx, env(gate.ctx), { ...parsed.data, paidOn: parsed.data.paidOn as Day }));
  if (!r.ok) return r;
  refresh(parsed.data.patientId);
  return { ok: true };
}

// ─── Renegociação ────────────────────────────────────────────────────────────

export async function renegotiationListAction(patientId?: string) {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return [];
  await ready(gate.ctx);
  return renegotiationList(gate.ctx.db, { patientId });
}

/** Passo 1: as contas em aberto do cliente, com o valor corrigido até hoje. */
export async function renegotiationCandidates(input: { patientId?: string | null; contactId?: string | null; from?: string | null; to?: string | null; chargeLate?: boolean }) {
  const gate = await finRead('fin_renegociar');
  if (!gate.ok) return null;
  const { ctx } = gate;
  await ready(ctx);
  if (!input.patientId && !input.contactId) return [];
  const titulos = await ctx.db.financialTitle.findMany({
    where: {
      direction: 'RECEIVABLE',
      status: { in: ['OPEN', 'PARTIAL'] },
      ...(input.patientId ? { patientId: input.patientId } : { contactId: input.contactId }),
      ...(input.from && isDay(input.from) ? { dueDate: { gte: new Date(`${input.from}T00:00:00Z`) } } : {}),
      ...(input.to && isDay(input.to) ? { dueDate: { lte: new Date(`${input.to}T00:00:00Z`) } } : {}),
    },
    orderBy: [{ dueDate: 'asc' }, { code: 'asc' }],
    take: 100,
    select: { id: true, code: true, description: true, dueDate: true, amount: true, paidAmount: true, installmentNumber: true, installmentTotal: true },
  });
  const corrigidas = new Map((await correctedFor(ctx.db, env(ctx), titulos.map((t) => t.id), input.chargeLate ?? true)).map((c) => [c.id, c]));
  return titulos.map((t) => {
    const c = corrigidas.get(t.id);
    return {
      id: t.id,
      code: t.code,
      description: t.description ?? '',
      dueDate: dateToDay(t.dueDate),
      installment: t.installmentTotal > 1 ? `${t.installmentNumber}/${t.installmentTotal}` : null,
      openCents: Math.max(0, toCents(t.amount) - toCents(t.paidAmount)),
      daysLate: c?.daysLate ?? 0,
      fineCents: c?.fine ?? 0,
      interestCents: c?.interest ?? 0,
      correctedCents: c?.corrected ?? Math.max(0, toCents(t.amount) - toCents(t.paidAmount)),
    };
  });
}

const renegSchema = z.object({
  titleIds: z.array(z.string().min(1)).min(1).max(100),
  discountCents: z.number().int().min(0),
  downPaymentCents: z.number().int().min(0),
  downPaymentDate: day.optional().nullable(),
  downPaymentMethodId: z.string().min(1).optional().nullable(),
  installments: z.number().int().min(1).max(60),
  interval: z.union([z.object({ kind: z.literal('monthly') }), z.object({ kind: z.literal('days'), days: z.number().int().min(1).max(365) })]),
  firstDueDate: day,
  monthlyInterestPercent: z.number().min(0).max(20).optional().nullable(),
  mode: z.enum(['SIMPLE', 'PRICE']).optional().nullable(),
  chargeLate: z.boolean().optional(),
  categoryId: z.string().min(1).optional().nullable(),
  accountId: z.string().min(1).optional().nullable(),
  documentNumber: z.string().max(60).optional().nullable(),
});

export async function renegotiateAction(input: z.input<typeof renegSchema>): Promise<Result<{ code: number; receiptGroupId: string | null }>> {
  const gate = await finWrite('fin_renegociar');
  if (!gate.ok) return gate;
  const parsed = renegSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Confira os dados.' };
  const { ctx } = gate;
  await ready(ctx);
  const d = parsed.data;
  try {
    const r = await ctx.db.$transaction((tx) =>
      renegotiateTx(tx, env(ctx), { ...d, firstDueDate: d.firstDueDate as Day, downPaymentDate: (d.downPaymentDate as Day | null | undefined) ?? null }).then((x) => {
        // Recusa no meio: desfaz tudo o que já tinha sido gravado.
        if (!x.ok) throw new RenegAbort(x.message);
        return x;
      }),
    );
    refresh();
    return { ok: true, code: r.code, receiptGroupId: r.receiptGroupId };
  } catch (e) {
    if (e instanceof RenegAbort) return { ok: false, message: e.message };
    throw e;
  }
}

export async function undoRenegotiationAction(id: string): Promise<Result> {
  const gate = await finWrite('fin_renegociar');
  if (!gate.ok) return gate;
  const r = await gate.ctx.db.$transaction((tx) => undoRenegotiationTx(tx, env(gate.ctx), id));
  if (r.ok) refresh();
  return r;
}

// ─── Transferências ──────────────────────────────────────────────────────────

export async function transferListAction(from: string, to: string, accountId?: string) {
  const gate = await finRead('fin_ver');
  if (!gate.ok || !isDay(from) || !isDay(to)) return [];
  await ready(gate.ctx);
  return transferList(gate.ctx.db, from as Day, to as Day, accountId || undefined);
}

const transferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amountCents: cents,
  date: day,
  description: z.string().max(300).optional().nullable(),
});

export async function transferAction(input: z.input<typeof transferSchema>): Promise<Result> {
  const gate = await finWrite('fin_pagar');
  if (!gate.ok) return gate;
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Confira os dados.' };
  await ready(gate.ctx);
  const r = await gate.ctx.db.$transaction((tx) => transferTx(tx, env(gate.ctx), { ...parsed.data, date: parsed.data.date as Day }));
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

/** Estornar uma transferência: as duas pontas. Só dono e administrador. */
export async function reverseTransferAction(outId: string, reason: string): Promise<Result> {
  const gate = await finWrite('fin_estornar');
  if (!gate.ok) return gate;
  const { ctx } = gate;
  const r = await ctx.db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: ctx.tenantId, userId: ctx.userId, today: clinicToday() as Day, unitId: ctx.unitId }, { transactionId: outId, reason, transfer: true }));
  if (!r.ok) return r;
  await ctx.db.auditLog.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, action: 'REVERSE', entity: 'Transfer', entityId: outId, metadata: { motivo: reason.slice(0, 150) } } });
  refresh();
  return { ok: true };
}
