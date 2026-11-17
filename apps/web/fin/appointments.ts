import 'server-only';

import type { TenantPrismaClient } from '@clinicaiq/db';
import { itemTotal, startBlocked, type Billing } from '@/lib/financeiro/billing';
import { competenceOf, dateToDay, isDay, type Day } from '@/lib/financeiro/dates';
import { SYSTEM_CATEGORY } from '@/lib/financeiro/defaults';
import type { InstallmentInterval } from '@/lib/financeiro/installments';
import { fromCents, toCents } from '@/lib/financeiro/money';
import type { FinanceSettings } from '@/lib/financeiro/settings';
import { billingFor, ensureItemsTx, refreshBillingTx } from './billing-sync';
import { generateCommissionsTx, refreshPendingCommissionsTx } from './commission';
import { categoryId } from './setup';
import { createTitlesTx, type Tx } from './titles';

/**
 * O financeiro do agendamento: os itens (procedimento, quantidade, preço,
 * desconto), faturar (criar o título para pagar depois), "não cobrar" e o que
 * falta receber. Receber é faturar com vencimento hoje e dar baixa em seguida
 * (a baixa é a de sempre, em `settle.ts`).
 */

type Db = Tx | TenantPrismaClient;

export type ApptResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const no = (message: string): { ok: false; message: string } => ({ ok: false, message });

export interface ApptEnv {
  tenantId: string;
  userId: string | null;
  settings: FinanceSettings;
  today: Day;
}

export interface ItemInput {
  procedureId?: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  /** Item de um orçamento aprovado do paciente: não gera cobrança nova. */
  quoteItemId?: string | null;
}

export const MAX_ITEMS = 30;

/** O que ainda falta executar de cada item dos orçamentos aprovados do paciente ("Trazer do orçamento"). */
export async function quoteItemsFor(db: Db, tenantId: string, patientId: string, exceptAppointmentId?: string | null) {
  const orcamentos = await db.quote.findMany({
    where: { tenantId, patientId, status: 'ACCEPTED' },
    orderBy: { number: 'desc' },
    select: { id: true, number: true, items: { select: { id: true, procedureId: true, name: true, quantity: true, unitPrice: true, total: true } } },
  });
  const ids = orcamentos.flatMap((q) => q.items.map((i) => i.id));
  if (!ids.length) return [];
  // Já usado em outros agendamentos que não foram cancelados nem tiveram falta.
  const usados = await db.appointmentItem.groupBy({
    by: ['quoteItemId'],
    where: { tenantId, quoteItemId: { in: ids }, appointment: { status: { notIn: ['CANCELLED', 'MISSED'] }, ...(exceptAppointmentId ? { id: { not: exceptAppointmentId } } : {}) } },
    _sum: { quantity: true },
  });
  const usado = new Map(usados.map((u) => [u.quoteItemId!, u._sum.quantity ?? 0]));
  return orcamentos.flatMap((q) =>
    q.items.map((i) => ({
      quoteItemId: i.id,
      quoteId: q.id,
      quoteNumber: q.number,
      procedureId: i.procedureId,
      name: i.name,
      unitPriceCents: toCents(i.unitPrice),
      quantity: i.quantity,
      remaining: Math.max(0, i.quantity - (usado.get(i.id) ?? 0)),
    })),
  );
}

