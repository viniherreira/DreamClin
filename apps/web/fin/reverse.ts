import 'server-only';

import { Prisma } from '@clinicaiq/db';
import { competenceOf, dayToDate, type Day } from '@/lib/financeiro/dates';
import { fromCents, toCents } from '@/lib/financeiro/money';
import { settledStatus } from '@/lib/financeiro/title-status';
import { nextCode } from './codes';
import type { Tx } from './titles';

/**
 * Estorno. Nunca apaga: cria um movimento REVERSAL ligado ao original, reabre
 * o título e devolve o que saiu da carteira. O estorno entra no caixa aberto
 * de hoje de quem estornou; um caixa já fechado nunca é alterado.
 */

export interface ReverseEnv {
  tenantId: string;
  userId: string | null;
  today: Day;
}

export interface ReverseInput {
  transactionId: string;
  reason: string;
  /** Outros movimentos do mesmo recebimento para estornar junto. */
  alsoIds?: string[];
  /** Confirma estornar uma parcela com parcelas seguintes já pagas. */
  confirmOutOfOrder?: boolean;
}

export type ReverseResult =
  | { ok: true; reversedIds: string[]; reopenedTitleIds: string[] }
  | { ok: false; message: string; code?: 'OUT_OF_ORDER' };

const no = (message: string, code?: 'OUT_OF_ORDER'): ReverseResult => ({ ok: false, message, code });

/** Os movimentos que vão junto com este no estorno (a taxa do cartão sempre vai). */
export async function relatedTransactions(tx: Tx, tenantId: string, transactionId: string) {
  const original = await tx.financialTransaction.findFirst({ where: { tenantId, id: transactionId }, select: { id: true, receiptGroupId: true } });
  if (!original) return [];
  return tx.financialTransaction.findMany({
    where: {
      tenantId,
      id: { not: original.id },
      reversedAt: null,
      kind: { not: 'REVERSAL' },
      OR: [{ origin: 'CARD_FEE', originId: original.id }, ...(original.receiptGroupId ? [{ receiptGroupId: original.receiptGroupId }] : [])],
    },
    select: { id: true, code: true, kind: true, origin: true, originId: true, amount: true, methodKind: true, description: true, titleId: true },
    orderBy: { code: 'asc' },
  });
}

