'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { cashMoveTx, closeCashTx, openCashTx, type CashEnv } from '@/fin/cash';
import { unbilledAttended } from '@/fin/appointments';
import { finRead, finWrite, type FinContext } from '@/fin/guard';
import { ensureFinanceSetup } from '@/fin/setup';
import type { CountRow } from '@/lib/financeiro/cash';
import { clinicToday } from '@/lib/tz';
import type { Day } from '@/lib/financeiro/dates';

/**
 * Ações do caixa: abrir, reforço, sangria, fechar e marcar um fechamento com
 * diferença como visto. Tudo passa por `finWrite('fin_caixa')`: login,
 * bandeira, perfil e conta que pode gravar.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string; code?: string };

const env = (ctx: FinContext): CashEnv => ({ tenantId: ctx.tenantId, userId: ctx.userId, unitId: ctx.unitId, today: clinicToday() as Day, manageOthers: ctx.can('fin_caixas_outros') });

const dinheiro = z.number().int().min(0).max(100_000_000_00);

const openSchema = z.object({ openingCents: dinheiro, accountId: z.string().min(1).optional().nullable() });

export async function openCashAction(input: z.input<typeof openSchema>): Promise<Result<{ id: string; code: number }>> {
  const gate = await finWrite('fin_caixa');
  if (!gate.ok) return gate;
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Confira o troco inicial.' };
  await ensureFinanceSetup(gate.ctx.tenantId);
  const r = await gate.ctx.db.$transaction((tx) => openCashTx(tx, env(gate.ctx), parsed.data));
  if (r.ok) revalidatePath('/financeiro', 'layout');
  return r;
}

const moveSchema = z.object({
  sessionId: z.string().min(1),
  kind: z.enum(['REINFORCEMENT', 'WITHDRAWAL']),
  amountCents: dinheiro.positive('Informe o valor.'),
  otherAccountId: z.string().min(1).optional().nullable(),
  description: z.string().max(300).optional().nullable(),
});

export async function cashMoveAction(input: z.input<typeof moveSchema>): Promise<Result> {
  const gate = await finWrite('fin_caixa');
  if (!gate.ok) return gate;
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Confira os dados.' };
  const r = await gate.ctx.db.$transaction((tx) => cashMoveTx(tx, env(gate.ctx), parsed.data));
  if (!r.ok) return r;
  revalidatePath('/financeiro', 'layout');
  return { ok: true };
}

const closeSchema = z.object({
  sessionId: z.string().min(1),
  counted: z.object({ CASH: dinheiro, PIX: dinheiro, CREDIT_CARD: dinheiro, DEBIT_CARD: dinheiro, OTHER: dinheiro }),
  justification: z.string().max(500).optional().nullable(),
  recount: z.boolean().optional(),
});

export type CloseActionResult = { ok: true; rows: CountRow[]; difference: number; code: number } | { ok: false; message: string; code?: string; rows?: CountRow[]; difference?: number };

export async function closeCashAction(input: z.input<typeof closeSchema>): Promise<CloseActionResult> {
  const gate = await finWrite('fin_caixa');
  if (!gate.ok) return gate;
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Confira os valores contados.' };
  const ctx = gate.ctx;
  // Quem gerencia os caixas confere vendo o esperado; a conferência cega é para quem opera o próprio caixa.
  const blind = ctx.settings.blindCashCount && !ctx.can('fin_caixas_outros');
  // Regra da clínica: atendidos de hoje sem faturar nem receber só avisam, ou impedem o fechamento.
  const pendentes = ctx.settings.closeWithUnbilled === 'BLOCK' ? await pendingFor(ctx, parsed.data.sessionId) : [];
  const block = pendentes.length ? `Há ${pendentes.length} atendimento(s) de hoje sem faturar nem receber. Receba, fature ou marque como "não cobrar" antes de fechar o caixa.` : null;
  const r = await ctx.db.$transaction((tx) => closeCashTx(tx, env(ctx), parsed.data, { blind, block }));
  if (r.ok) revalidatePath('/financeiro', 'layout');
  return r;
}

/** Os atendidos de hoje na unidade do caixa que ficaram sem faturar nem receber. */
async function pendingFor(ctx: FinContext, sessionId: string) {
  const s = await ctx.db.cashSession.findFirst({ where: { id: sessionId }, select: { unitId: true } });
  if (!s) return [];
  const principal = await ctx.db.clinicUnit.findFirst({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
  return unbilledAttended(ctx.db, ctx.tenantId, clinicToday() as Day, s.unitId, principal?.id ?? null);
}

/** Para a janela de fechar: os atendidos de hoje sem cobrança e se isso bloqueia o fechamento. */
export async function cashPendingAction(sessionId: string): Promise<{ items: Awaited<ReturnType<typeof unbilledAttended>>; blocks: boolean }> {
  const gate = await finRead('fin_caixa');
  if (!gate.ok) return { items: [], blocks: false };
  return { items: await pendingFor(gate.ctx, sessionId), blocks: gate.ctx.settings.closeWithUnbilled === 'BLOCK' };
}

/** Dono ou administrador viu o fechamento com diferença: o aviso some. */
export async function markCashSeenAction(sessionId: string): Promise<Result> {
  const gate = await finWrite('fin_caixas_outros');
  if (!gate.ok) return gate;
  const { db, tenantId, userId } = gate.ctx;
  const s = await db.cashSession.findFirst({ where: { id: sessionId, status: 'CLOSED' }, select: { id: true } });
  if (!s) return { ok: false, message: 'Caixa não encontrado.' };
  await db.auditLog.create({ data: { tenantId, userId, action: 'REVIEW', entity: 'CashSession', entityId: s.id } });
  revalidatePath('/financeiro', 'layout');
  return { ok: true };
}