/** Troca os itens do agendamento. O primeiro item com procedimento continua sendo o "procedimento do agendamento". */
export async function saveItemsTx(tx: Tx, env: ApptEnv, appointmentId: string, items: readonly ItemInput[]): Promise<ApptResult<{ billing: Billing }>> {
  const a = await tx.appointment.findFirst({ where: { tenantId: env.tenantId, id: appointmentId }, select: { id: true, patientId: true, status: true, procedureId: true } });
  if (!a) return no('Agendamento não encontrado.');
  if (items.length > MAX_ITEMS) return no(`Um agendamento aceita até ${MAX_ITEMS} procedimentos.`);
  if (a.status === 'ATTENDED' && !env.settings.editItemsAfterAttended) return no('A clínica não permite mudar os procedimentos depois de atendido.');

  for (const i of items) {
    if (!i.name.trim() || i.name.length > 160) return no('Confira o nome dos procedimentos.');
    if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99) return no('A quantidade vai de 1 a 99.');
    if (!Number.isInteger(i.unitPriceCents) || i.unitPriceCents < 0 || i.unitPriceCents > 100_000_000) return no('Confira o valor dos procedimentos.');
    if (!Number.isInteger(i.discountCents) || i.discountCents < 0 || i.discountCents > i.quantity * i.unitPriceCents) return no('O desconto não pode passar do valor do item.');
  }
  const procIds = [...new Set(items.map((i) => i.procedureId).filter((x): x is string => Boolean(x)))];
  if (procIds.length && (await tx.procedure.count({ where: { tenantId: env.tenantId, id: { in: procIds } } })) !== procIds.length) return no('Procedimento não encontrado.');

  // Itens de orçamento: o orçamento é deste paciente, está aprovado e ainda tem o que executar.
  const doOrcamento = items.filter((i) => i.quoteItemId);
  if (doOrcamento.length) {
    const disponiveis = new Map((await quoteItemsFor(tx, env.tenantId, a.patientId, a.id)).map((q) => [q.quoteItemId, q]));
    const pedido = new Map<string, number>();
    for (const i of doOrcamento) pedido.set(i.quoteItemId!, (pedido.get(i.quoteItemId!) ?? 0) + i.quantity);
    for (const [id, qtd] of pedido) {
      const q = disponiveis.get(id);
      if (!q) return no('Um dos itens não é de um orçamento aprovado deste paciente.');
      if (qtd > q.remaining) return no(`"${q.name}" do orçamento ORC-${String(q.quoteNumber).padStart(4, '0')} só tem ${q.remaining} para executar.`);
    }
  }

  await tx.appointmentItem.deleteMany({ where: { tenantId: env.tenantId, appointmentId: a.id } });
  if (items.length) {
    await tx.appointmentItem.createMany({
      data: items.map((i, order) => ({
        tenantId: env.tenantId,
        appointmentId: a.id,
        procedureId: i.procedureId || null,
        name: i.name.trim(),
        quantity: i.quantity,
        unitPrice: fromCents(i.unitPriceCents),
        discount: fromCents(i.discountCents),
        total: fromCents(itemTotal({ quantity: i.quantity, unitPrice: i.unitPriceCents, discount: i.discountCents })),
        quoteItemId: i.quoteItemId || null,
        order,
      })),
    });
  }
  // Lembretes, Retorno, CRM e relatórios antigos leem `procedureId`: fica o do primeiro item.
  const primeiro = items.find((i) => i.procedureId)?.procedureId ?? null;
  if (primeiro !== a.procedureId) await tx.appointment.update({ where: { id: a.id }, data: { procedureId: primeiro } });
  if (a.status === 'ATTENDED') {
    await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'ITEMS_CHANGED', entity: 'Appointment', entityId: a.id, metadata: { itens: items.length, depoisDeAtendido: true } } });
  }
  const billing = await refreshBillingTx(tx, env.tenantId, a.id);
  // Itens mudaram: as comissões ainda pendentes são refeitas.
  await refreshPendingCommissionsTx(tx, env.tenantId, a.id, env.settings, env.today);
  return { ok: true, billing: billing! };
}

export interface BillInput {
  appointmentId: string;
  /** Vencimento (da primeira parcela). */
  dueDate: Day;
  installments?: number;
  interval?: InstallmentInterval;
  /** Convênio que paga (tipo convênio). Em branco, o do agendamento. */
  contactId?: string | null;
}

/**
 * Fatura o que o agendamento ainda não faturou: cria o título (ou as parcelas)
 * contra o paciente ou, no tipo convênio, contra o convênio.
 */
