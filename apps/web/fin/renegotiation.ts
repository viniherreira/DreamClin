import 'server-only';

import { randomUUID } from 'node:crypto';
import { Prisma, type TenantPrismaClient } from '@clinicaiq/db';
import { discountLimitPercent, type FinAccessInput } from '@/lib/financeiro/access';
import { dateToDay, isDay, type Day } from '@/lib/financeiro/dates';
import { SYSTEM_CATEGORY } from '@/lib/financeiro/defaults';
import { fromCents, toCents } from '@/lib/financeiro/money';
import { correctTitles, planRenegotiation, type PlanInput } from '@/lib/financeiro/renegotiation';
import type { FinanceSettings } from '@/lib/financeiro/settings';
import { refreshBillingOfTitlesTx } from './billing-sync';
import { nextCode } from './codes';
import { settleTitleTx, type SettleLine } from './settle';
import { categoryId } from './setup';
import { createTitlesTx, type Tx } from './titles';

/**
 * Renegociação: as contas em aberto escolhidas ficam RENEGOCIADO (sem mexer em
 * dinheiro) e nascem as contas novas (entrada + parcelas), ligadas ao registro
 * da renegociação. Desfazer só se nenhuma conta nova recebeu pagamento.
 */

export interface RenegEnv {
  tenantId: string;
  userId: string | null;
  unitId?: string | null;
  access: FinAccessInput;
  settings: FinanceSettings;
  today: Day;
}

export interface RenegInput {
  titleIds: string[];
  discountCents: number;
  downPaymentCents: number;
  /** Vencimento da entrada. Hoje com a forma escolhida: a entrada já é recebida. */
  downPaymentDate?: Day | null;
  downPaymentMethodId?: string | null;
  installments: number;
  interval: PlanInput['interval'];
  firstDueDate: Day;
  /** Juros do parcelamento (% ao mês). Diferente do padrão da clínica pede dono ou administrador. */
  monthlyInterestPercent?: number | null;
  mode?: 'SIMPLE' | 'PRICE' | null;
  /** Cobrar multa e juros das vencidas. Tirar pede dono ou administrador. */
  chargeLate?: boolean;
  categoryId?: string | null;
  accountId?: string | null;
  documentNumber?: string | null;
}

export type RenegResult = { ok: true; renegotiationId: string; code: number; newTitleIds: string[]; receiptGroupId: string | null } | { ok: false; message: string };
const no = (message: string): { ok: false; message: string } => ({ ok: false, message });

const gestor = (env: RenegEnv) => env.access.role === 'OWNER' || env.access.role === 'ADMIN';

/** O valor corrigido de cada conta, para o passo 1 do assistente. */
export async function correctedFor(db: Tx | TenantPrismaClient, env: RenegEnv, titleIds: string[], chargeLate = true) {
  const titulos = await db.financialTitle.findMany({ where: { tenantId: env.tenantId, id: { in: titleIds }, direction: 'RECEIVABLE', status: { in: ['OPEN', 'PARTIAL'] } }, select: { id: true, amount: true, paidAmount: true, dueDate: true } });
  const regra = chargeLate && env.settings.lateChargesEnabled ? { finePercent: env.settings.finePercent, dailyInterestPercent: env.settings.dailyInterestPercent } : null;
  return correctTitles(
    titulos.map((t) => ({ id: t.id, openCents: Math.max(0, toCents(t.amount) - toCents(t.paidAmount)), dueDate: dateToDay(t.dueDate) })),
    env.today,
    regra,
  );
}

