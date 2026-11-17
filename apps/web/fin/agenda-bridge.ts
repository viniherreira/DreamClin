import 'server-only';

import { z } from 'zod';
import { BILLING_LABEL, billingFromProcedure, type BillingStatus } from '@/lib/financeiro/billing';
import { dateToDay, type Day } from '@/lib/financeiro/dates';
import { toCents } from '@/lib/financeiro/money';
import { displayStatus } from '@/lib/financeiro/title-status';
import { clinicDayOf, clinicToday } from '@/lib/tz';
import { onAttendedTx, onDeletingTx, saveItemsTx, startBlockReason, type ApptEnv, type ItemInput } from './appointments';
import { billingFor, ensureItemsTx, refreshBillingTx } from './billing-sync';
import { finContext, type FinContext } from './guard';
import { ensureFinanceSetup } from './setup';
import type { Tx } from './titles';

/**
 * A ponte da agenda para o financeiro novo. A agenda só chama o que está
 * aqui, e só quando a clínica tem a bandeira ligada (`agendaFinance` devolve
 * nulo sem ela, e a agenda segue como sempre foi).
 */

export class AgendaAbort extends Error {}

const itemSchema = z.object({
  procedureId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(160),
  quantity: z.number().int().min(1).max(99),
  /** Sem preço: quem não vê valores (profissional, se a clínica esconder) não manda. */
  unitPriceCents: z.number().int().min(0).nullable().optional(),
  discountCents: z.number().int().min(0).nullable().optional(),
  quoteItemId: z.string().min(1).nullable().optional(),
});
const itemsSchema = z.array(itemSchema).max(30);

export type FormItems = { ok: true; items: z.infer<typeof itemsSchema> | null } | { ok: false; message: string };

export interface AgendaFinance {
  ctx: FinContext;
  /** A pessoa vê os valores dos procedimentos? */
  showPrices: boolean;
  /** Lê os itens que a janela do agendamento mandou. `items: null` = a janela não mandou itens. */
  readItems: (formData: FormData) => FormItems;
  /** Grava os itens (ou só recalcula a situação, sem itens) dentro da transação da agenda. Lança `AgendaAbort` com a mensagem. */
  save: (tx: Tx, appointmentId: string, items: z.infer<typeof itemsSchema> | null) => Promise<void>;
  /** O convênio escolhido é desta clínica? */
  insurerOk: (id: string) => Promise<boolean>;
  /** Mensagem do bloqueio de "começar sem pagamento", ou nulo. */
  startBlock: (appointmentId: string) => Promise<string | null>;
  /** Atendimento concluído: fatura sozinho se a clínica ligou; devolve o que ficou em aberto. */
  attended: (appointmentId: string) => Promise<number>;
  /** Pode excluir? Devolve a mensagem da recusa, ou nulo (e cancela as contas em aberto). */
  deleting: (appointmentId: string) => Promise<string | null>;
  /** A situação de cada agendamento, para o cifrão da agenda. */
  /**
   * A situação de cada agendamento, para o cifrão da agenda. Agendamento de
   * antes do financeiro novo (sem situação gravada) não ganha cifrão: ele foi
   * cobrado pelo financeiro antigo.
   */
  statuses: (rows: { id: string; startTime: Date; type: 'PARTICULAR' | 'CONVENIO' | 'CORTESIA'; billingStatus: BillingStatus | null; procedureId: string | null }[], priceOf: (procedureId: string) => number | undefined) => Record<string, BillingStatus>;
  insurers: () => Promise<{ id: string; name: string }[]>;
}

