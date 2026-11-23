import type { AppointmentStatusValue, FlowChange } from './appointment-flow';

/**
 * Regras puras da situação do agendamento (spec 2026-11-18, F4): confirmado
 * pelo paciente, troca direta da situação pela lista, cancelamento com quem
 * cancelou e motivo, e o que conta como remarcação. Testado.
 */

/** Motivos que toda clínica ganha na primeira vez (dá para editar). */
export const DEFAULT_CANCEL_REASONS = ['Paciente desmarcou', 'Paciente doente', 'Imprevisto do paciente', 'Profissional indisponível', 'Remarcado pela clínica', 'Outro'] as const;

export const CONFIRMATION_SOURCES = ['WHATSAPP', 'LINK', 'PHONE', 'RECEPTION'] as const;
export type ConfirmationSource = (typeof CONFIRMATION_SOURCES)[number];

/** WhatsApp e link: quem confirmou foi o próprio paciente. */
export function confirmedByPatient(source: string | null | undefined): boolean {
  return source === 'WHATSAPP' || source === 'LINK';
}

/** O rótulo da situação como a tela mostra. */
export function statusLabel(status: string, opts: { confirmationSource?: string | null; cancelledBy?: string | null } = {}): string {
  switch (status) {
    case 'SCHEDULED':
      return 'A confirmar';
    case 'CONFIRMED':
      return confirmedByPatient(opts.confirmationSource) ? 'Confirmado pelo paciente' : 'Confirmado';
    case 'RESCHEDULED':
      return 'Pediu para remarcar';
    case 'CANCELLED':
      return opts.cancelledBy === 'PATIENT' ? 'Cancelado pelo paciente' : opts.cancelledBy === 'CLINIC' ? 'Cancelado pela clínica' : 'Cancelado';
    case 'ATTENDED':
      return 'Atendido';
    case 'MISSED':
      return 'Faltou';
    default:
      return status;
  }
}

/** As opções da lista "Situação" na janela. Cancelado abre o formulário do motivo. */
export const STATUS_CHOICES: { value: AppointmentStatusValue; label: string }[] = [
  { value: 'SCHEDULED', label: 'A confirmar' },
  { value: 'CONFIRMED', label: 'Confirmado' },
  { value: 'ATTENDED', label: 'Atendido' },
  { value: 'MISSED', label: 'Faltou' },
  { value: 'CANCELLED', label: 'Cancelado' },
];

/**
 * Trocar a situação direto pela lista. Mantém as horas do dia do paciente
 * coerentes: voltar para "a confirmar" ou "confirmado" apaga chegada e
 * atendimento; "atendido" sem fim grava o fim agora; faltou e cancelado
 * apagam as horas. `null` quando nada muda.
 */
export function directStatusChange(
  a: { status: string; arrivedAt?: Date | string | null; startedAt?: Date | string | null; finishedAt?: Date | string | null },
  target: AppointmentStatusValue,
  now: Date,
): FlowChange | null {
  if (a.status === target) return null;
  switch (target) {
    case 'SCHEDULED':
    case 'CONFIRMED':
      return { status: target, arrivedAt: null, startedAt: null, finishedAt: null };
    case 'ATTENDED':
      return { status: 'ATTENDED', ...(a.finishedAt ? {} : { finishedAt: now }) };
    case 'MISSED':
    case 'CANCELLED':
      return { status: target, arrivedAt: null, startedAt: null, finishedAt: null };
    case 'RESCHEDULED':
      return { status: 'RESCHEDULED' };
  }
}

export interface CancelInput {
  cancelledBy?: string | null;
  reasonId?: string | null;
  reasonText?: string | null;
}

/**
 * Confere o cancelamento: quem cancelou é sempre pedido; o motivo, quando a
 * clínica exige. "Outro" pede o texto. Devolve o erro ou null.
 */
export function cancelError(input: CancelInput, opts: { required: boolean; otherSelected: boolean }): string | null {
  if (input.cancelledBy !== 'PATIENT' && input.cancelledBy !== 'CLINIC') return 'Diga quem cancelou: o paciente ou a clínica.';
  const texto = (input.reasonText ?? '').trim();
  if (opts.otherSelected && !texto) return 'Escreva o motivo.';
  if (opts.required && !input.reasonId && !texto) return 'Escolha o motivo do cancelamento.';
  return null;
}

/** O texto do motivo que fica gravado: o da lista, ou o escrito (com "Outro" ou sem lista). */
export function cancelReasonText(reasonName: string | null | undefined, text: string | null | undefined, otherSelected: boolean): string | null {
  const t = (text ?? '').trim().slice(0, 200);
  if (otherSelected) return t || null;
  if (reasonName && t) return `${reasonName}: ${t}`;
  return reasonName ?? (t || null);
}

/** Mudou de dia, hora ou profissional: é remarcação. */
export function isReschedule(
  before: { startTime: Date | string; endTime: Date | string; professionalId?: string | null },
  after: { startTime: Date | string; endTime: Date | string; professionalId?: string | null },
): boolean {
  return (
    new Date(before.startTime).getTime() !== new Date(after.startTime).getTime() ||
    new Date(before.endTime).getTime() !== new Date(after.endTime).getTime() ||
    (before.professionalId ?? null) !== (after.professionalId ?? null)
  );
}
