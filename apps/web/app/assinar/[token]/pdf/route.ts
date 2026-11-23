import { NextResponse } from 'next/server';
import { decrypt, prisma } from '@clinicaiq/db';
import { renderPatientDocumentPdf } from '@/lib/patient-docs';
import { instantDateTimeBR } from '@/lib/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** O PDF assinado, com a página de comprovação. Só depois de assinado. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[\w-]{20,64}$/.test(token)) return new NextResponse('Não encontrado.', { status: 404 });
  const r = await prisma.signatureRequest.findUnique({
    where: { token },
    select: { tenantId: true, status: true, documentId: true, signedAt: true, signerName: true, method: true, drawing: true, ip: true, userAgent: true, pdfHash: true, patientId: true },
  });
  if (!r || r.status !== 'SIGNED' || !r.signedAt) return new NextResponse('Não encontrado.', { status: 404 });
  const p = await prisma.patient.findUnique({ where: { id: r.patientId }, select: { cpfEncrypted: true } });
  let cpf = '';
  try {
    cpf = p?.cpfEncrypted ? decrypt(p.cpfEncrypted, process.env.ENCRYPTION_MASTER_KEY ?? '', r.tenantId) : '';
  } catch {}
  const bytes = await renderPatientDocumentPdf(r.tenantId, r.documentId, {
    signedAt: instantDateTimeBR(r.signedAt),
    signerName: r.signerName ?? '',
    cpf: cpf ? `${cpf.slice(0, 3)}.***.***-${cpf.slice(-2)}` : undefined,
    method: r.method === 'DRAWN' ? 'DRAWN' : 'ACCEPTED',
    drawing: r.drawing ?? undefined,
    ip: r.ip ?? undefined,
    userAgent: r.userAgent ?? undefined,
    hash: r.pdfHash ?? '',
    code: `DOC-${r.documentId.slice(-6).toUpperCase()}`,
  });
  if (!bytes) return new NextResponse('Não encontrado.', { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="documento-assinado.pdf"', 'Cache-Control': 'private, no-store' },
  });
}
