import 'server-only';

import type { TenantPrismaClient } from '@clinicaiq/db';
import { baseFor, commissionAmount, commissionDisplay, proportional, ruleFor, type CommissionDisplay, type CommissionRule } from '@/lib/financeiro/commission';
import { addDays, competenceOf, dateToDay, dayToDate, isDay, type Day } from '@/lib/financeiro/dates';
import { SYSTEM_CATEGORY } from '@/lib/financeiro/defaults';
import { fromCents, toCents } from '@/lib/financeiro/money';
import type { FinanceSettings } from '@/lib/financeiro/settings';
import { categoryId } from './setup';
import { createTitlesTx, type Tx } from './titles';

/**
 * Comissões e repasses. Cada item de agendamento gera uma linha por
 * profissional (comissão) e uma por tipo de repasse do procedimento. A linha
 * nasce no atendimento, no faturamento ou no recebimento (proporcional),
 * conforme a regra da clínica; o item coberto por orçamento nasce sempre no
 * atendimento (o dinheiro dele entrou pelo orçamento). Os repasses nascem no
 * atendimento. O estorno de um recebimento estorna a parte da comissão dele.
 *
 * Este arquivo não importa a baixa nem o estorno: eles é que chamam daqui.
 */

type Db = Tx | TenantPrismaClient;
type Trigger = 'EXECUTION' | 'BILLING' | 'RECEIPT';

interface ItemCalc {
  itemId: string;
  procedureId: string | null;
  name: string;
  quantity: number;
  covered: boolean;
  chargedCents: number;
  base: number;
  rule: CommissionRule;
  full: number;
}

/** A comissão inteira de cada item de um agendamento (sem gravar nada). */
async function calcItems(db: Db, tenantId: string, appointmentId: string, settings: FinanceSettings) {
  const a = await db.appointment.findFirst({
    where: { tenantId, id: appointmentId },
    select: { id: true, type: true, startTime: true, professionalId: true, professional: { select: { commissionPercent: true, name: true } }, patient: { select: { name: true } }, items: { orderBy: { order: 'asc' } } },
  });
  if (!a) return null;
  const procIds = [...new Set(a.items.map((i) => i.procedureId).filter((x): x is string => Boolean(x)))];
  const [procs, excecoes] = await Promise.all([
    procIds.length ? db.procedure.findMany({ where: { tenantId, id: { in: procIds } }, select: { id: true, basePrice: true, costPrice: true } }) : [],
    db.commissionException.findMany({ where: { tenantId, professionalId: a.professionalId, active: true }, select: { procedureId: true, mode: true, value: true } }),
  ]);
  const proc = new Map(procs.map((p) => [p.id, p]));
  const padrao = a.type === 'CONVENIO' ? settings.commissionConvenio : settings.commissionParticular;
  const items: ItemCalc[] = a.items.map((i) => {
    const p = i.procedureId ? proc.get(i.procedureId) : undefined;
    const charged = a.type === 'CORTESIA' ? 0 : toCents(i.total);
    const base = baseFor({ quantity: i.quantity, chargedCents: charged, tablePriceCents: p ? toCents(p.basePrice) : null, costCents: p?.costPrice != null ? toCents(p.costPrice) : null }, { base: settings.commissionBase, deductCost: settings.commissionDeductCost });
    const rule = ruleFor({
      procedureId: i.procedureId,
      exceptions: excecoes.map((e) => ({ procedureId: e.procedureId, mode: e.mode === 'FIXED' ? 'FIXED' : 'PERCENT', value: Number(e.value) })),
      professionalPercent: a.professional.commissionPercent != null ? Number(a.professional.commissionPercent) : null,
      clinicDefault: padrao,
    });
    return { itemId: i.id, procedureId: i.procedureId, name: i.name, quantity: i.quantity, covered: Boolean(i.quoteItemId), chargedCents: charged, base, rule, full: commissionAmount(base, i.quantity, rule) };
  });
  return { a, items };
}

const entryBase = (tenantId: string, a: { id: string; professionalId: string; patient: { name: string } }) => ({ tenantId, appointmentId: a.id });

/**
 * Gera as linhas que nascem neste momento (atendimento ou faturamento).
 * Roda quantas vezes for: item que já tem linha viva não ganha outra.
 */
