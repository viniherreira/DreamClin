import { NextResponse } from 'next/server';
import { decrypt, getTenantClient, prisma } from '@clinicaiq/db';
import { currentAccess } from '@/lib/guard';
import { hasCapability } from '@/lib/access';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { renderPatientDocumentPdf } from '@/lib/patient-docs';
import { instantDateTimeBR } from '@/lib/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Imprimir um documento do paciente (A4, PDF). Assinado, sai com a comprovação. Clínico só com o prontuário. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const acesso = await currentAccess();
  if (!acesso) return new NextResponse('Entre de novo.', { status: 401 });
  const { tenantId, userId } = acesso;
  if (!(await pacienteAgendaEnabled(tenantId))) return new NextResponse('Indisponível.', { status: 404 });
  if (!(await hasCapability(tenantId, 'pacientes'))) return new NextResponse('Sem acesso.', { status: 403 });
  const { id, docId } = await params;
  const d = await getTenantClient(tenantId).patientDocument.findFirst({
    where: { id: docId, patientId: id },
    select: { clinical: true, signatures: { where: { status: 'SIGNED' }, orderBy: { signedAt: 'desc' }, take: 1 } },
  });
  if (!d) return new NextResponse('Documento não encontrado.', { status: 404 });
  if (d.clinical) {
    if (!(await hasCapability(tenantId, 'prontuario'))) return new NextResponse('Documento clínico: só quem vê o prontuário.', { status: 403 });
    await prisma.auditLog.create({ data: { tenantId, userId, action: 'CLINICAL_DOCUMENT_VIEWED', entity: 'PatientDocument', entityId: docId } });
  }
  const s = d.signatures[0];
  let cpf = '';
  if (s) {
    const p = await prisma.patient.findFirst({ where: { id, tenantId }, select: { cpfEncrypted: true } });
    try {
      cpf = p?.cpfEncrypted ? decrypt(p.cpfEncrypted, process.env.ENCRYPTION_MASTER_KEY ?? '', tenantId) : '';
    } catch {}
  }
  const bytes = await renderPatientDocumentPdf(
    tenantId,
    docId,
    s && s.signedAt
      ? {
          signedAt: instantDateTimeBR(s.signedAt),
          signerName: s.signerName ?? '',
          cpf: cpf ? `${cpf.slice(0, 3)}.***.***-${cpf.slice(-2)}` : undefined,
          method: s.method === 'DRAWN' ? 'DRAWN' : 'ACCEPTED',
          drawing: s.drawing ?? undefined,
          ip: s.ip ?? undefined,
          userAgent: s.userAgent ?? undefined,
          hash: s.pdfHash ?? '',
          code: `DOC-${docId.slice(-6).toUpperCase()}`,
        }
      : undefined,
  );
  if (!bytes) return new NextResponse('Documento não encontrado.', { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="documento-${docId.slice(-6)}.pdf"`, 'Cache-Control': 'private, no-store' },
  });
}
