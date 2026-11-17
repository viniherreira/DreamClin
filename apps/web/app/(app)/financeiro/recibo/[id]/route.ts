import { NextResponse } from 'next/server';
import { renderCouponPdf, renderReceiptPdf } from '@clinicaiq/pdf';
import { receiptBundle } from '@/fin/receipt';
import { getReceiptData } from '../../actions';

export const runtime = 'nodejs';

const pdf = (bytes: Uint8Array, nome: string) =>
  new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nome}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });

/**
 * O recibo em PDF. Com o financeiro novo ligado, o id é o do recebimento (que
 * pode ter vários meios) e `?formato=cupom` devolve o cupom de 80 mm; o id de
 * um pagamento antigo continua abrindo. Sem o financeiro novo, vale o recibo
 * de sempre, por pagamento.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cupom = new URL(req.url).searchParams.get('formato') === 'cupom';

  const novo = await receiptBundle(id);
  if (novo) return cupom ? pdf(await renderCouponPdf(novo.coupon), `${novo.number}-cupom`) : pdf(await renderReceiptPdf(novo.a4), novo.number);

  const data = await getReceiptData(id);
  if (!data) return new NextResponse('Pagamento não encontrado', { status: 404 });
  return pdf(await renderReceiptPdf(data), data.receipt.number);
}
