import { NextResponse } from 'next/server';
import { getTenantClient, prisma } from '@clinicaiq/db';
import { renderPatientSheetPdf } from '@clinicaiq/pdf';
import { currentAccess } from '@/lib/guard';
import { hasCapability } from '@/lib/access';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { loadClinicInfo, readEncrypted } from '@/lib/documents';
import { answerText, BLOOD_TYPES, MARITAL_OPTIONS, priorityLabel, readCustomAnswers, SEX_OPTIONS } from '@/lib/patient-fields';
import { buildXlsx } from '@/lib/xlsx';
import { toCsv } from '@/lib/csv';
import { ageFromBirth, instantDateTimeBR, wallDateBR } from '@/lib/tz';
import { loadCustomFieldDefs } from '../../patient-extra';
import { ANAMNESIS_QUESTIONS } from '../_components/anamnesis-questions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ficha do paciente para imprimir ou levar ao Excel: `?formato=pdf|xlsx|csv`,
 * `cabecalho=0` (sem o cabeçalho da clínica), `rodape=0`, `linhas=N` (linhas em
 * branco no fim) e `titulo=`. Quem vê o prontuário recebe também o resumo
 * clínico (alertas da anamnese e as últimas evoluções). Fica na auditoria.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await currentAccess();
  if (!acesso) return new NextResponse('Entre de novo.', { status: 401 });
  const { tenantId, userId } = acesso;
  if (!(await pacienteAgendaEnabled(tenantId))) return new NextResponse('Indisponível.', { status: 404 });
  if (!(await hasCapability(tenantId, 'pacientes_exportar'))) return new NextResponse('Seu perfil não exporta a ficha do paciente.', { status: 403 });

  const { id } = await params;
  const url = new URL(req.url);
  const formato = url.searchParams.get('formato') ?? 'pdf';
  const db = getTenantClient(tenantId);
  const p = await db.patient.findFirst({
    where: { id, deletedAt: null },
    include: { origin: true, insurances: { where: { tenantId, active: true } } },
  });
  if (!p) return new NextResponse('Paciente não encontrado.', { status: 404 });

  const clinico = await hasCapability(tenantId, 'prontuario');
  const [defs, anamnese, evolucoes] = await Promise.all([
    loadCustomFieldDefs(tenantId),
    clinico ? db.anamnesis.findFirst({ where: { patientId: id }, select: { answers: true } }) : null,
    clinico ? db.evolution.findMany({ where: { patientId: id }, orderBy: { createdAt: 'desc' }, take: 5, select: { createdAt: true, description: true, professional: { select: { name: true } } } }) : [],
  ]);
  const abrir = (v: string | null) => readEncrypted(v, tenantId) ?? '';
  const idade = ageFromBirth(p.birthDate);
  const endereco = [[p.street, p.addressNumber].filter(Boolean).join(', '), p.complement, p.neighborhood, [p.city, p.state].filter(Boolean).join(' - '), p.zipCode].filter(Boolean).join(' · ');
  const respostas = readCustomAnswers(p.customFields);

  const sections: { title: string; rows: { label: string; value: string }[] }[] = [
    {
      title: 'Identificação',
      rows: [
        { label: 'Nome', value: p.name },
        { label: 'Nome social', value: p.socialName ?? '' },
        { label: 'Nº de controle', value: String(p.controlNumber) },
        { label: 'Nascimento', value: p.birthDate ? `${wallDateBR(p.birthDate)}${idade !== null ? ` (${idade} anos)` : ''}` : '' },
        { label: p.foreigner ? 'Documento' : 'CPF', value: p.foreigner ? abrir(p.foreignDocEncrypted) : abrir(p.cpfEncrypted) },
        { label: 'RG', value: [abrir(p.rgEncrypted), p.rgIssuer].filter(Boolean).join(' ') },
        { label: 'Sexo', value: SEX_OPTIONS.find((o) => o.value === p.gender)?.label ?? '' },
        { label: 'Estado civil', value: MARITAL_OPTIONS.find((o) => o.value === p.maritalStatus)?.label ?? '' },
      ],
    },
    {
      title: 'Contato e endereço',
      rows: [
        { label: 'Celular', value: abrir(p.phoneEncrypted) },
        { label: 'Telefone fixo', value: abrir(p.landlineEncrypted) },
        { label: 'E-mail', value: p.email ?? '' },
        { label: 'Endereço', value: endereco },
      ],
    },
    {
      title: 'Dados complementares',
      rows: [
        { label: 'Mãe', value: p.motherName ?? '' },
        { label: 'Pai', value: p.fatherName ?? '' },
        { label: 'Responsável legal', value: p.legalGuardian ?? '' },
        { label: 'Tipo sanguíneo', value: (BLOOD_TYPES as readonly string[]).includes(p.bloodType ?? '') ? p.bloodType! : '' },
        { label: 'Atendimento prioritário', value: p.priority ? priorityLabel(p.priorityType) : 'Não' },
        { label: 'Origem', value: p.origin?.name ?? '' },
        { label: 'Convênios', value: p.insurances.map((i) => [i.insurerName, i.planName, i.cardNumber && `carteirinha ${i.cardNumber}`].filter(Boolean).join(' ')).join('; ') },
        { label: 'Profissão', value: p.profession ?? '' },
      ],
    },
  ];
  const ativos = defs.filter((d) => d.active);
  if (ativos.length) sections.push({ title: 'Informações adicionais', rows: ativos.map((d) => ({ label: d.label, value: answerText(d, respostas[d.id]) })) });
  if (clinico) {
    const itens = (anamnese?.answers as { items?: Record<string, { value?: string; detail?: string }> } | null)?.items ?? {};
    const alertas = ANAMNESIS_QUESTIONS.filter((q) => itens[q.key]?.value === 'yes').map((q) => `${q.label}${itens[q.key]?.detail ? `: ${itens[q.key]?.detail}` : ''}`);
    sections.push({
      title: 'Resumo clínico',
      rows: [
        { label: 'Anamnese', value: anamnese ? (alertas.length ? alertas.join('; ') : 'Sem respostas de atenção') : 'Não preenchida' },
        ...evolucoes.map((e) => ({ label: `Evolução ${instantDateTimeBR(e.createdAt)}${e.professional ? ` · ${e.professional.name}` : ''}`, value: e.description.slice(0, 400) })),
      ],
    });
  }

  await prisma.auditLog.create({
    data: { tenantId, userId, action: 'PATIENT_SHEET_EXPORTED', entity: 'Patient', entityId: id, metadata: { formato, clinico } },
  });

  const nome = `ficha-${p.controlNumber}`;
  const linhas = sections.flatMap((sec) => sec.rows.map((r) => [sec.title, r.label, r.value]));
  if (formato === 'csv') {
    return new NextResponse(toCsv(['Seção', 'Campo', 'Valor'], linhas), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}.csv"`, 'Cache-Control': 'private, no-store' },
    });
  }
  if (formato === 'xlsx') {
    return new NextResponse(new Uint8Array(buildXlsx([{ name: 'Ficha', rows: [['Seção', 'Campo', 'Valor'], ...linhas] }])), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nome}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }
  const titulo = (url.searchParams.get('titulo') ?? '').trim().slice(0, 80) || 'Ficha do paciente';
  const bytes = await renderPatientSheetPdf({
    clinic: await loadClinicInfo(tenantId),
    title: titulo,
    header: url.searchParams.get('cabecalho') !== '0',
    footer: url.searchParams.get('rodape') !== '0',
    blankLines: Math.max(0, Math.min(30, Number(url.searchParams.get('linhas') ?? 0) || 0)),
    sections,
    issuedAt: instantDateTimeBR(new Date()),
    code: `Nº ${p.controlNumber}`,
  });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nome}.pdf"`, 'Cache-Control': 'private, no-store' },
  });
}
