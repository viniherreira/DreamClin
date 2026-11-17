import 'server-only';

import { randomUUID } from 'node:crypto';
import { Prisma } from '@clinicaiq/db';
import { accountAllowed, discountLimitPercent, type FinAccessInput } from '@/lib/financeiro/access';
import { signedAmount } from '@/lib/financeiro/balance';
import { cardReceivables, settlementRule, totalFee } from '@/lib/financeiro/card';
import { competenceOf, dateToDay, dayToDate, isDay, type Day } from '@/lib/financeiro/dates';
import { SYSTEM_CATEGORY } from '@/lib/financeiro/defaults';
import { lateCharges } from '@/lib/financeiro/interest';
import { fromCents, toCents } from '@/lib/financeiro/money';
import type { FinanceSettings } from '@/lib/financeiro/settings';
import { discountPercent, planSettlement } from '@/lib/financeiro/settlement';
import { settledStatus } from '@/lib/financeiro/title-status';
import { refreshBillingTx } from './billing-sync';
import { openCashOf } from './cash';
import { nextCode } from './codes';
import { categoryId, defaultAccountId } from './setup';
import type { Tx } from './titles';

/**
 * Receber e pagar: baixa um título com um ou mais meios, num passo só.
 *
 * Tudo acontece numa transação que começa travando a linha do título
 * (`FOR UPDATE`): duas pessoas baixando a mesma conta ao mesmo tempo entram em
 * fila, e a segunda encontra o valor em aberto já mudado e é recusada.
 */

export interface SettleLine {
  methodId: string;
  /** Em branco, a conta da forma (ou a conta padrão). */
  accountId?: string | null;
  amountCents: number;
  paidOn: Day;
  document?: string | null;
  documentNumber?: string | null;
  installments?: number;
  cardBrand?: string | null;
  nsu?: string | null;
  checkBank?: string | null;
  checkNumber?: string | null;
  checkHolder?: string | null;
  checkDate?: Day | null;
}

export interface SettleInput {
  titleId: string;
  /** O em aberto que a tela mostrou. Se mudou, alguém baixou antes. */
  expectedOpenCents?: number;
  lines: SettleLine[];
  discountCents?: number;
  surchargeCents?: number;
  interestCents?: number;
  fineCents?: number;
  change?: 'RETURN' | 'WALLET';
  /** Liberação aprovada por um dono ou administrador (desconto acima do limite, tirar juros). */
  releaseId?: string | null;
  description?: string | null;
}

export interface SettleEnv {
  tenantId: string;
  userId: string | null;
  access: FinAccessInput;
  settings: FinanceSettings;
  today: Day;
  /** A unidade em que a pessoa está: escolhe o caixa aberto dela nessa unidade. */
  unitId?: string | null;
  /** Migração e rotinas internas: não confere limite de desconto, caixa nem data futura. */
  system?: boolean;
}

export type SettleCode = 'NEEDS_RELEASE' | 'CASH_CLOSED' | 'STALE' | 'INVALID';

export type SettleResult =
  | {
      ok: true;
      receiptGroupId: string;
      transactionIds: string[];
      changeCents: number;
      walletCreditCents: number;
      titleStatus: 'OPEN' | 'PARTIAL' | 'PAID' | 'CANCELLED' | 'RENEGOTIATED';
      remainingCents: number;
    }
  | { ok: false; message: string; code: SettleCode };

const no = (message: string, code: SettleCode = 'INVALID'): SettleResult => ({ ok: false, message, code });

/** Trava a carteira do paciente até o fim da transação e devolve o saldo. */
export async function lockWallet(tx: Tx, tenantId: string, patientId: string): Promise<number> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fin-wallet:${tenantId}:${patientId}`}))`);
  const soma = await tx.walletEntry.aggregate({ where: { tenantId, patientId }, _sum: { amount: true } });
  return toCents(soma._sum.amount);
}