export async function generateCommissionsTx(tx: Tx, tenantId: string, appointmentId: string, trigger: 'EXECUTION' | 'BILLING', settings: FinanceSettings, today: Day): Promise<number> {
  if (!settings.commissionEnabled) return 0;
  const c = await calcItems(tx, tenantId, appointmentId, settings);
  if (!c) return 0;
  const { a, items } = c;
  const dia = trigger === 'EXECUTION' ? dateToDay(a.startTime) : today;
  const vivas = await tx.commissionEntry.findMany({ where: { tenantId, appointmentId, status: { not: 'REVERSED' } }, select: { appointmentItemId: true, kind: true, transferTypeId: true, trigger: true } });
  const jaTem = (itemId: string, kind: string, tipo: string | null = null) => vivas.some((v) => v.appointmentItemId === itemId && v.kind === kind && (v.transferTypeId ?? null) === tipo);
  let criadas = 0;

  for (const i of items) {
    // Item coberto por orçamento: sempre no atendimento. Os outros: no momento da regra da clínica.
    const momento: Trigger = i.covered ? 'EXECUTION' : settings.commissionWhen;
    if (momento !== trigger || i.full <= 0 || jaTem(i.itemId, 'COMMISSION')) continue;
    await tx.commissionEntry.create({
      data: { ...entryBase(tenantId, a), kind: 'COMMISSION', professionalId: a.professionalId, appointmentItemId: i.itemId, procedureId: i.procedureId, trigger, description: `${i.name} · ${a.patient.name}`, base: fromCents(i.base), ruleLabel: i.rule.label, amount: fromCents(i.full), occurredOn: dayToDate(dia), competence: competenceOf(dia) },
    });
    criadas += 1;
  }

  // Repasses: sempre no atendimento.
  if (trigger === 'EXECUTION') {
    const tipos = await tx.transferType.findMany({ where: { tenantId, active: true } });
    for (const i of items) {
      for (const t of tipos) {
        if (!i.procedureId || !t.procedureIds.includes(i.procedureId) || jaTem(i.itemId, 'TRANSFER', t.id)) continue;
        const valor = t.mode === 'PERCENT' ? commissionAmount(i.chargedCents, i.quantity, { mode: 'PERCENT', value: Number(t.value), label: '' }) : toCents(t.value) * i.quantity;
        if (valor <= 0) continue;
        await tx.commissionEntry.create({
          data: {
            ...entryBase(tenantId, a),
            kind: 'TRANSFER',
            transferTypeId: t.id,
            contactId: t.contactId,
            professionalId: t.contactId ? null : a.professionalId,
            appointmentItemId: i.itemId,
            procedureId: i.procedureId,
            trigger: 'EXECUTION',
            description: `${t.name} · ${i.name} · ${a.patient.name}`,
            base: fromCents(i.chargedCents),
            ruleLabel: t.mode === 'PERCENT' ? `${String(Number(t.value)).replace('.', ',')}% do repasse ${t.name}` : `${(toCents(t.value) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por unidade do repasse ${t.name}`,
            amount: fromCents(valor),
            occurredOn: dayToDate(dia),
            competence: competenceOf(dia),
          },
        });
        criadas += 1;
      }
    }
  }
  return criadas;
}

/**
 * Itens mudaram depois de atendido: as linhas ainda pendentes (não faturadas)
 * são refeitas com os itens novos.
 */
export async function refreshPendingCommissionsTx(tx: Tx, tenantId: string, appointmentId: string, settings: FinanceSettings, today: Day): Promise<void> {
  await tx.commissionEntry.deleteMany({ where: { tenantId, appointmentId, status: 'PENDING', payableTitleId: null, trigger: { in: ['EXECUTION', 'BILLING'] } } });
  const a = await tx.appointment.findFirst({ where: { tenantId, id: appointmentId }, select: { status: true } });
  if (a?.status === 'ATTENDED') await generateCommissionsTx(tx, tenantId, appointmentId, 'EXECUTION', settings, today);
  if ((await tx.financialTitle.count({ where: { tenantId, appointmentId, status: { not: 'CANCELLED' } } })) > 0) await generateCommissionsTx(tx, tenantId, appointmentId, 'BILLING', settings, today);
}

