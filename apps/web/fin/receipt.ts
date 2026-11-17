import 'server-only';

import type { CouponDocumentProps, ReceiptDocumentProps } from '@clinicaiq/pdf';
import { loadClinicInfo, loadPatientDocData } from '@/lib/documents';
import { valorPorExtenso } from '@/lib/extenso';
import { dateToDay, dayBR } from '@/lib/financeiro/dates';
import { centsToNumber, formatCents, toCents } from '@/lib/financeiro/money';
import { instantDateTimeBR } from '@/lib/tz';
import { finContext } from './guard';

/**
 * O recibo de um recebimento do financeiro novo. Um recebimento pode ter
 * vários meios (PIX + cartão): o recibo é um só, com o total e cada meio.
 */

export interface ReceiptBundle {
  number: string;
  a4: ReceiptDocumentProps;
  coupon: CouponDocumentProps;
  patientId: string | null;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const porExtenso = (day: string) => {
  const [a, m, d] = day.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
};

/**
 * Monta o recibo de um grupo de recebimento. Aceita também o id de um
 * pagamento antigo (`Payment`), para os links de recibo de antes continuarem
 * abrindo. Nulo se a pessoa não alcança ou o recebimento foi todo estornado.
 */
export async function receiptBundle(idOrGroup: string): Promise<ReceiptBundle | null> {
  const ctx = await finContext();
  if (!ctx || !ctx.can('fin_ver')) return null;
  const { db, tenantId, settings } = ctx;

  let groupId = idOrGroup;
  const antigo = await db.financialTransaction.findFirst({ where: { OR: [{ legacyPaymentId: idOrGroup }, { mirrorPaymentId: idOrGroup }] }, select: { receiptGroupId: true } });
  if (antigo?.receiptGroupId) groupId = antigo.receiptGroupId;

  const movimentos = await db.financialTransaction.findMany({
    where: { receiptGroupId: groupId, kind: 'RECEIPT', reversedAt: null },
    orderBy: { code: 'asc' },
    include: { title: { select: { description: true, quoteId: true, professionalId: true, contact: { select: { name: true } } } } },
  });
  if (movimentos.length === 0) return null;

  const primeiro = movimentos[0];
  const patientId = movimentos.find((m) => m.patientId)?.patientId ?? null;
  const quoteId = movimentos.find((m) => m.title?.quoteId)?.title?.quoteId ?? null;
  const professionalId = movimentos.find((m) => m.title?.professionalId)?.title?.professionalId ?? null;

  const [clinic, patient, formas, quote, profissional, quem] = await Promise.all([
    loadClinicInfo(tenantId),
    patientId ? loadPatientDocData(patientId, tenantId) : null,
    db.finPaymentMethod.findMany({ where: { id: { in: movimentos.map((m) => m.methodId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
    quoteId ? db.quote.findFirst({ where: { id: quoteId }, select: { number: true, items: { orderBy: { id: 'asc' }, select: { name: true, description: true } }, professional: { select: { name: true, registration: true } } } }) : null,
    professionalId ? db.professional.findFirst({ where: { id: professionalId }, select: { name: true, registration: true } }) : null,
    primeiro.createdById ? db.user.findFirst({ where: { id: primeiro.createdById }, select: { name: true } }) : null,
  ]);
  const nomeForma = new Map(formas.map((f) => [f.id, f.name]));

  const pagamentos = movimentos.map((m) => ({
    method: `${m.methodId ? (nomeForma.get(m.methodId) ?? 'Outros') : 'Outros'}${m.installments > 1 ? ` ${m.installments}x` : ''}`,
    cents: toCents(m.amount),
  }));
  const totalCents = pagamentos.reduce((s, p) => s + p.cents, 0);
  const amount = centsToNumber(totalCents);
  const dia = dateToDay(primeiro.paidOn);

  const assinante = quote?.professional ?? profissional;
  const signer = assinante ? { name: assinante.name, registration: assinante.registration ?? undefined } : undefined;
  const registro = signer?.registration ?? clinic.technicalRegistration ?? '';
  const servico = /\bCRO\b/i.test(registro) ? 'tratamento odontológico' : 'serviços prestados';
  const descricoes = [...new Set(movimentos.map((m) => m.title?.description ?? m.description).filter((x): x is string => Boolean(x)))];
  const reference = quote ? `${servico} (Orçamento ORC-${String(quote.number).padStart(4, '0')})` : descricoes.length ? `${servico} (${descricoes.join('; ')})` : servico;
  const number = `REC-${String(primeiro.code).padStart(6, '0')}`;
  const payer = { name: patient?.name ?? primeiro.title?.contact?.name ?? 'Cliente', document: patient?.cpf };
  const generatedAt = instantDateTimeBR(new Date());

  return {
    number,
    patientId,
    a4: {
      clinic,
      signer,
      receipt: {
        number,
        payer,
        amount,
        amountText: valorPorExtenso(amount),
        method: pagamentos.length === 1 ? pagamentos[0].method : pagamentos.map((p) => `${p.method} ${formatCents(p.cents)}`).join(' + '),
        paidAt: dayBR(dia),
        paidAtLong: porExtenso(dia),
        reference,
        services: quote?.items.map((it) => (it.description ? `${it.name} (${it.description})` : it.name)),
        generatedAt,
      },
      plain: settings.receiptHeader ? undefined : { topMarginMm: settings.receiptTopMarginMm },
    },
    coupon: {
      clinic,
      receipt: {
        number,
        payer,
        amount,
        amountText: valorPorExtenso(amount),
        paidAt: dayBR(dia),
        reference,
        payments: pagamentos.map((p) => ({ method: p.method, amount: centsToNumber(p.cents) })),
        receivedBy: quem?.name,
        generatedAt,
      },
    },
  };
}
