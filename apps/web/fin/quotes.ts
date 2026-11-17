import 'server-only';

import { randomUUID } from 'node:crypto';
import { cache } from 'react';
import { getTenantClient, Prisma, prisma, type TenantPrismaClient } from '@clinicaiq/db';
import { signedAmount } from '@/lib/financeiro/balance';
import { competenceOf, dateToDay, dayToDate, type Day } from '@/lib/financeiro/dates';
import { guessMethodKind, SYSTEM_CATEGORY, type MethodKind } from '@/lib/financeiro/defaults';
import { fromCents, toCents } from '@/lib/financeiro/money';
import { settledStatus } from '@/lib/financeiro/title-status';
import { paymentSchedule } from '@/lib/payment-schedule';
import { clinicDayOf, clinicToday } from '@/lib/tz';
import { nextCode } from './codes';
import { settleTitleTx, type SettleEnv, type SettleLine, type SettleResult } from './settle';
import { categoryId, defaultAccountId, methodId, setupFinance } from './setup';
import { createTitlesTx, type Tx } from './titles';

/**
 * Orçamento e financeiro: o plano de pagamento do orçamento aprovado vira
 * títulos (origem ORCAMENTO), e os pagamentos antigos (`Payment`) são copiados
 * para movimentos sem mudar nenhum valor.
 */

const pad4 = (n: number) => String(n).padStart(4, '0');
export const quoteGroupId = (quoteId: string) => `q_${quoteId}`;

interface QuoteLike {
  id: string;
  number: number;
  patientId: string;
  professionalId: string | null;
  total: unknown;
  downPayment: unknown;
  installments: number;
  paymentMethod: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
}

const QUOTE_SELECT = { id: true, number: true, patientId: true, professionalId: true, total: true, downPayment: true, installments: true, paymentMethod: true, acceptedAt: true, createdAt: true, status: true } as const;

/** As parcelas do orçamento, em centavos e com data, a partir do dia da aprovação. */
function quoteSchedule(q: QuoteLike): { label: string; dueDate: Day; amountCents: number }[] {
  const inicio = clinicDayOf(q.acceptedAt ?? q.createdAt);
  return paymentSchedule({ total: Number(q.total), downPayment: Number(q.downPayment), installments: q.installments, method: q.paymentMethod }, inicio).map((p) => ({ label: p.label, dueDate: p.dueDate, amountCents: toCents(p.amount) }));
}

/**
 * Garante os títulos de um orçamento aprovado.
 *
 * Primeira vez: uma parcela do plano por título. Depois de reabrir e aprovar de
 * novo, o que já tem pagamento fica como está e o que falta do total é
 * repartido de novo (os sem pagamento foram cancelados na reabertura).
 */
export async function syncQuoteTitlesTx(tx: Tx, tenantId: string, userId: string | null, quoteId: string): Promise<{ created: number }> {
  const q = await tx.quote.findFirst({ where: { tenantId, id: quoteId }, select: QUOTE_SELECT });
  if (!q || q.status !== 'ACCEPTED') return { created: 0 };
  const totalCents = toCents(q.total);
  if (totalCents <= 0) return { created: 0 };

  const vivos = await tx.financialTitle.findMany({ where: { tenantId, quoteId, status: { not: 'CANCELLED' } }, select: { amount: true } });
  const coberto = vivos.reduce((s, t) => s + toCents(t.amount), 0);
  const falta = totalCents - coberto;
  if (falta <= 0) return { created: 0 };

  const plano = quoteSchedule(q);
  let parcelas = plano;
  if (coberto > 0) {
    // Reaprovação: reparte só o que falta, nas parcelas que restam do plano.
    const restantes = plano.slice(Math.min(vivos.length, Math.max(0, plano.length - 1)));
    const n = Math.max(1, restantes.length);
    const base = Math.floor(falta / n);
    parcelas = Array.from({ length: n }, (_, i) => ({
      label: restantes[i]?.label ?? 'Saldo',
      dueDate: restantes[i]?.dueDate ?? clinicToday(),
      amountCents: i === n - 1 ? falta - base * (n - 1) : base,
    }));
  }

  const cat = categoryId(tenantId, SYSTEM_CATEGORY.orcamento);
  const r = await createTitlesTx(tx, tenantId, userId, {
    direction: 'RECEIVABLE',
    origin: 'QUOTE',
    originId: q.id,
    quoteId: q.id,
    patientId: q.patientId,
    professionalId: q.professionalId,
    categoryId: cat,
    issueDate: clinicDayOf(q.acceptedAt ?? q.createdAt),
    dueDate: parcelas[0].dueDate,
    amountCents: falta,
    schedule: parcelas.map((p) => ({ dueDate: p.dueDate, amountCents: p.amountCents })),
    groupId: quoteGroupId(q.id),
    description: `Orçamento ORC-${pad4(q.number)}`,
  });
  if (!r.ok) throw new Error(`títulos do orçamento: ${r.message}`);
  // Descrição de cada parcela e numeração seguindo as que já existiam.
  for (let i = 0; i < r.data.ids.length; i++) {
    await tx.financialTitle.update({
      where: { id: r.data.ids[i] },
      data: { description: `Orçamento ORC-${pad4(q.number)} · ${parcelas[i].label}`, installmentNumber: vivos.length + i + 1, installmentTotal: vivos.length + parcelas.length },
    });
  }
  if (vivos.length) await tx.financialTitle.updateMany({ where: { tenantId, quoteId, status: { not: 'CANCELLED' } }, data: { installmentTotal: vivos.length + parcelas.length } });
  return { created: r.data.ids.length };
}