export async function billAppointmentTx(tx: Tx, env: ApptEnv, input: BillInput): Promise<ApptResult<{ titleIds: string[]; amountCents: number }>> {
  if (!isDay(input.dueDate)) return no('Confira o vencimento.');
  await ensureItemsTx(tx, env.tenantId, input.appointmentId);
  const a = await tx.appointment.findFirst({
    where: { tenantId: env.tenantId, id: input.appointmentId },
    select: { id: true, patientId: true, professionalId: true, unitId: true, type: true, status: true, startTime: true, noChargeAt: true, insuranceContactId: true, patient: { select: { name: true } }, items: { orderBy: { order: 'asc' }, select: { name: true, quoteItemId: true } } },
  });
  if (!a) return no('Agendamento não encontrado.');
  if (a.status === 'CANCELLED') return no('Este agendamento está cancelado.');
  if (a.noChargeAt) return no('Este agendamento está marcado como "não cobrar". Desfaça para faturar.');
  const b = await billingFor(tx, env.tenantId, a.id);
  if (!b || b.unbilled <= 0) return no(b && b.billed > 0 ? 'Este agendamento já foi faturado.' : 'Este agendamento não tem valor para faturar.');

  const convenio = a.type === 'CONVENIO';
  const contactId = convenio ? (input.contactId ?? a.insuranceContactId) : null;
  if (convenio) {
    if (!contactId) return no('Escolha o convênio que paga este atendimento.');
    const c = await tx.finContact.findFirst({ where: { tenantId: env.tenantId, id: contactId }, select: { id: true } });
    if (!c) return no('Convênio não encontrado.');
    if (contactId !== a.insuranceContactId) await tx.appointment.update({ where: { id: a.id }, data: { insuranceContactId: contactId } });
  }
  const dia = dateToDay(a.startTime);
  const procedimentos = a.items.filter((i) => !i.quoteItemId).map((i) => i.name).join(', ');
  const descricao = `${convenio ? `${a.patient.name} · ` : ''}${procedimentos || 'Atendimento'}`.slice(0, 300);
  const r = await createTitlesTx(tx, env.tenantId, env.userId, {
    direction: 'RECEIVABLE',
    origin: 'APPOINTMENT',
    originId: a.id,
    appointmentId: a.id,
    // Título de convênio é do convênio: não entra na dívida do paciente.
    patientId: convenio ? null : a.patientId,
    contactId,
    professionalId: a.professionalId,
    unitId: a.unitId,
    categoryId: categoryId(env.tenantId, convenio ? SYSTEM_CATEGORY.convenio : SYSTEM_CATEGORY.atendimento),
    issueDate: env.today,
    dueDate: input.dueDate,
    // A receita é do mês do atendimento, mesmo paga depois.
    competence: competenceOf(dia),
    amountCents: b.unbilled,
    description: descricao,
    installments: input.installments,
    interval: input.interval,
  });
  if (!r.ok) return r;
  await generateCommissionsTx(tx, env.tenantId, a.id, 'BILLING', env.settings, env.today);
  // Parcelado: todas as parcelas são receita do mês do atendimento (o padrão seria o mês de cada vencimento).
  if (r.data.ids.length > 1) await tx.financialTitle.updateMany({ where: { tenantId: env.tenantId, id: { in: r.data.ids } }, data: { competence: competenceOf(dia) } });
  await refreshBillingTx(tx, env.tenantId, a.id);
  return { ok: true, titleIds: r.data.ids, amountCents: b.unbilled };
}

/** O título em aberto mais antigo do agendamento (o que "Receber" baixa primeiro). */
export async function openTitleOf(db: Db, tenantId: string, appointmentId: string): Promise<string | null> {
  const t = await db.financialTitle.findFirst({ where: { tenantId, appointmentId, status: { in: ['OPEN', 'PARTIAL'] } }, orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }, { code: 'asc' }], select: { id: true } });
  return t?.id ?? null;
}

/**
 * Desfaz o título que "Receber" criou quando a pessoa fecha a janela sem
 * receber nada: só some um título de agendamento sem nenhum movimento.
 */
export async function discardUnpaidTitleTx(tx: Tx, tenantId: string, titleId: string): Promise<boolean> {
  const t = await tx.financialTitle.findFirst({ where: { tenantId, id: titleId, origin: 'APPOINTMENT', status: 'OPEN' }, select: { id: true, appointmentId: true, paidAmount: true, groupId: true } });
  if (!t || toCents(t.paidAmount) > 0 || t.groupId) return false;
  if ((await tx.financialTransaction.count({ where: { tenantId, titleId } })) > 0) return false;
  await tx.financialRelease.deleteMany({ where: { tenantId, titleId } });
  await tx.financialTitleAllocation.deleteMany({ where: { tenantId, titleId } });
  await tx.financialTitle.deleteMany({ where: { tenantId, id: titleId } });
  if (t.appointmentId) await refreshBillingTx(tx, tenantId, t.appointmentId);
  return true;
}

/** "Não cobrar": tira o agendamento da lista de "A faturar", com o motivo. Só sem título vivo. */
export async function noChargeTx(tx: Tx, env: ApptEnv, appointmentId: string, reason: string): Promise<ApptResult> {
  const motivo = reason.trim();
  if (motivo.length < 3) return no('Diga o motivo de não cobrar.');
  if (motivo.length > 150) return no('O motivo tem no máximo 150 letras.');
  const b = await refreshBillingTx(tx, env.tenantId, appointmentId);
  if (!b) return no('Agendamento não encontrado.');
  if (b.billed > 0) return no('Este agendamento já tem conta lançada. Cancele a conta (ou estorne o pagamento) antes de marcar como "não cobrar".');
  await tx.appointment.updateMany({ where: { tenantId: env.tenantId, id: appointmentId }, data: { noChargeReason: motivo, noChargeAt: new Date(), noChargeById: env.userId } });
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'NO_CHARGE', entity: 'Appointment', entityId: appointmentId, metadata: { motivo } } });
  await refreshBillingTx(tx, env.tenantId, appointmentId);
  return { ok: true };
}