export async function renegotiateTx(tx: Tx, env: RenegEnv, input: RenegInput): Promise<RenegResult> {
  const ids = [...new Set(input.titleIds)].sort();
  if (!ids.length) return no('Escolha as contas a renegociar.');
  if (ids.length > 100) return no('Renegocie até 100 contas de uma vez.');
  if (!isDay(input.firstDueDate)) return no('Confira o primeiro vencimento.');
  if (input.downPaymentCents > 0 && input.downPaymentDate && !isDay(input.downPaymentDate)) return no('Confira a data da entrada.');

  // Trava as contas na mesma ordem (evita espera cruzada com uma baixa ao mesmo tempo).
  for (const id of ids) await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "financial_titles" WHERE "id" = ${id} AND "tenantId" = ${env.tenantId} FOR UPDATE`);
  const titulos = await tx.financialTitle.findMany({ where: { tenantId: env.tenantId, id: { in: ids } } });
  if (titulos.length !== ids.length) return no('Uma das contas não foi encontrada.');
  if (titulos.some((t) => t.direction !== 'RECEIVABLE')) return no('Só se renegociam contas a receber.');
  if (titulos.some((t) => t.status !== 'OPEN' && t.status !== 'PARTIAL')) return no('Uma das contas já foi paga, cancelada ou renegociada. Atualize a tela.');
  const pessoas = new Set(titulos.map((t) => t.patientId ?? `c:${t.contactId ?? ''}`));
  if (pessoas.size !== 1) return no('Renegocie as contas de um cliente de cada vez.');
  const patientId = titulos[0].patientId;
  const contactId = titulos[0].contactId;

  // Tirar multa e juros, ou mudar os juros do parcelamento, é liberação de dono ou administrador.
  const cobraAtraso = input.chargeLate ?? true;
  if (!cobraAtraso && env.settings.lateChargesEnabled && !gestor(env)) return no('Tirar a multa e os juros precisa de um dono ou administrador.');
  const juros = input.monthlyInterestPercent ?? env.settings.renegotiationInterestPercent;
  const modo = input.mode ?? env.settings.renegotiationInterestMode;
  if ((juros !== env.settings.renegotiationInterestPercent || modo !== env.settings.renegotiationInterestMode) && !gestor(env)) {
    return no('Mudar os juros do parcelamento precisa de um dono ou administrador.');
  }

  const corrigidas = await correctedFor(tx, env, ids, cobraAtraso);
  const original = corrigidas.reduce((s, t) => s + t.openCents, 0);
  const corrigido = corrigidas.reduce((s, t) => s + t.corrected, 0);
  const limite = discountLimitPercent(env.access, env.settings.defaultMaxDiscountPercent);
  if (input.discountCents > 0 && (input.discountCents / corrigido) * 100 > limite + 1e-9) return no(`Este desconto passa do seu limite (${String(limite).replace('.', ',')}%). Peça a um dono ou administrador.`);
  const plano = planRenegotiation({
    correctedTotal: corrigido,
    discount: input.discountCents,
    downPayment: input.downPaymentCents,
    installments: input.installments,
    monthlyInterestPercent: juros,
    mode: modo,
    firstDueDate: input.firstDueDate,
    interval: input.interval,
  });
  if (!plano.ok) return plano;
  if (input.downPaymentDate && input.downPaymentDate > input.firstDueDate && plano.lines.length) return no('A entrada vence antes da primeira parcela.');

  const code = await nextCode(tx, env.tenantId, 'renegotiation');
  const renegotiationId = randomUUID();
  await tx.renegotiation.create({
    data: {
      id: renegotiationId,
      tenantId: env.tenantId,
      code,
      patientId,
      contactId,
      originalTotal: fromCents(original),
      correctedTotal: fromCents(corrigido),
      discount: fromCents(input.discountCents),
      downPayment: fromCents(input.downPaymentCents),
      installments: plano.lines.length,
      interestPercent: juros,
      interestMode: modo,
      createdById: env.userId,
    },
  });

  // As antigas: RENEGOCIADO, guardando a situação de antes para desfazer.
  for (const t of titulos) {
    await tx.renegotiationTitle.create({ data: { tenantId: env.tenantId, renegotiationId, titleId: t.id, role: 'OLD', previousStatus: t.status } });
  }
  await tx.financialTitle.updateMany({ where: { tenantId: env.tenantId, id: { in: ids } }, data: { status: 'RENEGOTIATED' } });

  // As novas: entrada (se houver) e as parcelas, todas com a origem RENEGOCIAÇÃO.
  const categoria = input.categoryId || titulos[0].categoryId || categoryId(env.tenantId, SYSTEM_CATEGORY.atendimento);
  const descricao = `Renegociação nº ${code}`;
  const novos: string[] = [];
  const molde = {
    direction: 'RECEIVABLE' as const,
    origin: 'RENEGOTIATION' as const,
    originId: renegotiationId,
    renegotiationId,
    patientId,
    contactId,
    professionalId: titulos[0].professionalId,
    unitId: titulos[0].unitId,
    categoryId: categoria,
    accountId: input.accountId ?? null,
    issueDate: env.today,
    documentNumber: input.documentNumber?.trim() || null,
  };
  let entradaId: string | null = null;
  if (input.downPaymentCents > 0) {
    const vence = input.downPaymentDate ?? env.today;
    const r = await createTitlesTx(tx, env.tenantId, env.userId, { ...molde, dueDate: vence, amountCents: input.downPaymentCents, description: `${descricao} · entrada` });
    if (!r.ok) throw new RenegAbort(r.message);
    entradaId = r.data.ids[0];
    novos.push(entradaId);
  }
  if (plano.lines.length) {
    const r = await createTitlesTx(tx, env.tenantId, env.userId, { ...molde, dueDate: plano.lines[0].dueDate, amountCents: plano.lines.reduce((s, l) => s + l.amount, 0), schedule: plano.lines.map((l) => ({ dueDate: l.dueDate, amountCents: l.amount })), description: descricao });
    if (!r.ok) throw new RenegAbort(r.message);
    novos.push(...r.data.ids);
  }
  for (const id of novos) await tx.renegotiationTitle.create({ data: { tenantId: env.tenantId, renegotiationId, titleId: id, role: 'NEW' } });

  // Entrada paga agora: baixa na hora, com a forma escolhida.
  let receiptGroupId: string | null = null;
  if (entradaId && input.downPaymentMethodId && (input.downPaymentDate ?? env.today) === env.today) {
    const linha: SettleLine = { methodId: input.downPaymentMethodId, amountCents: input.downPaymentCents, paidOn: env.today, accountId: input.accountId ?? null };
    const r = await settleTitleTx(tx, { tenantId: env.tenantId, userId: env.userId, unitId: env.unitId, access: env.access, settings: env.settings, today: env.today }, { titleId: entradaId, lines: [linha] });
    if (!r.ok) throw new RenegAbort(`Entrada: ${r.message}`);
    receiptGroupId = r.receiptGroupId;
  }

  await refreshBillingOfTitlesTx(tx, env.tenantId, ids);
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'RENEGOTIATE', entity: 'Renegotiation', entityId: renegotiationId, metadata: { codigo: code, antigas: ids.length, novas: novos.length, desconto: fromCents(input.discountCents) } } });
  return { ok: true, renegotiationId, code, newTitleIds: novos, receiptGroupId };
}

/** Erro que desfaz a transação inteira da renegociação. */
export class RenegAbort extends Error {}

/** Desfaz: só sem pagamento nas contas novas. As novas são canceladas e as antigas voltam como estavam. */
export async function undoRenegotiationTx(tx: Tx, env: RenegEnv, renegotiationId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "renegotiations" WHERE "id" = ${renegotiationId} AND "tenantId" = ${env.tenantId} FOR UPDATE`);
  const r = await tx.renegotiation.findFirst({ where: { tenantId: env.tenantId, id: renegotiationId }, include: { titles: true } });
  if (!r) return no('Renegociação não encontrada.');
  if (r.undoneAt) return no('Esta renegociação já foi desfeita.');
  const novos = r.titles.filter((t) => t.role === 'NEW').map((t) => t.titleId);
  const antigos = r.titles.filter((t) => t.role === 'OLD');
  for (const id of [...novos].sort()) await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "financial_titles" WHERE "id" = ${id} AND "tenantId" = ${env.tenantId} FOR UPDATE`);
  const pagos = await tx.financialTitle.count({ where: { tenantId: env.tenantId, id: { in: novos }, paidAmount: { gt: 0 } } });
  if (pagos > 0) return no('Uma das contas novas já recebeu pagamento. Estorne o pagamento antes de desfazer a renegociação.');
  await tx.financialTitle.updateMany({ where: { tenantId: env.tenantId, id: { in: novos } }, data: { status: 'CANCELLED', cancelReason: `Renegociação nº ${r.code} desfeita`, cancelledAt: new Date(), cancelledById: env.userId } });
  for (const a of antigos) {
    await tx.financialTitle.updateMany({ where: { tenantId: env.tenantId, id: a.titleId, status: 'RENEGOTIATED' }, data: { status: a.previousStatus ?? 'OPEN' } });
  }
  await tx.renegotiation.update({ where: { id: r.id }, data: { undoneAt: new Date(), undoneById: env.userId } });
  await refreshBillingOfTitlesTx(tx, env.tenantId, antigos.map((a) => a.titleId));
  await tx.auditLog.create({ data: { tenantId: env.tenantId, userId: env.userId, action: 'RENEGOTIATION_UNDONE', entity: 'Renegotiation', entityId: r.id, metadata: { codigo: r.code } } });
  return { ok: true };
}

export interface RenegRow {
  id: string;
  code: number;
  party: string;
  patientId: string | null;
  createdAt: string;
  originalCents: number;
  correctedCents: number;
  discountCents: number;
  downPaymentCents: number;
  installments: number;
  newOpenCents: number;
  newPaidCents: number;
  undone: boolean;
  canUndo: boolean;
}

/** As renegociações, da mais nova para a mais antiga. */
export async function renegotiationList(db: TenantPrismaClient, opts: { patientId?: string } = {}): Promise<RenegRow[]> {
  const lista = await db.renegotiation.findMany({ where: opts.patientId ? { patientId: opts.patientId } : {}, orderBy: { createdAt: 'desc' }, take: 200, include: { titles: { where: { role: 'NEW' }, select: { titleId: true } } } });
  const novos = lista.flatMap((r) => r.titles.map((t) => t.titleId));
  const titulos = new Map((novos.length ? await db.financialTitle.findMany({ where: { id: { in: novos } }, select: { id: true, amount: true, paidAmount: true, status: true } }) : []).map((t) => [t.id, t]));
  const pacientes = new Map((await db.patient.findMany({ where: { id: { in: lista.map((r) => r.patientId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const contatos = new Map((await db.finContact.findMany({ where: { id: { in: lista.map((r) => r.contactId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return lista.map((r) => {
    const ts = r.titles.map((t) => titulos.get(t.titleId)).filter((t): t is NonNullable<typeof t> => Boolean(t));
    const pago = ts.reduce((s, t) => s + toCents(t.paidAmount), 0);
    const aberto = ts.filter((t) => t.status === 'OPEN' || t.status === 'PARTIAL').reduce((s, t) => s + toCents(t.amount) - toCents(t.paidAmount), 0);
    return {
      id: r.id,
      code: r.code,
      party: r.patientId ? (pacientes.get(r.patientId) ?? '') : r.contactId ? (contatos.get(r.contactId) ?? '') : '',
      patientId: r.patientId,
      createdAt: r.createdAt.toISOString(),
      originalCents: toCents(r.originalTotal),
      correctedCents: toCents(r.correctedTotal),
      discountCents: toCents(r.discount),
      downPaymentCents: toCents(r.downPayment),
      installments: r.installments,
      newOpenCents: aberto,
      newPaidCents: pago,
      undone: Boolean(r.undoneAt),
      canUndo: !r.undoneAt && pago === 0,
    };
  });
}