/** Recebimento de conta de agendamento, com a regra "no recebimento": nasce a parte proporcional. */
export async function commissionsOnReceiptTx(tx: Tx, tenantId: string, transactionIds: readonly string[], settings: FinanceSettings): Promise<void> {
  if (!settings.commissionEnabled || settings.commissionWhen !== 'RECEIPT' || !transactionIds.length) return;
  const movs = await tx.financialTransaction.findMany({ where: { tenantId, id: { in: [...transactionIds] }, kind: 'RECEIPT', titleId: { not: null } }, select: { id: true, paidOn: true, title: { select: { appointmentId: true } } } });
  for (const m of movs) {
    const appointmentId = m.title?.appointmentId;
    if (!appointmentId) continue;
    const c = await calcItems(tx, tenantId, appointmentId, settings);
    if (!c) continue;
    const cobravel = c.items.filter((i) => !i.covered);
    const total = cobravel.reduce((s, i) => s + i.chargedCents, 0);
    if (total <= 0) continue;
    const recebido = toCents((await tx.financialTransaction.aggregate({ where: { tenantId, kind: 'RECEIPT', reversedAt: null, title: { appointmentId } }, _sum: { principal: true } }))._sum.principal);
    const ja = await tx.commissionEntry.groupBy({ by: ['appointmentItemId'], where: { tenantId, appointmentId, kind: 'COMMISSION', trigger: 'RECEIPT', status: { not: 'REVERSED' } }, _sum: { amount: true } });
    const jaPorItem = new Map(ja.map((j) => [j.appointmentItemId, toCents(j._sum.amount)]));
    const dia = dateToDay(m.paidOn);
    for (const i of cobravel) {
      // A parte de cada item: proporcional ao que entrou do total do agendamento.
      const parte = proportional(i.full, recebido, total, jaPorItem.get(i.itemId) ?? 0);
      if (parte <= 0) continue;
      await tx.commissionEntry.create({
        data: { tenantId, appointmentId, kind: 'COMMISSION', professionalId: c.a.professionalId, appointmentItemId: i.itemId, procedureId: i.procedureId, trigger: 'RECEIPT', triggerTransactionId: m.id, description: `${i.name} · ${c.a.patient.name} (recebimento)`, base: fromCents(i.base), ruleLabel: i.rule.label, amount: fromCents(parte), occurredOn: dayToDate(dia), competence: competenceOf(dia) },
      });
    }
  }
}

/** Estorno de recebimentos: a comissão que nasceu deles é estornada (ou, se já faturada, ganha uma linha negativa). */
export async function commissionsOnReversalTx(tx: Tx, tenantId: string, reversedIds: readonly string[], today: Day): Promise<void> {
  if (!reversedIds.length) return;
  const linhas = await tx.commissionEntry.findMany({ where: { tenantId, triggerTransactionId: { in: [...reversedIds] }, status: { not: 'REVERSED' } } });
  for (const l of linhas) {
    if (!l.payableTitleId) {
      await tx.commissionEntry.update({ where: { id: l.id }, data: { status: 'REVERSED' } });
      continue;
    }
    // Já foi para uma conta a pagar: o desconto entra na próxima conferência.
    const { id: _i, createdAt: _c, updatedAt: _u, payableTitleId: _p, approvedAt: _a, approvedById: _b, ...resto } = l;
    await tx.commissionEntry.create({ data: { ...resto, triggerTransactionId: null, status: 'PENDING', amount: fromCents(-toCents(l.amount)), adjustment: 0, adjustmentReason: null, description: `Estorno: ${l.description}`, occurredOn: dayToDate(today), competence: competenceOf(today) } });
  }
}

// ─── Conferência e faturamento ───────────────────────────────────────────────

export interface CommissionFilters {
  from: Day;
  to: Day;
  professionalId?: string | null;
  status?: CommissionDisplay | 'ALL';
}

export interface CommissionRow {
  id: string;
  kind: 'COMMISSION' | 'TRANSFER';
  beneficiary: string;
  beneficiaryKey: string;
  professionalId: string | null;
  contactId: string | null;
  occurredOn: Day;
  description: string;
  trigger: Trigger;
  baseCents: number;
  ruleLabel: string;
  amountCents: number;
  adjustmentCents: number;
  adjustmentReason: string | null;
  totalCents: number;
  display: CommissionDisplay;
  payableTitleCode: number | null;
}

