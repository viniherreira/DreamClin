import { NextResponse } from 'next/server';
import { renderCashReportPdf } from '@clinicaiq/pdf';
import { cashView } from '@/fin/cash-read';
import { finContext } from '@/fin/guard';
import { loadClinicInfo } from '@/lib/documents';
import { COUNT_GROUPS, COUNT_GROUP_LABEL } from '@/lib/financeiro/cash';
import { instantDateTimeBR, instantDateTimeShortBR } from '@/lib/tz';

export const runtime = 'nodejs';

const TIPO: Record<string, string> = {
  RECEIPT: 'Recebimento',
  PAYMENT: 'Pagamento',
  REINFORCEMENT: 'Reforço',
  WITHDRAWAL: 'Sangria',
  TRANSFER_IN: 'Transferência (entrada)',
  TRANSFER_OUT: 'Transferência (saída)',
  REVERSAL: 'Estorno',
  FEE: 'Taxa',
};

/**
 * O relatório do caixa em PDF. Do caixa fechado, com a conferência; do caixa
 * aberto, parcial. Só para o dono do caixa e para quem gerencia os caixas.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await finContext();
  if (!ctx || !ctx.can('fin_caixa')) return new NextResponse('Caixa não encontrado', { status: 404 });
  const view = await cashView(ctx, id);
  if (!view) return new NextResponse('Caixa não encontrado', { status: 404 });
  // Conferência cega: enquanto o caixa está aberto, o relatório entregaria o esperado.
  if (!view.expected || !view.summary) return new NextResponse('O relatório fica disponível depois do fechamento do caixa.', { status: 403 });

  const clinic = await loadClinicInfo(ctx.tenantId);
  const reais = (c: number) => c / 100;
  const contagem = new Map(view.counts.map((r) => [r.group, r]));
  const fechado = view.status === 'CLOSED';
  const bytes = await renderCashReportPdf({
    clinic,
    cash: {
      code: String(view.code),
      open: !fechado,
      userName: view.userName,
      unitName: view.unitName ?? undefined,
      accountName: view.accountName,
      openedAt: instantDateTimeBR(view.openedAt),
      closedAt: view.closedAt ? instantDateTimeBR(view.closedAt) : undefined,
      closedByName: view.closedByName ?? undefined,
      opening: reais(view.openingCents),
      summary: {
        receipts: reais(view.summary.receipts),
        payments: reais(view.summary.payments),
        reinforcements: reais(view.summary.reinforcements),
        withdrawals: reais(view.summary.withdrawals),
        reversals: reais(view.summary.reversals),
      },
      methods: COUNT_GROUPS.map((g) => {
        const r = fechado ? contagem.get(g) : undefined;
        return { label: COUNT_GROUP_LABEL[g], expected: reais(r ? r.expected : view.expected![g]), counted: r ? reais(r.counted) : undefined, diff: r ? reais(r.diff) : undefined };
      }),
      justification: view.closingNote ?? undefined,
      byProfessional: view.byProfessional.map((p) => ({ name: p.name, amount: reais(p.cents) })),
      movements: view.movements.map((m) => ({
        code: String(m.code),
        at: instantDateTimeShortBR(m.at),
        kind: TIPO[m.kind] ?? 'Movimento',
        detail: [m.party, m.description].filter(Boolean).join(' · '),
        method: m.methodName || (m.methodKind === 'CASH' ? 'Dinheiro' : ''),
        amount: reais(m.signedCents),
        reversed: m.reversed,
      })),
      generatedAt: instantDateTimeBR(new Date()),
    },
  });

  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="caixa-${view.code}.pdf"`, 'Cache-Control': 'no-store' },
  });
}
