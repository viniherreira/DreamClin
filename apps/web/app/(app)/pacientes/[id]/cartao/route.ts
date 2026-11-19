import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getTenantClient, prisma } from '@clinicaiq/db';
import { renderPatientCardPdf } from '@clinicaiq/pdf';
import { currentAccess } from '@/lib/guard';
import { hasCapability } from '@/lib/access';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { loadClinicInfo } from '@/lib/documents';
import { siteUrl } from '@/lib/company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cartão do paciente (85 × 55 mm) com o QR code do agendamento online da
 * clínica. O QR leva só à página da clínica: nenhum dado do paciente vai no
 * endereço, para o cartão perdido não expor ninguém.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await currentAccess();
  if (!acesso) return new NextResponse('Entre de novo.', { status: 401 });
  const { tenantId } = acesso;
  if (!(await pacienteAgendaEnabled(tenantId))) return new NextResponse('Indisponível.', { status: 404 });
  if (!(await hasCapability(tenantId, 'pacientes'))) return new NextResponse('Sem acesso.', { status: 403 });
  const { id } = await params;
  const [p, t] = await Promise.all([
    getTenantClient(tenantId).patient.findFirst({ where: { id, deletedAt: null }, select: { name: true, socialName: true, controlNumber: true } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }),
  ]);
  if (!p || !t) return new NextResponse('Paciente não encontrado.', { status: 404 });
  const qr = await QRCode.toDataURL(`${siteUrl()}/agendar/${t.slug}`, { margin: 0, width: 360, errorCorrectionLevel: 'M' });
  const bytes = await renderPatientCardPdf({
    clinic: await loadClinicInfo(tenantId),
    patientName: p.socialName || p.name,
    controlNumber: String(p.controlNumber).padStart(4, '0'),
    qr,
  });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="cartao-${p.controlNumber}.pdf"`, 'Cache-Control': 'private, no-store' },
  });
}