/** Orçamento reaberto ou excluído: cancela os títulos que ainda não receberam nada. */
export async function cancelQuoteTitlesTx(tx: Tx, tenantId: string, userId: string | null, quoteId: string, reason: string): Promise<number> {
  const r = await tx.financialTitle.updateMany({
    where: { tenantId, quoteId, status: 'OPEN', paidAmount: 0 },
    data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date(), cancelledById: userId },
  });
  return r.count;
}

/** O orçamento tem pagamento vivo? (Para recusar a exclusão.) */
export async function quoteHasReceipts(db: TenantPrismaClient, quoteId: string): Promise<boolean> {
  return (await db.financialTitle.count({ where: { quoteId, paidAmount: { gt: 0 }, status: { not: 'CANCELLED' } } })) > 0;
}

/**
 * Recebe um valor distribuindo pelas parcelas em ordem, como a clínica pensa
 * ("pagou a entrada e duas"). Usado pelo "Registrar pagamento" do orçamento.
 */
export async function receiveInOrderTx(
  tx: Tx,
  env: SettleEnv,
  titleIds: string[],
  amountCents: number,
  line: Omit<SettleLine, 'amountCents'>,
  description?: string | null,
): Promise<SettleResult & { settledTitles?: number }> {
  let resto = amountCents;
  let ultimo: SettleResult | null = null;
  const ids: string[] = [];
  let quitados = 0;
  for (const titleId of titleIds) {
    if (resto <= 0) break;
    const t = await tx.financialTitle.findFirst({ where: { tenantId: env.tenantId, id: titleId }, select: { amount: true, paidAmount: true, status: true } });
    if (!t || (t.status !== 'OPEN' && t.status !== 'PARTIAL')) continue;
    const aberto = toCents(t.amount) - toCents(t.paidAmount);
    if (aberto <= 0) continue;
    const parte = Math.min(aberto, resto);
    const r = await settleTitleTx(tx, env, { titleId, lines: [{ ...line, amountCents: parte }], description });
    if (!r.ok) return r;
    ids.push(...r.transactionIds);
    ultimo = r;
    resto -= parte;
    quitados += 1;
  }
  if (!ultimo) return { ok: false, message: 'Não há parcela em aberto para receber.', code: 'INVALID' };
  if (resto > 0) return { ok: false, message: 'O valor passa do que falta receber.', code: 'INVALID' };
  return { ...ultimo, transactionIds: ids, settledTitles: quitados };
}

