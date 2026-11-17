import 'server-only';

import { guessMethodKind, SYSTEM_CATEGORY } from '@/lib/financeiro/defaults';
import { fromCents, toCents } from '@/lib/financeiro/money';
import { clinicToday } from '@/lib/tz';
import { finContext, type FinContext } from './guard';
import { cancelQuoteTitlesTx, ensureLegacyMigrated, receiveInOrderTx, syncQuoteTitlesTx } from './quotes';
import { reverseTransactionTx } from './reverse';
import { settleTitleTx, type SettleEnv } from './settle';
import { categoryId, ensureFinanceSetup, methodId } from './setup';
import { createTitlesTx, type Tx } from './titles';

/**
 * A ponte das telas antigas para o financeiro novo.
 *
 * As telas de orçamento e a ficha do paciente ainda são as de antes. Na
 * clínica com o financeiro novo ligado, o "Registrar pagamento" e o excluir
 * delas passam por aqui: gravam título e movimento (e o espelho em `Payment`,
 * que é o que essas telas leem). Sem a bandeira, `bridge()` devolve nulo e a
 * ação antiga segue como sempre foi.
 */

export type BridgeResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/** O contexto do financeiro novo desta clínica, já preparada; nulo sem a bandeira. */
export async function bridge(tenantId: string): Promise<FinContext | null> {
  const ctx = await finContext();
  if (!ctx || ctx.tenantId !== tenantId) return null;
  await ensureFinanceSetup(tenantId);
  await ensureLegacyMigrated(tenantId);
  return ctx;
}

const env = (ctx: FinContext): SettleEnv => ({
  tenantId: ctx.tenantId,
  userId: ctx.userId,
  access: { role: ctx.role, permission: ctx.permission },
  settings: ctx.settings,
  today: clinicToday(),
  unitId: ctx.unitId,
});

/** A forma do financeiro novo para um nome digitado nas telas antigas ("PIX", "Cartão de crédito"). */
async function methodByName(tx: Tx, tenantId: string, name: string | null | undefined): Promise<string> {
  const nome = name?.trim();
  if (nome) {
    const achada = await tx.finPaymentMethod.findFirst({ where: { tenantId, active: true, name: { equals: nome, mode: 'insensitive' } }, select: { id: true } });
    if (achada) return achada.id;
  }
  return methodId(tenantId, nome ? guessMethodKind(nome) : 'OTHER');
}

interface PaymentInput {
  patientId: string;
  quoteId?: string | null;
  amountCents: number;
  methodName?: string | null;
  notes?: string | null;
  /** AAAA-MM-DD. Em branco, hoje. */
  paidOn?: string | null;
}

/** Recebe um valor: nas parcelas do orçamento, em ordem, ou como recebimento avulso do paciente. */
export async function bridgePayment(ctx: FinContext, input: PaymentInput): Promise<BridgeResult<{ receiptGroupId: string }>> {
  if (!ctx.can('fin_receber')) return { ok: false, message: 'Seu acesso não permite receber.' };
  const e = env(ctx);
  const paidOn = input.paidOn || e.today;
  if (paidOn > e.today) return { ok: false, message: 'A data do pagamento não pode ser no futuro.' };

  class Desfaz extends Error {}
  try {
    const r = await ctx.db.$transaction(async (tx) => {
      const forma = await methodByName(tx, ctx.tenantId, input.methodName);
      const linha = { methodId: forma, paidOn };
      let titleIds: string[] = [];

      if (input.quoteId) {
        await syncQuoteTitlesTx(tx, ctx.tenantId, ctx.userId, input.quoteId);
        titleIds = (await tx.financialTitle.findMany({ where: { tenantId: ctx.tenantId, quoteId: input.quoteId, status: { in: ['OPEN', 'PARTIAL'] } }, orderBy: [{ installmentNumber: 'asc' }, { dueDate: 'asc' }], select: { id: true } })).map((t) => t.id);
      }
      if (titleIds.length === 0) {
        // Avulso, ou orçamento que ainda não foi aprovado: um título só para este recebimento.
        const quote = input.quoteId ? await tx.quote.findFirst({ where: { tenantId: ctx.tenantId, id: input.quoteId }, select: { number: true } }) : null;
        const novo = await createTitlesTx(tx, ctx.tenantId, ctx.userId, {
          direction: 'RECEIVABLE',
          origin: quote ? 'QUOTE' : 'MANUAL',
          originId: input.quoteId ?? null,
          quoteId: input.quoteId ?? null,
          patientId: input.patientId,
          categoryId: categoryId(ctx.tenantId, quote ? SYSTEM_CATEGORY.orcamento : SYSTEM_CATEGORY.atendimento),
          issueDate: paidOn,
          dueDate: paidOn,
          amountCents: input.amountCents,
          description: input.notes?.trim() || (quote ? `Orçamento ORC-${String(quote.number).padStart(4, '0')} · recebido antes da aprovação` : 'Recebimento avulso'),
        });
        if (!novo.ok) throw new Desfaz(novo.message);
        titleIds = novo.data.ids;
      }
      const recebido = await receiveInOrderTx(tx, e, titleIds, input.amountCents, linha, input.notes);
      // Qualquer recusa desfaz tudo, inclusive o título criado acima.
      if (!recebido.ok) throw new Desfaz(recebido.message);
      return recebido;
    });
    await ctx.db.auditLog.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, action: 'RECEIVE', entity: 'Patient', entityId: input.patientId, metadata: { recibo: r.receiptGroupId, valor: fromCents(input.amountCents) } } });
    return { ok: true, receiptGroupId: r.receiptGroupId };
  } catch (err) {
    if (err instanceof Desfaz) return { ok: false, message: err.message };
    throw err;
  }
}

