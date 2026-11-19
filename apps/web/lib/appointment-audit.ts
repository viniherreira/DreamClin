import { instantDateTimeBR, wallClockTime, wallDateBR } from './tz';

/**
 * Auditoria do agendamento, como a da referência de gestão: quem criou e cada
 * alteração, com o campo, o valor de antes, o de depois, quem e quando. Puro e
 * testado: compara duas "fotos" do agendamento e escreve o que mudou em
 * português. O servidor grava em `audit_logs` (entity "Appointment").
 */

/** A foto do agendamento num momento, já com os nomes (não os ids). */
export interface AppointmentSnapshot {
  startTime: string;
  endTime: string;
  professional: string | null;
  patient: string | null;
  procedure: string | null;
  status: string;
  type: string;
  notes: string | null;
  label: string | null;
  unit: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  noChargeReason: string | null;
}

export interface AuditChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'A confirmar',
  CONFIRMED: 'Confirmado',
  RESCHEDULED: 'Remarcado',
  CANCELLED: 'Cancelado',
  ATTENDED: 'Atendido',
  MISSED: 'Faltou',
};

const TYPE_LABEL: Record<string, string> = { PARTICULAR: 'Particular', CONVENIO: 'Convênio', CORTESIA: 'Cortesia' };
const CANCELLED_BY: Record<string, string> = { PATIENT: 'Paciente', CLINIC: 'Clínica' };

const vazio = '(vazio)';

/** Data e hora de parede ("15/12/2026 14:30"). */
function wall(iso: string): string {
  return `${wallDateBR(iso)} ${wallClockTime(iso)}`;
}

const FIELDS: { field: keyof AppointmentSnapshot; label: string; show: (v: string | null) => string }[] = [
  { field: 'startTime', label: 'Início', show: (v) => (v ? wall(v) : vazio) },
  { field: 'endTime', label: 'Fim', show: (v) => (v ? wall(v) : vazio) },
  { field: 'professional', label: 'Profissional', show: (v) => v ?? vazio },
  { field: 'patient', label: 'Paciente', show: (v) => v ?? vazio },
  { field: 'procedure', label: 'Procedimento', show: (v) => v ?? vazio },
  { field: 'status', label: 'Situação', show: (v) => (v ? (STATUS_LABEL[v] ?? v) : vazio) },
  { field: 'type', label: 'Quem paga', show: (v) => (v ? (TYPE_LABEL[v] ?? v) : vazio) },
  { field: 'notes', label: 'Observações', show: (v) => v || vazio },
  { field: 'label', label: 'Rótulo', show: (v) => v ?? vazio },
  { field: 'unit', label: 'Unidade', show: (v) => v ?? 'Principal' },
  { field: 'cancelReason', label: 'Motivo do cancelamento', show: (v) => v || vazio },
  { field: 'cancelledBy', label: 'Quem cancelou', show: (v) => (v ? (CANCELLED_BY[v] ?? v) : vazio) },
  { field: 'arrivedAt', label: 'Chegou', show: (v) => (v ? instantDateTimeBR(v) : vazio) },
  { field: 'startedAt', label: 'Início do atendimento', show: (v) => (v ? instantDateTimeBR(v) : vazio) },
  { field: 'finishedAt', label: 'Fim do atendimento', show: (v) => (v ? instantDateTimeBR(v) : vazio) },
  { field: 'noChargeReason', label: 'Não cobrar', show: (v) => v || vazio },
];

/** O que mudou entre duas fotos, na ordem dos campos da tela. */
export function diffAppointment(before: AppointmentSnapshot, after: AppointmentSnapshot): AuditChange[] {
  const out: AuditChange[] = [];
  for (const f of FIELDS) {
    const a = before[f.field] ?? null;
    const b = after[f.field] ?? null;
    if ((a || null) === (b || null)) continue;
    out.push({ field: f.field, label: f.label, before: f.show(a), after: f.show(b) });
  }
  return out;
}

/** Os valores com que o agendamento nasceu (o "criou" da auditoria). */
export function initialValues(s: AppointmentSnapshot): AuditChange[] {
  return FIELDS.filter((f) => s[f.field]).map((f) => ({ field: f.field, label: f.label, before: '', after: f.show(s[f.field]) }));
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  APPOINTMENT_CREATED: 'Criou o agendamento',
  APPOINTMENT_UPDATED: 'Alterou o agendamento',
  APPOINTMENT_MOVED: 'Mudou o horário (arrastando na agenda)',
  APPOINTMENT_STATUS: 'Mudou a situação',
  APPOINTMENT_LABEL: 'Trocou o rótulo',
  APPOINTMENT_DELETED: 'Excluiu o agendamento',
  ONLINE_BOOKING: 'Agendou pelo agendamento online',
  WHATSAPP_RESPONSE_CONFIRMED: 'Confirmou pelo WhatsApp',
  WHATSAPP_RESPONSE_RESCHEDULED: 'Pediu para remarcar pelo WhatsApp',
  WHATSAPP_RESPONSE_CANCELLED: 'Cancelou pelo WhatsApp',
  BILL: 'Faturou',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? 'Alteração';
}

/** Lê as mudanças gravadas no `metadata` sem confiar no formato (registros antigos não têm). */
export function readAuditChanges(metadata: unknown): AuditChange[] {
  const raw = (metadata as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.label === 'string')
    .map((c) => ({ field: String(c.field ?? ''), label: String(c.label), before: String(c.before ?? ''), after: String(c.after ?? '') }))
    .slice(0, 40);
}
