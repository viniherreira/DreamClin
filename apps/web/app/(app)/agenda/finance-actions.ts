'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { billAppointmentTx, discardUnpaidTitleTx, noChargeTx, openTitleOf, quoteItemsFor, undoNoChargeTx, type ApptEnv } from '@/fin/appointments';
import { appointmentBillingDetail, type AppointmentBillingDetail } from '@/fin/agenda-bridge';
import { finRead, finWrite, type FinContext } from '@/fin/guard';
import { ensureLegacyMigrated } from '@/fin/quotes';
import { ensureFinanceSetup } from '@/fin/setup';
import { addDays, isDay, type Day } from '@/lib/financeiro/dates';
import { toCents } from '@/lib/financeiro/money';
import { clinicToday } from '@/lib/tz';

/**
 * O financeiro dentro da agenda: a aba Financeiro do agendamento (receber,
 * faturar, não cobrar), os itens para a janela de editar e o "Trazer do
 * orçamento". Só existe com o financeiro novo ligado: sem a bandeira, as
 * guardas `finRead`/`finWrite` recusam.
 *
 * A agenda não importa nada do CRM daqui: o aviso de pagamento recebido sai
 * da baixa, em `financeiro/fin-actions.ts`.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const env = (ctx: FinContext): ApptEnv => ({ tenantId: ctx.tenantId, userId: ctx.userId, settings: ctx.settings, today: clinicToday() as Day });

function refresh() {
  revalidatePath('/agenda');
  revalidatePath('/financeiro', 'layout');
}

async function ready(ctx: FinContext) {
  await ensureFinanceSetup(ctx.tenantId);
  await ensureLegacyMigrated(ctx.tenantId);
}

/** A aba Financeiro do agendamento. Nulo sem acesso (o profissional vê só os itens, se a clínica deixar). */
export async function appointmentBilling(appointmentId: string): Promise<AppointmentBillingDetail | null> {
  const gate = await finRead('fin_ver');
  if (gate.ok) {
    await ready(gate.ctx);
    return appointmentBillingDetail(gate.ctx, appointmentId);
  }
  return null;
}

export interface EditItem {
  procedureId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  quoteItemId: string | null;
  quoteLabel: string | null;
}

/**
 * Os itens do agendamento para a janela de editar. Agendamento antigo, sem
 * itens gravados, aparece com o procedimento dele (sem gravar nada aqui).
 */
export async function appointmentItemsForEdit(appointmentId: string): Promise<{ items: EditItem[]; insuranceContactId: string | null } | null> {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return null;
  const { db } = gate.ctx;
  const a = await db.appointment.findFirst({
    where: { id: appointmentId },
    select: { insuranceContactId: true, procedure: { select: { id: true, name: true, basePrice: true } }, items: { orderBy: { order: 'asc' } } },
  });
  if (!a) return null;
  const qIds = a.items.map((i) => i.quoteItemId).filter((x): x is string => Boolean(x));
  const numeros = new Map((qIds.length ? await db.quoteItem.findMany({ where: { id: { in: qIds }, quote: { tenantId: gate.ctx.tenantId } }, select: { id: true, quote: { select: { number: true } } } }) : []).map((q) => [q.id, q.quote.number]));
  const items: EditItem[] = a.items.length
    ? a.items.map((i) => ({
        procedureId: i.procedureId,
        name: i.name,
        quantity: i.quantity,
        unitPriceCents: toCents(i.unitPrice),
        discountCents: toCents(i.discount),
        quoteItemId: i.quoteItemId,
        quoteLabel: i.quoteItemId && numeros.get(i.quoteItemId) ? `ORC-${String(numeros.get(i.quoteItemId)).padStart(4, '0')}` : null,
      }))
    : a.procedure
      ? [{ procedureId: a.procedure.id, name: a.procedure.name, quantity: 1, unitPriceCents: toCents(a.procedure.basePrice), discountCents: 0, quoteItemId: null, quoteLabel: null }]
      : [];
  return { items, insuranceContactId: a.insuranceContactId };
}