export async function settleTitleTx(tx: Tx, env: SettleEnv, input: SettleInput): Promise<SettleResult> {
  const { tenantId } = env;

  // 1. Trava o título. Quem chegar depois espera aqui e lê o valor já atualizado.
  await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "financial_titles" WHERE "id" = ${input.titleId} AND "tenantId" = ${tenantId} FOR UPDATE`);
  const title = await tx.financialTitle.findFirst({ where: { tenantId, id: input.titleId } });
  if (!title) return no('Conta não encontrada.');
  if (title.status === 'PAID') return no('Esta conta já está paga.', 'STALE');
  if (title.status !== 'OPEN' && title.status !== 'PARTIAL') return no('Esta conta está encerrada e não aceita pagamento.', 'STALE');

  const open = toCents(title.amount) - toCents(title.paidAmount);
  if (input.expectedOpenCents != null && input.expectedOpenCents !== open) {
    return no('Esta conta acabou de receber outro lançamento. Confira o valor em aberto e tente de novo.', 'STALE');
  }

  const receber = title.direction === 'RECEIVABLE';
  const discount = Math.max(0, Math.round(input.discountCents ?? 0));
  const surcharge = Math.max(0, Math.round(input.surchargeCents ?? 0));
  const interest = Math.max(0, Math.round(input.interestCents ?? 0));
  const fine = Math.max(0, Math.round(input.fineCents ?? 0));

  // 2. Linhas: datas e formas.
  if (input.lines.length === 0) return no('Informe ao menos um meio de pagamento.');
  if (input.lines.length > 10) return no('São no máximo 10 meios no mesmo recebimento.');
  for (const l of input.lines) {
    if (!isDay(l.paidOn)) return no('Confira a data do pagamento.');
    if (!env.system && l.paidOn > env.today) return no('A data do pagamento não pode ser no futuro.');
  }
  const formas = await tx.finPaymentMethod.findMany({ where: { tenantId, id: { in: input.lines.map((l) => l.methodId) } }, include: { fees: true } });
  const formaDe = new Map(formas.map((f) => [f.id, f]));
  for (const l of input.lines) {
    const f = formaDe.get(l.methodId);
    if (!f) return no('Forma de pagamento não encontrada.');
    if (!f.active && !env.system) return no(`A forma "${f.name}" está desativada.`);
    if (!env.system && ((receber && f.usage === 'PAY') || (!receber && f.usage === 'RECEIVE'))) return no(`A forma "${f.name}" não serve para ${receber ? 'receber' : 'pagar'}.`);
    if (f.kind === 'WALLET' && (!receber || !title.patientId)) return no('A carteira só paga conta de paciente.');
    if (f.requireDocNumber && !l.documentNumber?.trim()) return no(`A forma "${f.name}" exige o número do documento.`);
    const cartao = f.kind === 'CREDIT_CARD' || f.kind === 'DEBIT_CARD';
    if (cartao && receber && env.settings.requireCardData && !env.system && (!l.cardBrand?.trim() || !l.nsu?.trim())) return no('Informe a bandeira e o número da autorização do cartão.');
    const parcelas = l.installments ?? 1;
    if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > Math.max(1, f.maxInstallments)) return no(`"${f.name}" aceita até ${Math.max(1, f.maxInstallments)} parcela(s).`);
    if (l.checkDate && !isDay(l.checkDate)) return no('Confira a data do cheque.');
  }

  // 3. A conta do recebimento.
  const plano = planSettlement({
    open,
    lines: input.lines.map((l) => ({ amount: l.amountCents, isCash: formaDe.get(l.methodId)!.kind === 'CASH' })),
    discount,
    surcharge,
    interest,
    fine,
    change: input.change,
    walletAvailable: receber && Boolean(title.patientId),
  });
  if (!plano.ok) return no(plano.message);
  if (!receber && (plano.change > 0 || plano.walletCredit > 0)) return no('O valor passa do que falta pagar.');

  // 4. Limites: desconto e juros de conta vencida. Quem passa do limite precisa de uma liberação.
  const referencia = input.lines.reduce((m, l) => (l.paidOn > m ? l.paidOn : m), input.lines[0].paidOn);
  let precisaLiberar: 'DISCOUNT' | 'WAIVE_LATE' | null = null;
  if (receber && !env.system) {
    const limite = discountLimitPercent(env.access, env.settings.defaultMaxDiscountPercent);
    if (discount > 0 && discountPercent(discount, open) > limite + 1e-9) precisaLiberar = 'DISCOUNT';
    if (env.settings.lateChargesEnabled) {
      const devido = lateCharges(open, dateToDay(title.dueDate), referencia, { finePercent: env.settings.finePercent, dailyInterestPercent: env.settings.dailyInterestPercent });
      const semLimite = env.access.role === 'OWNER' || env.access.role === 'ADMIN';
      // Baixa parcial não cobra tudo de uma vez: só confere quando o título está sendo quitado.
      if (plano.remaining === 0 && interest + fine < devido.interest + devido.fine && !semLimite) precisaLiberar ??= 'WAIVE_LATE';
    }
  }
  let liberacao: { id: string } | null = null;
  if (precisaLiberar) {
    const r = input.releaseId ? await tx.financialRelease.findFirst({ where: { tenantId, id: input.releaseId } }) : null;
    const pedido = (r?.payload ?? {}) as { amountCents?: number };
    const serve =
      r &&
      r.status === 'APPROVED' &&
      !r.usedAt &&
      r.expiresAt > new Date() &&
      r.titleId === title.id &&
      r.kind === precisaLiberar &&
      (precisaLiberar !== 'DISCOUNT' || (pedido.amountCents ?? 0) >= discount);
    if (!serve) {
      return no(
        precisaLiberar === 'DISCOUNT'
          ? 'Este desconto passa do seu limite. Peça a liberação de um dono ou administrador.'
          : 'Tirar os juros e a multa desta conta precisa da liberação de um dono ou administrador.',
        'NEEDS_RELEASE',
      );
    }
    liberacao = { id: r.id };
  }

  // 5. Contas, caixa e carteira.
  const contaPadrao = (await tx.financialAccount.findFirst({ where: { tenantId, isDefault: true, active: true }, select: { id: true } }))?.id ?? defaultAccountId(tenantId);
  const contas = new Map((await tx.financialAccount.findMany({ where: { tenantId }, select: { id: true, active: true } })).map((c) => [c.id, c]));
  const caixa = await openCashOf(tx, tenantId, env.userId, env.unitId, true);

  const linhas = [] as { line: SettleLine; forma: (typeof formas)[number]; accountId: string | null; cashSessionId: string | null }[];
  for (const l of input.lines) {
    const forma = formaDe.get(l.methodId)!;
    let accountId: string | null = null;
    let cashSessionId: string | null = null;
    if (forma.kind !== 'WALLET') {
      if (forma.kind === 'CASH' && caixa) {
        // Dinheiro com o caixa aberto entra no caixa de quem recebeu.
        accountId = l.accountId ?? caixa.accountId;
        cashSessionId = caixa.id;
      } else {
        accountId = l.accountId ?? forma.accountId ?? contaPadrao;
        if (caixa && receber) cashSessionId = caixa.id;
      }
      const conta = contas.get(accountId);
      if (!conta) return no('Conta não encontrada.');
      if (!conta.active && !env.system) return no('A conta escolhida está desativada.');
      if (!env.system && !accountAllowed(env.access, accountId)) return no('Seu acesso não permite movimentar esta conta.');
      if (forma.kind === 'CASH' && receber && !caixa && env.settings.requireOpenCashForCash && !env.system) {
        return no('Abra o caixa para receber em dinheiro.', 'CASH_CLOSED');
      }
    }
    linhas.push({ line: l, forma, accountId, cashSessionId });
  }

  const usoCarteira = linhas.reduce((s, x, i) => (x.forma.kind === 'WALLET' ? s + plano.lines[i].kept : s), 0);
  if (usoCarteira > 0 || plano.walletCredit > 0) {
    const saldo = await lockWallet(tx, tenantId, title.patientId!);
    if (usoCarteira > saldo) return no(`O saldo da carteira (${(saldo / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) não cobre este valor.`);
  }

  // 6. Grava os movimentos.
  const receiptGroupId = randomUUID();
  let code = await nextCode(tx, tenantId, 'transaction');
  const transactionIds: string[] = [];
  const taxaCategoria = categoryId(tenantId, SYSTEM_CATEGORY.taxaCartao);
  const espelha = receber && Boolean(title.patientId);

  for (let i = 0; i < linhas.length; i++) {
    const { line, forma, accountId, cashSessionId } = linhas[i];
    const p = plano.lines[i];
    if (p.kept <= 0) continue;
    const carteira = forma.kind === 'WALLET';
    const cartao = forma.kind === 'CREDIT_CARD' || forma.kind === 'DEBIT_CARD';
    const principal = p.principal + p.discount;
    const parcelas = cartao ? (line.installments ?? 1) : 1;
    const recebiveis =
      cartao && receber
        ? cardReceivables(
            p.kept,
            parcelas,
            forma.fees.map((f) => ({ upToInstallments: f.upToInstallments, percent: f.percent == null ? null : Number(f.percent), fixedCents: f.fixed == null ? null : toCents(f.fixed) })),
            line.paidOn,
            settlementRule(forma.settlementType, forma.settlementValue),
          )
        : [];
    const compensa = recebiveis[0]?.expectedDate ?? (forma.kind === 'CHECK' && line.checkDate ? line.checkDate : null);

    let mirrorPaymentId: string | null = null;
    if (espelha && principal > 0) {
      const espelho = await tx.payment.create({
        data: {
          tenantId,
          patientId: title.patientId!,
          quoteId: title.quoteId,
          amount: fromCents(principal),
          method: forma.name,
          notes: input.description?.trim() || title.description || null,
          paidAt: line.paidOn === env.today ? new Date() : new Date(`${line.paidOn}T15:00:00.000Z`),
          createdById: env.userId,
        },
        select: { id: true },
      });
      mirrorPaymentId = espelho.id;
    }

    const id = randomUUID();
    await tx.financialTransaction.create({
      data: {
        id,
        tenantId,
        code: code++,
        kind: receber ? 'RECEIPT' : 'PAYMENT',
        origin: title.origin,
        originId: title.originId,
        titleId: title.id,
        accountId,
        cashSessionId,
        methodId: forma.id,
        methodKind: forma.kind,
        patientId: title.patientId,
        contactId: title.contactId,
        categoryId: title.categoryId,
        costCenterId: title.costCenterId,
        document: line.document?.trim() || null,
        documentNumber: line.documentNumber?.trim() || null,
        amount: fromCents(p.kept),
        signedAmount: fromCents(signedAmount(receber ? 'RECEIPT' : 'PAYMENT', p.kept, carteira)),
        principal: fromCents(principal),
        discount: fromCents(p.discount),
        surcharge: fromCents(p.surcharge),
        interest: fromCents(p.interest),
        fine: fromCents(p.fine),
        installments: parcelas,
        cardBrand: line.cardBrand?.trim() || null,
        nsu: line.nsu?.trim() || null,
        checkBank: line.checkBank?.trim() || null,
        checkNumber: line.checkNumber?.trim() || null,
        checkHolder: line.checkHolder?.trim() || null,
        checkDate: line.checkDate ? dayToDate(line.checkDate) : null,
        paidOn: dayToDate(line.paidOn),
        competence: title.competence,
        settlementDate: compensa ? dayToDate(compensa) : null,
        receiptGroupId,
        mirrorPaymentId,
        description: input.description?.trim() || null,
        createdById: env.userId,
      },
    });
    transactionIds.push(id);

    if (carteira) {
      await tx.walletEntry.create({ data: { tenantId, patientId: title.patientId!, amount: fromCents(-p.kept), reason: 'USE', titleId: title.id, transactionId: id, createdById: env.userId } });
    }

    if (recebiveis.length) {
      await tx.cardReceivable.createMany({
        data: recebiveis.map((r) => ({
          tenantId,
          transactionId: id,
          methodId: forma.id,
          operatorContactId: forma.operatorContactId,
          kind: 'CARD',
          installmentNumber: r.number,
          installmentTotal: r.total,
          grossAmount: fromCents(r.gross),
          feeAmount: fromCents(r.fee),
          netAmount: fromCents(r.net),
          expectedDate: dayToDate(r.expectedDate),
        })),
      });
      const taxa = totalFee(recebiveis);
      if (taxa > 0 && env.settings.cardFeeWhen === 'RECEIPT') {
        await tx.financialTransaction.create({
          data: {
            tenantId,
            code: code++,
            kind: 'FEE',
            origin: 'CARD_FEE',
            originId: id,
            accountId,
            methodId: forma.id,
            methodKind: forma.kind,
            contactId: forma.operatorContactId,
            categoryId: forma.feeCategoryId ?? taxaCategoria,
            costCenterId: forma.feeCostCenterId,
            amount: fromCents(taxa),
            signedAmount: fromCents(signedAmount('FEE', taxa)),
            paidOn: dayToDate(line.paidOn),
            competence: competenceOf(line.paidOn),
            receiptGroupId,
            description: `Taxa de cartão (${forma.name}${parcelas > 1 ? ` ${parcelas}x` : ''})`,
            createdById: env.userId,
          },
        });
      }
    } else if (forma.kind === 'CHECK' && receber) {
      await tx.cardReceivable.create({
        data: { tenantId, transactionId: id, methodId: forma.id, kind: 'CHECK', grossAmount: fromCents(p.kept), netAmount: fromCents(p.kept), expectedDate: dayToDate(line.checkDate ?? line.paidOn) },
      });
    }
  }

  // 7. Dinheiro a mais que o paciente deixou como crédito.
  if (plano.walletCredit > 0) {
    const { line, forma, accountId, cashSessionId } = linhas[plano.excessLine];
    const id = randomUUID();
    await tx.financialTransaction.create({
      data: {
        id,
        tenantId,
        code: code++,
        kind: 'RECEIPT',
        origin: 'WALLET',
        originId: title.patientId,
        accountId,
        cashSessionId,
        methodId: forma.id,
        methodKind: forma.kind,
        patientId: title.patientId,
        categoryId: categoryId(tenantId, SYSTEM_CATEGORY.carteira),
        amount: fromCents(plano.walletCredit),
        signedAmount: fromCents(signedAmount('RECEIPT', plano.walletCredit)),
        paidOn: dayToDate(line.paidOn),
        competence: competenceOf(line.paidOn),
        receiptGroupId,
        description: 'Troco guardado como crédito na carteira',
        createdById: env.userId,
      },
    });
    await tx.walletEntry.create({ data: { tenantId, patientId: title.patientId!, amount: fromCents(plano.walletCredit), reason: 'CHANGE', transactionId: id, description: 'Troco guardado', createdById: env.userId } });
    transactionIds.push(id);
  }

  // 8. Atualiza o título.
  const pago = toCents(title.paidAmount) + plano.settled;
  const titleStatus = settledStatus(toCents(title.amount), pago, title.status);
  await tx.financialTitle.update({ where: { id: title.id }, data: { paidAmount: fromCents(pago), status: titleStatus } });
  if (liberacao) await tx.financialRelease.update({ where: { id: liberacao.id }, data: { usedAt: new Date() } });
  // Título de agendamento: a situação financeira dele na agenda acompanha.
  if (title.appointmentId) await refreshBillingTx(tx, tenantId, title.appointmentId);

  return { ok: true, receiptGroupId, transactionIds, changeCents: plano.change, walletCreditCents: plano.walletCredit, titleStatus, remainingCents: plano.remaining };
}
