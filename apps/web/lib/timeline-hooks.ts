import 'server-only';

import { prisma } from '@clinicaiq/db';
import { appointmentSummary, confirmationText, recordPatientEvent } from './patient-timeline';
import type { PatientEventType } from './patient-events';

/**
 * Atalhos para as ações da agenda e dos orçamentos gravarem a linha do tempo,
 * sempre dentro de `after()`. Leem o que precisam e nunca lançam.
 */

const STATUS_EVENT: Partial<Record<string, PatientEventType>> = {
  CONFIRMED: 'appointment.confirmed',
  CANCELLED: 'appointment.cancelled',
  MISSED: 'appointment.missed',
  ATTENDED: 'appointment.attended',
};

export async function timelineAppointment(
  tenantId: string,
  appointmentId: string,
  kind: 'created' | 'status' | 'rescheduled',
  actorId?: string | null,
  extra?: { from?: Date; actorLabel?: string },
): Promise<void> {
  try {
    const a = await prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      select: { patientId: true, startTime: true, status: true, cancelReason: true, cancelledBy: true, professional: { select: { name: true } } },
    });
    if (!a) return;
    let type: PatientEventType | undefined;
    let detalhe: string | undefined;
    if (kind === 'created') type = 'appointment.created';
    else if (kind === 'rescheduled') {
      type = 'appointment.rescheduled';
      if (extra?.from) detalhe = `antes ${appointmentSummary({ startTime: extra.from })}`;
    } else {
      type = STATUS_EVENT[a.status];
      if (a.status === 'CANCELLED') {
        const quem = a.cancelledBy === 'PATIENT' ? 'pelo paciente' : a.cancelledBy === 'CLINIC' ? 'pela clínica' : '';
        detalhe = [quem, a.cancelReason ? `motivo: ${a.cancelReason}` : ''].filter(Boolean).join(', ') || undefined;
      }
    }
    if (!type) return;
    const src = (extra as { source?: string } | undefined)?.source;
    if (type === 'appointment.confirmed' && src) detalhe = confirmationText(src) || undefined;
    await recordPatientEvent(tenantId, a.patientId, type, appointmentSummary(a, detalhe), {
      actorId: actorId ?? null,
      actorLabel: extra?.actorLabel,
      refType: 'appointment',
      refId: appointmentId,
    });
  } catch {
    // A linha do tempo nunca derruba a agenda.
  }
}

export async function timelineQuote(tenantId: string, quoteId: string, type: 'quote.created' | 'quote.sent' | 'quote.accepted', actorId?: string | null, actorLabel?: string): Promise<void> {
  try {
    const q = await prisma.quote.findFirst({ where: { id: quoteId, tenantId }, select: { patientId: true, number: true } });
    if (!q) return;
    await recordPatientEvent(tenantId, q.patientId, type, `Orçamento nº ${q.number}`, { actorId: actorId ?? null, actorLabel, refType: 'quote', refId: quoteId });
  } catch {}
}