export async function listCommissions(db: TenantPrismaClient, f: CommissionFilters): Promise<CommissionRow[]> {
  const linhas = await db.commissionEntry.findMany({
    where: { occurredOn: { gte: dayToDate(f.from), lt: dayToDate(addDays(f.to, 1)) }, ...(f.professionalId ? { professionalId: f.professionalId } : {}) },
    orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
    take: 2000,
  });
  const ids = <T,>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => Boolean(x)))];
  const [profs, contatos, titulos] = await Promise.all([
    db.professional.findMany({ where: { id: { in: ids(linhas.map((l) => l.professionalId)) } }, select: { id: true, name: true } }),
    db.finContact.findMany({ where: { id: { in: ids(linhas.map((l) => l.contactId)) } }, select: { id: true, name: true } }),
    db.financialTitle.findMany({ where: { id: { in: ids(linhas.map((l) => l.payableTitleId)) } }, select: { id: true, code: true, status: true } }),
  ]);
  const prof = new Map(profs.map((p) => [p.id, p.name]));
  const cont = new Map(contatos.map((c) => [c.id, c.name]));
  const tit = new Map(titulos.map((t) => [t.id, t]));
  return linhas
    .map((l) => {
      const t = l.payableTitleId ? tit.get(l.payableTitleId) : undefined;
      const display = commissionDisplay(l.status, t?.status ?? null);
      return {
        id: l.id,
        kind: l.kind === 'TRANSFER' ? ('TRANSFER' as const) : ('COMMISSION' as const),
        beneficiary: l.contactId ? (cont.get(l.contactId) ?? '') : l.professionalId ? (prof.get(l.professionalId) ?? '') : '',
        beneficiaryKey: l.contactId ? `c:${l.contactId}` : `p:${l.professionalId}`,
        professionalId: l.professionalId,
        contactId: l.contactId,
        occurredOn: dateToDay(l.occurredOn),
        description: l.description,
        trigger: l.trigger as Trigger,
        baseCents: toCents(l.base),
        ruleLabel: l.ruleLabel,
        amountCents: toCents(l.amount),
        adjustmentCents: toCents(l.adjustment),
        adjustmentReason: l.adjustmentReason,
        totalCents: toCents(l.amount) + toCents(l.adjustment),
        display,
        payableTitleCode: t && t.status !== 'CANCELLED' ? t.code : null,
      };
    })
    .filter((r) => !f.status || f.status === 'ALL' || r.display === f.status);
}

export type CommissionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const no = (message: string): { ok: false; message: string } => ({ ok: false, message });

/** Ajuste na conferência (mais ou menos), com motivo. Só em linha ainda não faturada. */
export async function adjustCommissionTx(tx: Tx, env: { tenantId: string; userId: string | null }, id: string, adjustmentCents: number, reason: string): Promise<CommissionResult> {
  const motivo = reason.trim();
  if (!Number.isInteger(adjustmentCents) || Math.abs(adjustmentCents) > 100_000_000) return no('Confira o valor do ajuste.');
  if (adjustmentCents !== 0 && motivo.length < 3) return no('Diga o motivo do ajuste.');
  const l = await tx.commissionEntry.findFirst({ where: { tenantId: env.tenantId, id } });
  if (!l) return no('Linha não encontrada.');
  if (l.status === 'REVERSED') return no('Esta linha foi estornada.');
  if (l.payableTitleId) return no('Esta linha já foi faturada.');
  if (toCents(l.amount) + adjustmentCents < 0 && toCents(l.amount) >= 0) return no('O ajuste deixaria a comissão negativa.');
  await tx.commissionEntry.update({ where: { id }, data: { adjustment: fromCents(adjustmentCents), adjustmentReason: adjustmentCents ? motivo.slice(0, 200) : null, status: 'PENDING' } });
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'COMMISSION_ADJUST', entity: 'CommissionEntry', entityId: id, metadata: { ajuste: fromCents(adjustmentCents), motivo: motivo.slice(0, 200) } } });
  return { ok: true };
}