/** O financeiro novo desta clínica, para a agenda. Nulo sem a bandeira. */
export async function agendaFinance(tenantId: string): Promise<AgendaFinance | null> {
  const ctx = await finContext();
  if (!ctx || ctx.tenantId !== tenantId) return null;
  const env: ApptEnv = { tenantId, userId: ctx.userId, settings: ctx.settings, today: clinicToday() as Day };
  const showPrices = ctx.role !== 'PROFESSIONAL' || ctx.settings.showPricesToProfessional;
  const desde = await financeSince(ctx);

  return {
    ctx,
    showPrices,
    readItems(formData) {
      const raw = formData.get('items');
      if (typeof raw !== 'string' || !raw) return { ok: true, items: null };
      try {
        const parsed = itemsSchema.safeParse(JSON.parse(raw));
        return parsed.success ? { ok: true, items: parsed.data } : { ok: false, message: 'Confira os procedimentos do agendamento.' };
      } catch {
        return { ok: false, message: 'Confira os procedimentos do agendamento.' };
      }
    },
    async save(tx, appointmentId, items) {
      if (!items) {
        await refreshBillingTx(tx, tenantId, appointmentId);
        return;
      }
      // Quem não vê valores não manda preço: vale o do item que já existia, ou o do cadastro do procedimento.
      const antigos = await tx.appointmentItem.findMany({ where: { tenantId, appointmentId }, select: { procedureId: true, quoteItemId: true, unitPrice: true, discount: true, quantity: true } });
      const procIds = [...new Set(items.map((i) => i.procedureId).filter((x): x is string => Boolean(x)))];
      const base = new Map((procIds.length ? await tx.procedure.findMany({ where: { tenantId, id: { in: procIds } }, select: { id: true, basePrice: true } }) : []).map((p) => [p.id, toCents(p.basePrice)]));
      const completos: ItemInput[] = items.map((i) => {
        const antigo = antigos.find((a) => a.procedureId === (i.procedureId ?? null) && a.quoteItemId === (i.quoteItemId ?? null));
        const semPreco = i.unitPriceCents == null || !showPrices;
        return {
          procedureId: i.procedureId ?? null,
          name: i.name,
          quantity: i.quantity,
          unitPriceCents: semPreco ? (antigo ? toCents(antigo.unitPrice) : (base.get(i.procedureId ?? '') ?? 0)) : i.unitPriceCents!,
          discountCents: semPreco ? (antigo && antigo.quantity === i.quantity ? toCents(antigo.discount) : 0) : (i.discountCents ?? 0),
          quoteItemId: i.quoteItemId ?? null,
        };
      });
      const r = await saveItemsTx(tx, env, appointmentId, completos);
      if (!r.ok) throw new AgendaAbort(r.message);
    },
    insurerOk: async (id) => Boolean(await ctx.db.finContact.findFirst({ where: { id }, select: { id: true } })),
    startBlock: (appointmentId) => startBlockReason(ctx.db, env, appointmentId),
    async attended(appointmentId) {
      await ensureFinanceSetup(tenantId);
      const r = await ctx.db.$transaction((tx) => onAttendedTx(tx, env, appointmentId));
      return r.openCents;
    },
    deleting: (appointmentId) => ctx.db.$transaction((tx) => onDeletingTx(tx, env, appointmentId)),
    statuses(rows, priceOf) {
      const out: Record<string, BillingStatus> = {};
      for (const a of rows) {
        if (!a.billingStatus && (!desde || a.startTime < desde)) continue;
        out[a.id] = a.billingStatus ?? billingFromProcedure(a.type, a.procedureId ? Math.round((priceOf(a.procedureId) ?? 0) * 100) : 0);
      }
      return out;
    },
    insurers: () => ctx.db.finContact.findMany({ where: { kind: 'INSURANCE', active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  };
}

/**
 * Desde quando a clínica usa o financeiro novo (o dia em que o caixa interno
 * nasceu, à meia-noite em hora de parede). Agendamentos de antes ficaram no
 * financeiro antigo e não entram em "A faturar".
 */
export async function financeSince(ctx: FinContext): Promise<Date | null> {
  const conta = await ctx.db.financialAccount.findFirst({ where: { isDefault: true }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  return conta ? new Date(`${clinicDayOf(conta.createdAt)}T00:00:00.000Z`) : null;
}

export interface AppointmentBillingDetail {
  status: BillingStatus;
  statusLabel: string;
  type: 'PARTICULAR' | 'CONVENIO' | 'CORTESIA';
  showPrices: boolean;
  totalCents: number;
  chargeableCents: number;
  billedCents: number;
  paidCents: number;
  openCents: number;
  unbilledCents: number;
  insurer: { id: string; name: string } | null;
  noCharge: { reason: string; at: string; by: string | null } | null;
  items: { id: string; procedureId: string | null; name: string; quantity: number; unitCents: number; discountCents: number; totalCents: number; quoteItemId: string | null; quoteNumber: number | null }[];
  titles: { id: string; code: number; dueDate: Day; amountCents: number; paidCents: number; display: string; installment: string | null }[];
  payments: { id: string; code: number; paidOn: Day; method: string; amountCents: number; receiptGroupId: string | null; reversed: boolean; isReversal: boolean }[];
  can: { receive: boolean; reverse: boolean; see: boolean };
}

/** Tudo o que a aba Financeiro do agendamento mostra. */
export async function appointmentBillingDetail(ctx: FinContext, appointmentId: string): Promise<AppointmentBillingDetail | null> {
  const { db, tenantId } = ctx;
  await ensureItemsTx(db, tenantId, appointmentId);
  const a = await db.appointment.findFirst({
    where: { id: appointmentId },
    select: { type: true, noChargeReason: true, noChargeAt: true, noChargeById: true, insuranceContactId: true, items: { orderBy: { order: 'asc' } } },
  });
  if (!a) return null;
  const b = await billingFor(db, tenantId, appointmentId);
  if (!b) return null;
  const showPrices = ctx.role !== 'PROFESSIONAL' || ctx.settings.showPricesToProfessional;
  const see = ctx.can('fin_ver') || ctx.can('fin_receber');
  const hoje = clinicToday() as Day;

  const quoteItemIds = a.items.map((i) => i.quoteItemId).filter((x): x is string => Boolean(x));
  const [titulos, convenio, quem, doOrcamento] = await Promise.all([
    see ? db.financialTitle.findMany({ where: { appointmentId }, orderBy: [{ dueDate: 'asc' }, { code: 'asc' }], select: { id: true, code: true, dueDate: true, amount: true, paidAmount: true, status: true, installmentNumber: true, installmentTotal: true } }) : [],
    a.insuranceContactId ? db.finContact.findFirst({ where: { id: a.insuranceContactId }, select: { id: true, name: true } }) : null,
    a.noChargeById ? db.user.findFirst({ where: { id: a.noChargeById }, select: { name: true } }) : null,
    quoteItemIds.length ? db.quoteItem.findMany({ where: { id: { in: quoteItemIds }, quote: { tenantId } }, select: { id: true, quote: { select: { number: true } } } }) : [],
  ]);
  const numero = new Map(doOrcamento.map((q) => [q.id, q.quote.number]));
  const movimentos = titulos.length
    ? await db.financialTransaction.findMany({ where: { titleId: { in: titulos.map((t) => t.id) }, kind: { in: ['RECEIPT', 'REVERSAL'] } }, orderBy: { code: 'asc' }, select: { id: true, code: true, kind: true, paidOn: true, amount: true, methodId: true, receiptGroupId: true, reversedAt: true } })
    : [];
  const formas = movimentos.length ? new Map((await db.finPaymentMethod.findMany({ where: { id: { in: [...new Set(movimentos.map((m) => m.methodId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } })).map((f) => [f.id, f.name])) : new Map<string, string>();

  return {
    status: b.status,
    statusLabel: BILLING_LABEL[b.status],
    type: a.type,
    showPrices,
    totalCents: b.total,
    chargeableCents: b.chargeable,
    billedCents: b.billed,
    paidCents: b.paid,
    openCents: b.open,
    unbilledCents: b.unbilled,
    insurer: convenio,
    noCharge: a.noChargeAt ? { reason: a.noChargeReason ?? '', at: a.noChargeAt.toISOString(), by: quem?.name ?? null } : null,
    items: a.items.map((i) => ({
      id: i.id,
      procedureId: i.procedureId,
      name: i.name,
      quantity: i.quantity,
      unitCents: showPrices ? toCents(i.unitPrice) : 0,
      discountCents: showPrices ? toCents(i.discount) : 0,
      totalCents: showPrices ? toCents(i.total) : 0,
      quoteItemId: i.quoteItemId,
      quoteNumber: i.quoteItemId ? (numero.get(i.quoteItemId) ?? null) : null,
    })),
    titles: titulos.map((t) => ({
      id: t.id,
      code: t.code,
      dueDate: dateToDay(t.dueDate),
      amountCents: toCents(t.amount),
      paidCents: toCents(t.paidAmount),
      display: displayStatus(t.status, dateToDay(t.dueDate), hoje),
      installment: t.installmentTotal > 1 ? `${t.installmentNumber}/${t.installmentTotal}` : null,
    })),
    payments: movimentos.map((m) => ({
      id: m.id,
      code: m.code,
      paidOn: dateToDay(m.paidOn),
      method: m.methodId ? (formas.get(m.methodId) ?? '') : '',
      amountCents: toCents(m.amount),
      receiptGroupId: m.receiptGroupId,
      reversed: Boolean(m.reversedAt),
      isReversal: m.kind === 'REVERSAL',
    })),
    can: { receive: ctx.can('fin_receber'), reverse: ctx.can('fin_estornar'), see },
  };
}