/** "Trazer do orçamento": o que ainda falta executar nos orçamentos aprovados do paciente. */
export async function patientQuoteItems(patientId: string, appointmentId?: string | null) {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return [];
  const lista = await quoteItemsFor(gate.ctx.db, gate.ctx.tenantId, patientId, appointmentId ?? null);
  return lista.filter((q) => q.remaining > 0).map((q) => ({ ...q, quoteLabel: `ORC-${String(q.quoteNumber).padStart(4, '0')}` }));
}

const billSchema = z.object({
  appointmentId: z.string().min(1),
  dueDate: z.string().refine(isDay, 'Confira o vencimento.'),
  installments: z.number().int().min(1).max(24).optional(),
  contactId: z.string().min(1).optional().nullable(),
});

/** Faturar: cria a conta para pagar depois (com parcelas, se quiser). */
export async function billAppointmentAction(input: z.input<typeof billSchema>): Promise<Result<{ titleIds: string[] }>> {
  const gate = await finWrite('fin_receber');
  if (!gate.ok) return gate;
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Confira os dados.' };
  const { ctx } = gate;
  await ready(ctx);
  const r = await ctx.db.$transaction((tx) => billAppointmentTx(tx, env(ctx), { ...parsed.data, dueDate: parsed.data.dueDate as Day }));
  if (!r.ok) return r;
  await ctx.db.auditLog.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, action: 'BILL', entity: 'Appointment', entityId: parsed.data.appointmentId, metadata: { parcelas: r.titleIds.length } } });
  refresh();
  return { ok: true, titleIds: r.titleIds };
}

/**
 * Receber: devolve a conta em aberto mais antiga do agendamento para a janela
 * de recebimento. Sem conta ainda, fatura com vencimento hoje (`created`): se a
 * pessoa fechar a janela sem receber nada, `discardReceiveAction` desfaz.
 */
export async function receiveAppointmentAction(appointmentId: string, contactId?: string | null): Promise<Result<{ titleId: string; created: boolean }>> {
  const gate = await finWrite('fin_receber');
  if (!gate.ok) return gate;
  const { ctx } = gate;
  await ready(ctx);
  const aberto = await openTitleOf(ctx.db, ctx.tenantId, appointmentId);
  if (aberto) return { ok: true, titleId: aberto, created: false };
  const hoje = clinicToday() as Day;
  const r = await ctx.db.$transaction((tx) => billAppointmentTx(tx, env(ctx), { appointmentId, dueDate: hoje, contactId: contactId ?? null }));
  if (!r.ok) return r;
  refresh();
  return { ok: true, titleId: r.titleIds[0], created: true };
}

export async function discardReceiveAction(titleId: string): Promise<Result> {
  const gate = await finWrite('fin_receber');
  if (!gate.ok) return gate;
  const { ctx } = gate;
  await ctx.db.$transaction((tx) => discardUnpaidTitleTx(tx, ctx.tenantId, titleId));
  refresh();
  return { ok: true };
}

export async function noChargeAction(appointmentId: string, reason: string): Promise<Result> {
  const gate = await finWrite('fin_receber');
  if (!gate.ok) return gate;
  const { ctx } = gate;
  const r = await ctx.db.$transaction((tx) => noChargeTx(tx, env(ctx), appointmentId, reason));
  if (r.ok) refresh();
  return r;
}

export async function undoNoChargeAction(appointmentId: string): Promise<Result> {
  const gate = await finWrite('fin_receber');
  if (!gate.ok) return gate;
  const { ctx } = gate;
  const r = await ctx.db.$transaction((tx) => undoNoChargeTx(tx, env(ctx), appointmentId));
  if (r.ok) refresh();
  return r;
}

/** Vencimento padrão de "Faturar": daqui a 30 dias. */
export async function defaultBillDueDate(): Promise<Day> {
  return addDays(clinicToday() as Day, 30);
}