export async function approveCommissionsTx(tx: Tx, env: { tenantId: string; userId: string | null }, ids: readonly string[]): Promise<CommissionResult<{ approved: number }>> {
  const r = await tx.commissionEntry.updateMany({ where: { tenantId: env.tenantId, id: { in: [...ids] }, status: 'PENDING', payableTitleId: null }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: env.userId } });
  return { ok: true, approved: r.count };
}

/**
 * Fatura as linhas aprovadas de uma pessoa: nasce a conta a pagar (origem
 * COMISSÃO) com o total, e as linhas ficam ligadas a ela.
 */
export async function invoiceCommissionsTx(
  tx: Tx,
  env: { tenantId: string; userId: string | null; settings: FinanceSettings; today: Day },
  input: { ids: string[]; dueDate: Day; methodId?: string | null },
): Promise<CommissionResult<{ titleId: string; totalCents: number }>> {
  if (!isDay(input.dueDate)) return no('Confira o vencimento.');
  const linhas = await tx.commissionEntry.findMany({ where: { tenantId: env.tenantId, id: { in: input.ids } } });
  if (!linhas.length || linhas.length !== new Set(input.ids).size) return no('Linha não encontrada.');
  if (linhas.some((l) => l.status !== 'APPROVED' || l.payableTitleId)) return no('Fature só linhas aprovadas e ainda não faturadas.');
  const chaves = new Set(linhas.map((l) => (l.contactId ? `c:${l.contactId}` : `p:${l.professionalId}`)));
  if (chaves.size !== 1) return no('Fature as comissões de uma pessoa de cada vez.');
  const total = linhas.reduce((s, l) => s + toCents(l.amount) + toCents(l.adjustment), 0);
  if (total <= 0) return no('O total destas linhas não é maior que zero.');
  const l0 = linhas[0];
  const nome = l0.contactId ? (await tx.finContact.findFirst({ where: { tenantId: env.tenantId, id: l0.contactId }, select: { name: true } }))?.name : (await tx.professional.findFirst({ where: { tenantId: env.tenantId, id: l0.professionalId! }, select: { name: true } }))?.name;
  const dias = linhas.map((l) => dateToDay(l.occurredOn)).sort();
  const periodo = dias[0] === dias[dias.length - 1] ? dias[0].split('-').reverse().join('/') : `${dias[0].split('-').reverse().join('/')} a ${dias[dias.length - 1].split('-').reverse().join('/')}`;
  const r = await createTitlesTx(tx, env.tenantId, env.userId, {
    direction: 'PAYABLE',
    origin: 'COMMISSION',
    professionalId: l0.contactId ? null : l0.professionalId,
    contactId: l0.contactId,
    categoryId: env.settings.commissionCategoryId ?? categoryId(env.tenantId, SYSTEM_CATEGORY.comissao),
    accountId: env.settings.commissionAccountId,
    methodId: input.methodId ?? null,
    issueDate: env.today,
    dueDate: input.dueDate,
    competence: competenceOf(dias[dias.length - 1]),
    amountCents: total,
    description: `${linhas.some((l) => l.kind === 'TRANSFER') && linhas.every((l) => l.kind === 'TRANSFER') ? 'Repasse' : 'Comissão'} de ${nome ?? 'profissional'} · ${periodo}`.slice(0, 300),
  });
  if (!r.ok) return r;
  const titleId = r.data.ids[0];
  await tx.commissionEntry.updateMany({ where: { tenantId: env.tenantId, id: { in: input.ids } }, data: { payableTitleId: titleId } });
  await tx.financialTitle.updateMany({ where: { tenantId: env.tenantId, id: titleId }, data: { originId: titleId } });
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'COMMISSION_INVOICE', entity: 'FinancialTitle', entityId: titleId, metadata: { linhas: linhas.length, total: fromCents(total) } } });
  return { ok: true, titleId, totalCents: total };
}

/** Conta a pagar de comissão cancelada: as linhas voltam para "aprovada", prontas para faturar de novo. */
export async function releaseCancelledInvoicesTx(tx: Tx, tenantId: string, titleId: string): Promise<void> {
  await tx.commissionEntry.updateMany({ where: { tenantId, payableTitleId: titleId }, data: { payableTitleId: null } });
}
