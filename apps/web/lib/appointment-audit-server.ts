import 'server-only';

import { prisma, type Prisma } from '@clinicaiq/db';
import { diffAppointment, initialValues, readAuditChanges, type AppointmentSnapshot } from './appointment-audit';

/**
 * Grava e lê a auditoria do agendamento em `audit_logs`. Tirar a foto de
 * antes é síncrono (antes de salvar); comparar e gravar roda depois, dentro de
 * `after()`, e nunca lança: uma auditoria perdida não desfaz o agendamento.
 */

export async function appointmentSnapshot(tenantId: string, id: string): Promise<AppointmentSnapshot | null> {
  const a = await prisma.appointment.findFirst({
    where: { id, tenantId },
    select: {
      startTime: true,
      endTime: true,
      status: true,
      type: true,
      notes: true,
      cancelReason: true,
      cancelledBy: true,
      arrivedAt: true,
      startedAt: true,
      finishedAt: true,
      noChargeReason: true,
      professional: { select: { name: true } },
      patient: { select: { name: true, socialName: true } },
      procedure: { select: { name: true } },
      label: { select: { name: true } },
      unit: { select: { name: true } },
    },
  });
  if (!a) return null;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    startTime: a.startTime.toISOString(),
    endTime: a.endTime.toISOString(),
    professional: a.professional?.name ?? null,
    patient: a.patient ? a.patient.socialName || a.patient.name : null,
    procedure: a.procedure?.name ?? null,
    status: a.status,
    type: a.type,
    notes: a.notes,
    label: a.label?.name ?? null,
    unit: a.unit?.name ?? null,
    cancelReason: a.cancelReason,
    cancelledBy: a.cancelledBy,
    arrivedAt: iso(a.arrivedAt),
    startedAt: iso(a.startedAt),
    finishedAt: iso(a.finishedAt),
    noChargeReason: a.noChargeReason,
  };
}

/**
 * Compara a foto de antes com a de agora e grava o que mudou. Sem `before`, é
 * o "criou" (grava os valores iniciais). Alteração sem mudança nenhuma não grava.
 * `actorLabel` diz quem foi quando não é alguém da equipe (paciente pelo
 * WhatsApp, agendamento online).
 */
export async function auditAppointment(
  tenantId: string,
  userId: string | null,
  id: string,
  action: string,
  before: AppointmentSnapshot | null,
  opts: { actorLabel?: string; note?: string } = {},
): Promise<void> {
  try {
    const now = await appointmentSnapshot(tenantId, id);
    if (!now) return;
    const changes = before ? diffAppointment(before, now) : initialValues(now);
    if (before && !changes.length && !opts.note) return;
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action,
        entity: 'Appointment',
        entityId: id,
        metadata: { changes, ...(opts.actorLabel ? { actorLabel: opts.actorLabel } : {}), ...(opts.note ? { note: opts.note } : {}) } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error('[auditoria] agendamento não registrado', { action, tenantId, message: error instanceof Error ? error.message : 'erro' });
  }
}

/** Excluir: o agendamento some, então a foto de antes vai inteira para o registro. */
export async function auditAppointmentDeleted(tenantId: string, userId: string | null, id: string, before: AppointmentSnapshot | null): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { tenantId, userId, action: 'APPOINTMENT_DELETED', entity: 'Appointment', entityId: id, metadata: { changes: before ? initialValues(before) : [] } as unknown as Prisma.InputJsonValue },
    });
  } catch {}
}

export interface AuditEntry {
  id: string;
  action: string;
  at: string;
  who: string;
  changes: ReturnType<typeof readAuditChanges>;
  note: string | null;
}

/** A auditoria de um agendamento, do mais antigo (quem criou) para o mais novo. */
export async function loadAppointmentAudit(tenantId: string, id: string): Promise<AuditEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { tenantId, entity: 'Appointment', entityId: id },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, action: true, createdAt: true, metadata: true, user: { select: { name: true } } },
  });
  return rows.map((r) => {
    const m = (r.metadata ?? {}) as { actorLabel?: unknown; note?: unknown };
    const quem = r.user?.name ?? (typeof m.actorLabel === 'string' ? m.actorLabel : r.action.startsWith('WHATSAPP_') ? 'Paciente pelo WhatsApp' : r.action === 'ONLINE_BOOKING' ? 'Paciente pelo agendamento online' : 'Sistema');
    return { id: r.id, action: r.action, at: r.createdAt.toISOString(), who: quem, changes: readAuditChanges(r.metadata), note: typeof m.note === 'string' ? m.note : null };
  });
}
