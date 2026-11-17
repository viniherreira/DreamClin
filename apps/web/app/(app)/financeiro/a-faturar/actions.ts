'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { billAppointmentTx, type ApptEnv } from '@/fin/appointments';
import { finRead, finWrite, type FinContext } from '@/fin/guard';
import { ensureLegacyMigrated } from '@/fin/quotes';
import { ensureFinanceSetup } from '@/fin/setup';
import { listToBill, type ToBillRow } from '@/fin/to-bill';
import { isDay, type Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';

/** Ações da tela "A faturar": a lista com filtros e o "Faturar selecionados". */

const env = (ctx: FinContext): ApptEnv => ({ tenantId: ctx.tenantId, userId: ctx.userId, settings: ctx.settings, today: clinicToday() as Day });

const day = z.string().refine(isDay, 'Data inválida.');
const filtersSchema = z.object({
  from: day,
  to: day,
  professionalId: z.string().optional(),
  patient: z.string().max(80).optional(),
  unitId: z.string().optional(),
  type: z.enum(['PARTICULAR', 'CONVENIO']).optional(),
  withNoCharge: z.boolean().optional(),
});

export async function listToBillAction(input: z.input<typeof filtersSchema>): Promise<{ rows: ToBillRow[]; truncated: boolean } | null> {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return null;
  const parsed = filtersSchema.safeParse(input);
  if (!parsed.success || parsed.data.from > parsed.data.to) return { rows: [], truncated: false };
  await ensureFinanceSetup(gate.ctx.tenantId);
  await ensureLegacyMigrated(gate.ctx.tenantId);
  return listToBill(gate.ctx, { ...parsed.data, from: parsed.data.from as Day, to: parsed.data.to as Day });
}

const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  dueDate: day,
});

/** Fatura cada agendamento marcado, com o mesmo vencimento. Diz quais ficaram de fora e por quê. */
export async function billBatchAction(input: z.input<typeof batchSchema>): Promise<{ ok: true; done: number; skipped: { id: string; reason: string }[] } | { ok: false; message: string }> {
  const gate = await finWrite('fin_receber');
  if (!gate.ok) return gate;
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Confira os dados.' };
  const { ctx } = gate;
  await ensureFinanceSetup(ctx.tenantId);
  let done = 0;
  const skipped: { id: string; reason: string }[] = [];
  for (const id of parsed.data.ids) {
    const r = await ctx.db.$transaction((tx) => billAppointmentTx(tx, env(ctx), { appointmentId: id, dueDate: parsed.data.dueDate as Day }));
    if (r.ok) done += 1;
    else skipped.push({ id, reason: r.message });
  }
  if (done) {
    await ctx.db.auditLog.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, action: 'BILL_BATCH', entity: 'Appointment', entityId: parsed.data.ids[0], metadata: { faturados: done, deFora: skipped.length } } });
  }
  revalidatePath('/agenda');
  revalidatePath('/financeiro', 'layout');
  return { ok: true, done, skipped };
}