export async function reverseTransactionTx(tx: Tx, env: ReverseEnv, input: ReverseInput): Promise<ReverseResult> {
  const { tenantId } = env;
  const motivo = input.reason.trim();
  if (motivo.length < 3) return no('Diga o motivo do estorno.');
  if (motivo.length > 150) return no('O motivo tem no máximo 150 letras.');

  const alvo = await tx.financialTransaction.findFirst({ where: { tenantId, id: input.transactionId } });
  if (!alvo) return no('Movimento não encontrado.');
  if (alvo.kind === 'REVERSAL') return no('Este movimento já é um estorno.');
  if (alvo.reversedAt) return no('Este movimento já foi estornado.');
  if (alvo.kind === 'TRANSFER_IN' || alvo.kind === 'TRANSFER_OUT') return no('Para desfazer uma transferência, estorne pela tela de Transferências.');

  // A taxa do cartão deste movimento vai sempre junto; do resto do recebimento, só o que a pessoa escolheu.
  const relacionados = await relatedTransactions(tx, tenantId, alvo.id);
  const escolhidos = new Set(input.alsoIds ?? []);
  const idsEscolhidos = new Set([alvo.id, ...relacionados.filter((r) => escolhidos.has(r.id)).map((r) => r.id)]);
  const taxas = relacionados.filter((r) => r.origin === 'CARD_FEE' && r.originId && idsEscolhidos.has(r.originId)).map((r) => r.id);
  const ids = [...new Set([...idsEscolhidos, ...taxas])];
  const movimentos = await tx.financialTransaction.findMany({ where: { tenantId, id: { in: ids }, reversedAt: null, kind: { not: 'REVERSAL' } }, orderBy: { code: 'asc' } });

  // Trava os títulos envolvidos, sempre na mesma ordem (evita espera cruzada).
  const titleIds = [...new Set(movimentos.map((m) => m.titleId).filter((x): x is string => Boolean(x)))].sort();
  for (const id of titleIds) await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "financial_titles" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`);
  const titulos = new Map((await tx.financialTitle.findMany({ where: { tenantId, id: { in: titleIds } } })).map((t) => [t.id, t]));

  for (const t of titulos.values()) {
    if (t.status === 'RENEGOTIATED') return no('A conta deste pagamento foi renegociada. Desfaça a renegociação antes de estornar.');
    if (t.status === 'CANCELLED') return no('A conta deste pagamento está cancelada.');
    // Orçamento: o recebido cobre as parcelas em ordem. Estornar uma do meio deixa um buraco.
    if (t.origin === 'QUOTE' && t.groupId && !input.confirmOutOfOrder) {
      const depois = await tx.financialTitle.count({ where: { tenantId, groupId: t.groupId, installmentNumber: { gt: t.installmentNumber }, paidAmount: { gt: 0 }, status: { in: ['PARTIAL', 'PAID'] } } });
      if (depois > 0) return no('Este orçamento tem parcelas seguintes já pagas. Estornar esta deixa uma parcela anterior em aberto. Confirme para continuar.', 'OUT_OF_ORDER');
    }
  }

  const caixa = env.userId ? await tx.cashSession.findFirst({ where: { tenantId, userId: env.userId, status: 'OPEN' }, select: { id: true } }) : null;
  let code = await nextCode(tx, tenantId, 'transaction');
  const agora = new Date();
  const baixa = new Map<string, number>();

  for (const m of movimentos) {
    await tx.financialTransaction.create({
      data: {
        tenantId,
        code: code++,
        kind: 'REVERSAL',
        origin: m.origin,
        originId: m.originId,
        titleId: m.titleId,
        accountId: m.accountId,
        // Nunca o caixa do movimento original (pode estar fechado): o caixa aberto de quem estorna.
        cashSessionId: m.accountId ? (caixa?.id ?? null) : null,
        methodId: m.methodId,
        methodKind: m.methodKind,
        patientId: m.patientId,
        contactId: m.contactId,
        categoryId: m.categoryId,
        costCenterId: m.costCenterId,
        amount: m.amount,
        signedAmount: fromCents(-toCents(m.signedAmount)),
        principal: m.principal,
        discount: m.discount,
        surcharge: m.surcharge,
        interest: m.interest,
        fine: m.fine,
        installments: m.installments,
        paidOn: dayToDate(env.today),
        competence: competenceOf(env.today),
        receiptGroupId: m.receiptGroupId,
        reversalOfId: m.id,
        description: `Estorno: ${motivo}`,
        createdById: env.userId,
      },
    });
    await tx.financialTransaction.update({ where: { id: m.id }, data: { reversedAt: agora, reverseReason: motivo, mirrorPaymentId: null } });
    if (m.titleId) baixa.set(m.titleId, (baixa.get(m.titleId) ?? 0) + toCents(m.principal));

    // Cartão e cheque a compensar deixam de valer.
    await tx.cardReceivable.updateMany({ where: { tenantId, transactionId: m.id, status: 'OPEN' }, data: { status: 'CANCELLED' } });

    // Carteira: o que foi usado volta; o crédito que entrou sai.
    const entradas = await tx.walletEntry.findMany({ where: { tenantId, transactionId: m.id } });
    for (const e of entradas) {
      await tx.walletEntry.create({
        data: { tenantId, patientId: e.patientId, amount: fromCents(-toCents(e.amount)), reason: 'REVERSAL', titleId: e.titleId, transactionId: m.id, description: `Estorno: ${motivo}`, createdById: env.userId },
      });
    }

    // Espelho nas telas antigas: some se ninguém mais o usa; senão, encolhe.
    if (m.mirrorPaymentId) {
      const resto = await tx.financialTransaction.aggregate({ where: { tenantId, mirrorPaymentId: m.mirrorPaymentId, reversedAt: null, kind: { not: 'REVERSAL' }, id: { not: m.id } }, _sum: { principal: true } });
      const sobra = toCents(resto._sum.principal);
      if (sobra > 0) await tx.payment.updateMany({ where: { tenantId, id: m.mirrorPaymentId }, data: { amount: fromCents(sobra) } });
      else await tx.payment.deleteMany({ where: { tenantId, id: m.mirrorPaymentId } });
    }
  }

  const reopenedTitleIds: string[] = [];
  for (const [titleId, valor] of baixa) {
    const t = titulos.get(titleId);
    if (!t) continue;
    const pago = Math.max(0, toCents(t.paidAmount) - valor);
    await tx.financialTitle.update({ where: { id: titleId }, data: { paidAmount: fromCents(pago), status: settledStatus(toCents(t.amount), pago, t.status) } });
    reopenedTitleIds.push(titleId);
  }

  return { ok: true, reversedIds: movimentos.map((m) => m.id), reopenedTitleIds };
}