// ─── Migração do financeiro antigo ───────────────────────────────────────────

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** Há orçamento aprovado sem título ou pagamento antigo sem movimento? Duas consultas baratas. */
export async function legacyPending(tenantId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ pendente: boolean }[]>(Prisma.sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM "payments" p
        WHERE p."tenantId" = ${tenantId}
          AND NOT EXISTS (SELECT 1 FROM "financial_transactions" t WHERE t."tenantId" = ${tenantId} AND (t."mirrorPaymentId" = p."id" OR t."legacyPaymentId" = p."id"))
      )
      OR EXISTS (
        SELECT 1 FROM "quotes" q
        WHERE q."tenantId" = ${tenantId} AND q."status" = 'ACCEPTED' AND q."total" > 0
          AND COALESCE((SELECT sum(ft."amount") FROM "financial_titles" ft WHERE ft."tenantId" = ${tenantId} AND ft."quoteId" = q."id" AND ft."status" <> 'CANCELLED'), 0) < q."total"
      )
    ) AS pendente`);
  return Boolean(rows[0]?.pendente);
}

/**
 * Copia o financeiro antigo da clínica para o novo, sem mudar nenhum valor:
 * - orçamento aprovado ganha os títulos do plano de pagamento;
 * - cada `Payment` vira movimento(s), distribuído pelas parcelas em ordem;
 * - pagamento avulso (sem orçamento) vira um título já pago.
 *
 * O `Payment` antigo não é alterado: passa a ser o espelho do movimento.
 * Roda numa transação e pode rodar de novo: só pega o que ainda não foi copiado.
 */
export async function migrateLegacy(tenantId: string): Promise<{ titles: number; transactions: number }> {
  const db = getTenantClient(tenantId);
  await setupFinance(tenantId);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fin-migrate:${tenantId}`}))`);
      let titles = 0;
      let transactions = 0;

      const formas = await tx.finPaymentMethod.findMany({ where: { tenantId }, select: { id: true, name: true, kind: true, accountId: true } });
      const porNome = new Map(formas.map((f) => [slug(f.name), f]));
      const porId = new Map(formas.map((f) => [f.id, f]));
      const contaPadrao = defaultAccountId(tenantId);
      const formaDe = (nome: string | null) => {
        const kind: MethodKind = nome ? guessMethodKind(nome) : 'OTHER';
        return (nome ? porNome.get(slug(nome)) : undefined) ?? porId.get(methodId(tenantId, kind)) ?? porId.get(methodId(tenantId, 'OTHER'))!;
      };

      let code = await nextCode(tx, tenantId, 'transaction');
      const jaCopiados = new Set(
        (
          await tx.financialTransaction.findMany({
            where: { tenantId, OR: [{ legacyPaymentId: { not: null } }, { mirrorPaymentId: { not: null } }] },
            select: { legacyPaymentId: true, mirrorPaymentId: true },
          })
        ).flatMap((t) => [t.legacyPaymentId, t.mirrorPaymentId].filter((x): x is string => Boolean(x))),
      );

      type Pay = { id: string; patientId: string; amount: unknown; method: string | null; notes: string | null; paidAt: Date; createdById: string | null };
      const grava = async (p: Pay, title: { id: string; categoryId: string; competence: string; origin: 'QUOTE' | 'MANUAL'; originId: string | null }, valor: number, primeiro: boolean) => {
        const forma = formaDe(p.method);
        const carteira = forma.kind === 'WALLET';
        const dia = clinicDayOf(p.paidAt);
        await tx.financialTransaction.create({
          data: {
            tenantId,
            code: code++,
            kind: 'RECEIPT',
            origin: title.origin,
            originId: title.originId,
            titleId: title.id,
            accountId: carteira ? null : (forma.accountId ?? contaPadrao),
            methodId: forma.id,
            methodKind: forma.kind,
            patientId: p.patientId,
            categoryId: title.categoryId,
            amount: fromCents(valor),
            signedAmount: fromCents(signedAmount('RECEIPT', valor, carteira)),
            principal: fromCents(valor),
            paidOn: dayToDate(dia),
            competence: title.competence,
            receiptGroupId: `legacy-${p.id}`,
            // Um `Payment` que cobre duas parcelas vira dois movimentos; só o primeiro leva o vínculo único.
            legacyPaymentId: primeiro ? p.id : null,
            mirrorPaymentId: p.id,
            description: p.notes,
            createdById: p.createdById,
            createdAt: p.paidAt,
          },
        });
        transactions += 1;
      };

      // 1. Orçamentos aprovados: títulos do plano e os pagamentos em ordem.
      const orcamentos = await tx.quote.findMany({ where: { tenantId, status: 'ACCEPTED' }, select: { id: true, number: true }, orderBy: { number: 'asc' } });
      for (const q of orcamentos) {
        titles += (await syncQuoteTitlesTx(tx, tenantId, null, q.id)).created;
      }

      const comOrcamento = await tx.payment.findMany({ where: { tenantId, quoteId: { not: null } }, orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }], include: { quote: { select: { number: true, status: true } } } });
      for (const p of comOrcamento) {
        if (jaCopiados.has(p.id)) continue;
        let resto = toCents(p.amount);
        let primeiro = true;
        const abertos = await tx.financialTitle.findMany({ where: { tenantId, quoteId: p.quoteId, status: { in: ['OPEN', 'PARTIAL'] } }, orderBy: [{ installmentNumber: 'asc' }, { dueDate: 'asc' }] });
        for (const t of abertos) {
          if (resto <= 0) break;
          const aberto = toCents(t.amount) - toCents(t.paidAmount);
          if (aberto <= 0) continue;
          const parte = Math.min(aberto, resto);
          await grava(p, { id: t.id, categoryId: t.categoryId, competence: t.competence, origin: 'QUOTE', originId: p.quoteId }, parte, primeiro);
          const pago = toCents(t.paidAmount) + parte;
          await tx.financialTitle.update({ where: { id: t.id }, data: { paidAmount: fromCents(pago), status: settledStatus(toCents(t.amount), pago, t.status) } });
          resto -= parte;
          primeiro = false;
        }
        if (resto > 0) {
          // Recebido além do plano (ou orçamento não aprovado): um título já pago, para o valor não sumir.
          const dia = clinicDayOf(p.paidAt);
          const id = randomUUID();
          await tx.financialTitle.create({
            data: {
              id,
              tenantId,
              code: await nextCode(tx, tenantId, 'title'),
              direction: 'RECEIVABLE',
              origin: 'QUOTE',
              originId: p.quoteId,
              quoteId: p.quoteId,
              patientId: p.patientId,
              categoryId: categoryId(tenantId, SYSTEM_CATEGORY.orcamento),
              issueDate: dayToDate(dia),
              dueDate: dayToDate(dia),
              competence: competenceOf(dia),
              amount: fromCents(resto),
              paidAmount: fromCents(resto),
              status: 'PAID',
              description: `Orçamento ORC-${pad4(p.quote?.number ?? 0)} · recebido fora das parcelas`,
              createdById: p.createdById,
            },
          });
          titles += 1;
          await grava(p, { id, categoryId: categoryId(tenantId, SYSTEM_CATEGORY.orcamento), competence: competenceOf(dia), origin: 'QUOTE', originId: p.quoteId }, resto, primeiro);
        }
      }

      // 2. Pagamentos avulsos (sem orçamento): um título já pago cada.
      const avulsos = await tx.payment.findMany({ where: { tenantId, quoteId: null }, orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }] });
      for (const p of avulsos) {
        if (jaCopiados.has(p.id)) continue;
        const valor = toCents(p.amount);
        if (valor <= 0) continue;
        const dia = clinicDayOf(p.paidAt);
        const id = randomUUID();
        const cat = categoryId(tenantId, SYSTEM_CATEGORY.atendimento);
        await tx.financialTitle.create({
          data: {
            id,
            tenantId,
            code: await nextCode(tx, tenantId, 'title'),
            direction: 'RECEIVABLE',
            origin: 'MANUAL',
            patientId: p.patientId,
            categoryId: cat,
            issueDate: dayToDate(dia),
            dueDate: dayToDate(dia),
            competence: competenceOf(dia),
            amount: fromCents(valor),
            paidAmount: fromCents(valor),
            status: 'PAID',
            description: p.notes?.trim() || 'Recebimento avulso',
            createdById: p.createdById,
          },
        });
        titles += 1;
        await grava(p, { id, categoryId: cat, competence: competenceOf(dia), origin: 'MANUAL', originId: null }, valor, true);
      }

      return { titles, transactions };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

/** Uma vez por requisição: migra se houver algo antigo ainda não copiado. */
export const ensureLegacyMigrated = cache(async (tenantId: string): Promise<void> => {
  if (await legacyPending(tenantId)) await migrateLegacy(tenantId);
});

/** O "hoje" da clínica, para montar o ambiente de uma baixa. */
export const today = (): Day => clinicToday();
export { dateToDay };