export async function undoNoChargeTx(tx: Tx, env: ApptEnv, appointmentId: string): Promise<ApptResult> {
  const r = await tx.appointment.updateMany({ where: { tenantId: env.tenantId, id: appointmentId, noChargeAt: { not: null } }, data: { noChargeReason: null, noChargeAt: null, noChargeById: null } });
  if (!r.count) return no('Este agendamento não está marcado como "não cobrar".');
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'NO_CHARGE_UNDONE', entity: 'Appointment', entityId: appointmentId } });
  await refreshBillingTx(tx, env.tenantId, appointmentId);
  return { ok: true };
}

/** "Bloquear o início do atendimento sem pagamento": a mensagem do bloqueio, ou nulo. */
export async function startBlockReason(db: Db, env: ApptEnv, appointmentId: string): Promise<string | null> {
  if (env.settings.blockStartWithoutPayment === 'OFF') return null;
  const b = await refreshBillingTx(db, env.tenantId, appointmentId);
  return b ? startBlocked(env.settings.blockStartWithoutPayment, b.status) : null;
}

/**
 * Atendimento concluído. Com "faturar sozinho" ligado, nasce o título com
 * vencimento hoje. Devolve o que ficou em aberto, para a tela sugerir "Receber agora".
 */
export async function onAttendedTx(tx: Tx, env: ApptEnv, appointmentId: string): Promise<{ openCents: number }> {
  let b = await refreshBillingTx(tx, env.tenantId, appointmentId);
  if (!b) return { openCents: 0 };
  await generateCommissionsTx(tx, env.tenantId, appointmentId, 'EXECUTION', env.settings, env.today);
  if (env.settings.autoBillOnFinish && b.unbilled > 0) {
    const a = await tx.appointment.findFirst({ where: { tenantId: env.tenantId, id: appointmentId }, select: { type: true, insuranceContactId: true } });
    // Convênio sem o convênio escolhido não dá para faturar sozinho: fica em "A faturar".
    if (a && (a.type !== 'CONVENIO' || a.insuranceContactId)) {
      const r = await billAppointmentTx(tx, env, { appointmentId, dueDate: env.today });
      if (r.ok) b = (await billingFor(tx, env.tenantId, appointmentId)) ?? b;
    }
  }
  return { openCents: b.unbilled + b.open };
}

/** Excluir o agendamento: com pagamento não pode; sem pagamento, as contas em aberto somem junto. */
export async function onDeletingTx(tx: Tx, env: ApptEnv, appointmentId: string): Promise<string | null> {
  const titulos = await tx.financialTitle.findMany({ where: { tenantId: env.tenantId, appointmentId }, select: { id: true, status: true, paidAmount: true } });
  if (titulos.some((t) => toCents(t.paidAmount) > 0 || t.status === 'RENEGOTIATED')) return 'Este agendamento tem pagamento lançado. Estorne o pagamento antes de excluir.';
  const abertos = titulos.filter((t) => t.status === 'OPEN').map((t) => t.id);
  if (abertos.length) {
    await tx.financialTitle.updateMany({ where: { tenantId: env.tenantId, id: { in: abertos } }, data: { status: 'CANCELLED', cancelReason: 'Agendamento excluído', cancelledAt: new Date(), cancelledById: env.userId } });
  }
  // Os títulos (cancelados) ficam no histórico, sem apontar para um agendamento que não existe mais.
  await tx.financialTitle.updateMany({ where: { tenantId: env.tenantId, appointmentId }, data: { appointmentId: null } });
  return null;
}

/** Atendidos do dia nesta unidade que ficaram sem faturar nem receber (aviso do fechamento do caixa). */
export async function unbilledAttended(db: Db, tenantId: string, day: Day, unitId: string | null, mainUnitId: string | null) {
  const inicio = new Date(`${day}T00:00:00.000Z`);
  const fim = new Date(`${day}T23:59:59.999Z`);
  const daUnidade = unitId ? (unitId === mainUnitId ? { OR: [{ unitId }, { unitId: null }] } : { unitId }) : {};
  const lista = await db.appointment.findMany({
    where: { tenantId, status: 'ATTENDED', startTime: { gte: inicio, lte: fim }, billingStatus: 'TO_RECEIVE', ...daUnidade },
    orderBy: { startTime: 'asc' },
    take: 50,
    select: { id: true, startTime: true, patient: { select: { name: true } }, items: { select: { total: true, quoteItemId: true } } },
  });
  return lista.map((a) => ({ id: a.id, startTime: a.startTime.toISOString(), patientName: a.patient.name, cents: a.items.reduce((s, i) => s + (i.quoteItemId ? 0 : toCents(i.total)), 0) }));
}
