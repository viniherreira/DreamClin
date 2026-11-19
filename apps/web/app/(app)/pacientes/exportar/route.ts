import { NextResponse } from 'next/server';
import { decrypt, getTenantClient, prisma } from '@clinicaiq/db';
import { currentAccess } from '@/lib/guard';
import { hasCapability } from '@/lib/access';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { patientFiltersWhere, readPatientFilters } from '@/lib/patient-filters';
import { SEX_OPTIONS, priorityLabel } from '@/lib/patient-fields';
import { toCsv } from '@/lib/csv';
import { clinicToday, wallDateBR } from '@/lib/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exporta a lista de pacientes (com os filtros da tela) em CSV para o Excel.
 * Só quem tem `pacientes_exportar` (dono e administrador; a recepção se a
 * clínica liberar). Cada exportação fica no registro de atividades.
 */
export async function GET(req: Request) {
  const acesso = await currentAccess();
  if (!acesso) return new NextResponse('Entre de novo.', { status: 401 });
  const { tenantId, userId } = acesso;
  if (!(await pacienteAgendaEnabled(tenantId))) return new NextResponse('Indisponível.', { status: 404 });
  if (!(await hasCapability(tenantId, 'pacientes_exportar'))) return new NextResponse('Seu perfil não exporta pacientes.', { status: 403 });

  const url = new URL(req.url);
  const filtros = readPatientFilters(Object.fromEntries(url.searchParams));
  const termo = filtros.q;
  const busca = termo
    ? {
        OR: [
          { name: { contains: termo, mode: 'insensitive' as const } },
          { socialName: { contains: termo, mode: 'insensitive' as const } },
          { email: { contains: termo, mode: 'insensitive' as const } },
          ...(/^\d+$/.test(termo) ? [{ controlNumber: Number(termo) }] : []),
        ],
      }
    : {};
  const hoje = new Date(`${clinicToday()}T00:00:00.000Z`);
  const rows = await getTenantClient(tenantId).patient.findMany({
    where: { deletedAt: null, AND: [busca, patientFiltersWhere(filtros, hoje)] },
    orderBy: { name: 'asc' },
    take: 20000,
    select: {
      controlNumber: true,
      name: true,
      socialName: true,
      phoneEncrypted: true,
      email: true,
      birthDate: true,
      gender: true,
      city: true,
      state: true,
      active: true,
      priority: true,
      priorityType: true,
      origin: { select: { name: true } },
      createdAt: true,
    },
  });
  const key = process.env.ENCRYPTION_MASTER_KEY ?? '';
  const telefone = (c: string | null) => {
    if (!c) return '';
    try {
      return decrypt(c, key, tenantId);
    } catch {
      return '';
    }
  };
  const csv = toCsv(
    ['Nº', 'Nome', 'Nome social', 'Celular', 'E-mail', 'Nascimento', 'Sexo', 'Cidade', 'UF', 'Situação', 'Prioritário', 'Origem', 'Cadastrado em'],
    rows.map((p) => [
      p.controlNumber,
      p.name,
      p.socialName ?? '',
      telefone(p.phoneEncrypted),
      p.email ?? '',
      p.birthDate ? wallDateBR(p.birthDate) : '',
      SEX_OPTIONS.find((s) => s.value === p.gender)?.label ?? '',
      p.city ?? '',
      p.state ?? '',
      p.active ? 'Ativo' : 'Inativo',
      p.priority ? priorityLabel(p.priorityType) : '',
      p.origin?.name ?? '',
      p.createdAt.toISOString().slice(0, 10),
    ]),
  );
  await prisma.auditLog.create({
    data: { tenantId, userId, action: 'PATIENTS_EXPORTED', entity: 'Patient', entityId: 'lista', metadata: { total: rows.length } },
  });
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pacientes-${clinicToday()}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
