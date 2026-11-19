import 'server-only';

import { prisma, type Prisma } from '@clinicaiq/db';
import { BACKFILL_MARK, CONFIRMATION_SOURCE_LABEL, type PatientEventType } from './patient-events';
import { wallClockTime, wallDateBR } from './tz';
import { pacienteAgendaEnabled } from './feature-flags';

/**
 * Grava a linha do tempo do paciente. Sempre chamado dentro de `after()`,
 * depois que a ação já salvou: nunca lança (um evento perdido não pode
 * desfazer um agendamento), e não faz nada para paciente de outra clínica.
 */
export async function recordPatientEvent(
  tenantId: string,
  patientId: string,
  type: PatientEventType,
  summary: string,
  opts: { actorId?: string | null; actorLabel?: string; refType?: string; refId?: string; data?: Prisma.InputJsonValue; at?: Date } = {},
): Promise<void> {
  try {
    // Só com o paciente e a agenda novos ligados; o passado é preenchido na primeira visita.
    if (!(await pacienteAgendaEnabled(tenantId))) return;
    const dono = await prisma.patient.findFirst({ where: { id: patientId, tenantId }, select: { id: true } });
    if (!dono) return;
    await prisma.patientEvent.create({
      data: {
        tenantId,
        patientId,
        type,
        summary: summary.slice(0, 300),
        actorId: opts.actorId ?? null,
        actorLabel: opts.actorLabel ?? null,
        refType: opts.refType ?? null,
        refId: opts.refId ?? null,
        data: opts.data,
        ...(opts.at ? { at: opts.at } : {}),
      },
    });
  } catch (error) {
    console.error('[linha do tempo] evento não gravado', { type, tenantId, message: error instanceof Error ? error.message : 'erro' });
  }
}

/** O texto do evento de um agendamento: "15/12/2026 às 14:30 com Dra. Ana". */
export function appointmentSummary(a: { startTime: Date; professional?: { name: string } | null }, extra?: string): string {
  return `${wallDateBR(a.startTime)} às ${wallClockTime(a.startTime)}${a.professional ? ` com ${a.professional.name}` : ''}${extra ? ` · ${extra}` : ''}`;
}

export function confirmationText(source: string | null | undefined): string {
  return source ? (CONFIRMATION_SOURCE_LABEL[source] ?? '') : '';
}

/**
 * Preenche o passado que dá para reconstruir, uma vez por paciente: o
 * cadastro, os agendamentos (criado e o fim de cada um), os orçamentos, as
 * evoluções e os pagamentos. Roda na primeira vez que a linha do tempo abre.
 */
export async function backfillPatientTimeline(tenantId: string, patientId: string): Promise<void> {
  try {
    const feito = await prisma.patientEvent.findFirst({ where: { tenantId, patientId, type: BACKFILL_MARK }, select: { id: true } });
    if (feito) return;
    const p = await prisma.patient.findFirst({ where: { id: patientId, tenantId }, select: { createdAt: true, createdById: true } });
    if (!p) return;
    const w = { tenantId, patientId };
    const [ags, orcs, evs, pags] = await Promise.all([
      prisma.appointment.findMany({ where: w, select: { id: true, startTime: true, status: true, createdAt: true, createdById: true, cancelReason: true, finishedAt: true, professional: { select: { name: true } } } }),
      prisma.quote.findMany({ where: w, select: { id: true, number: true, createdAt: true, createdById: true, acceptedAt: true, sentAt: true } }),
      prisma.evolution.findMany({ where: w, select: { id: true, createdAt: true, createdById: true, professional: { select: { name: true } } } }),
      prisma.payment.findMany({ where: w, select: { id: true, amount: true, paidAt: true, createdById: true } }),
    ]);
    const linhas: Prisma.PatientEventCreateManyInput[] = [
      { tenantId, patientId, type: 'patient.created', summary: 'Paciente cadastrado', actorId: p.createdById, at: p.createdAt },
    ];
    for (const a of ags) {
      linhas.push({ tenantId, patientId, type: 'appointment.created', summary: appointmentSummary(a), actorId: a.createdById, refType: 'appointment', refId: a.id, at: a.createdAt });
      const fim: Partial<Record<string, PatientEventType>> = { ATTENDED: 'appointment.attended', MISSED: 'appointment.missed', CANCELLED: 'appointment.cancelled' };
      const t = fim[a.status];
      if (t) {
        linhas.push({
          tenantId,
          patientId,
          type: t,
          summary: appointmentSummary(a, a.status === 'CANCELLED' && a.cancelReason ? `motivo: ${a.cancelReason}` : undefined),
          refType: 'appointment',
          refId: a.id,
          at: a.finishedAt ?? a.startTime,
        });
      }
    }
    const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
    for (const q of orcs) {
      linhas.push({ tenantId, patientId, type: 'quote.created', summary: `Orçamento nº ${q.number}`, actorId: q.createdById, refType: 'quote', refId: q.id, at: q.createdAt });
      if (q.sentAt) linhas.push({ tenantId, patientId, type: 'quote.sent', summary: `Orçamento nº ${q.number}`, refType: 'quote', refId: q.id, at: q.sentAt });
      if (q.acceptedAt) linhas.push({ tenantId, patientId, type: 'quote.accepted', summary: `Orçamento nº ${q.number}`, refType: 'quote', refId: q.id, at: q.acceptedAt });
    }
    for (const e of evs) {
      linhas.push({ tenantId, patientId, type: 'evolution.created', summary: e.professional ? `Por ${e.professional.name}` : 'Evolução registrada', actorId: e.createdById, refType: 'evolution', refId: e.id, at: e.createdAt });
    }
    for (const x of pags) {
      linhas.push({ tenantId, patientId, type: 'payment.received', summary: brl(Number(x.amount)), actorId: x.createdById, refType: 'payment', refId: x.id, at: x.paidAt });
    }
    // O que já foi gravado ao vivo (a bandeira ligou antes da primeira visita) não se repete.
    const ja = await prisma.patientEvent.findMany({ where: { tenantId, patientId }, select: { type: true, refId: true } });
    const chave = (t: string, r: string | null | undefined) => `${t}|${r ?? ''}`;
    const vistos = new Set(ja.map((e) => chave(e.type, e.refId)));
    const novas = linhas.filter((l) => !vistos.has(chave(l.type, l.refId)));
    novas.push({ tenantId, patientId, type: BACKFILL_MARK, summary: '', at: new Date(0) });
    await prisma.patientEvent.createMany({ data: novas });
  } catch (error) {
    console.error('[linha do tempo] preenchimento falhou', { tenantId, message: error instanceof Error ? error.message : 'erro' });
  }
}