/** Excluir um pagamento nas telas antigas vira estorno: nada é apagado do financeiro. */
export async function bridgeDeletePayment(ctx: FinContext, paymentId: string): Promise<BridgeResult> {
  if (!ctx.can('fin_estornar')) return { ok: false, message: 'Excluir um pagamento é um estorno, e só dono ou administrador estorna.' };
  const movimentos = await ctx.db.financialTransaction.findMany({ where: { mirrorPaymentId: paymentId, reversedAt: null, kind: { not: 'REVERSAL' } }, select: { id: true } });
  if (movimentos.length === 0) return { ok: false, message: 'Pagamento não encontrado.' };
  for (const m of movimentos) {
    const r = await ctx.db.$transaction((tx) =>
      reverseTransactionTx(tx, { tenantId: ctx.tenantId, userId: ctx.userId, today: clinicToday(), unitId: ctx.unitId }, { transactionId: m.id, reason: 'Pagamento excluído na tela do orçamento ou do paciente', confirmOutOfOrder: true }),
    );
    if (!r.ok) return { ok: false, message: r.message };
  }
  await ctx.db.auditLog.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, action: 'REVERSE', entity: 'Payment', entityId: paymentId } });
  return { ok: true };
}

/** Orçamento aprovado: nascem os títulos do plano de pagamento. */
export async function bridgeQuoteAccepted(ctx: FinContext, quoteId: string): Promise<void> {
  await ctx.db.$transaction((tx) => syncQuoteTitlesTx(tx, ctx.tenantId, ctx.userId, quoteId));
}

/** Orçamento reaberto: os títulos que ainda não receberam nada são cancelados. */
export async function bridgeQuoteReopened(ctx: FinContext, quoteId: string): Promise<void> {
  await ctx.db.$transaction((tx) => cancelQuoteTitlesTx(tx, ctx.tenantId, ctx.userId, quoteId, 'Orçamento reaberto'));
}

/**
 * Excluir orçamento: com pagamento vivo, não pode (estorna primeiro). Sem
 * pagamento, cancela os títulos em aberto e solta os que sobraram do orçamento.
 * Devolve a mensagem de recusa, ou nulo quando pode excluir.
 */
export async function bridgeQuoteDeleting(ctx: FinContext, quoteId: string): Promise<string | null> {
  const pago = await ctx.db.financialTitle.aggregate({ where: { quoteId, status: { not: 'CANCELLED' } }, _sum: { paidAmount: true } });
  if (toCents(pago._sum.paidAmount) > 0) return 'Este orçamento tem pagamento. Estorne os pagamentos antes de excluir.';
  await ctx.db.$transaction(async (tx) => {
    await cancelQuoteTitlesTx(tx, ctx.tenantId, ctx.userId, quoteId, 'Orçamento excluído');
    await tx.financialTitle.updateMany({ where: { tenantId: ctx.tenantId, quoteId }, data: { quoteId: null } });
  });
  return null;
}

export { settleTitleTx };
