/**
 * Lista de espera (spec 2026-11-18, F6): quem da lista combina com um horário
 * que vagou, em ordem (prioridade, depois quem espera há mais tempo). Puro e
 * testado.
 */

export const PERIODS = [
  { value: 'ANY', label: 'Qualquer horário' },
  { value: 'MORNING', label: 'Manhã (até 12h)' },
  { value: 'AFTERNOON', label: 'Tarde (12h às 18h)' },
  { value: 'EVENING', label: 'Noite (depois das 18h)' },
] as const;

export const WAITLIST_STATUS: Record<string, string> = {
  WAITING: 'Em espera',
  SCHEDULED: 'Agendado',
  ATTENDED: 'Atendido',
  REMOVED: 'Removido',
};

export interface WaitlistLike {
  id: string;
  professionalId: string | null;
  careTypeId: string | null;
  period: string;
  weekdays: number[];
  fromDate: Date | string | null;
  priority: number;
  createdAt: Date | string;
  status: string;
}

export interface FreedSlot {
  /** Hora de parede em UTC. */
  start: Date | string;
  professionalId: string;
  careTypeId?: string | null;
}

/** O período do dia de um horário (hora de parede). */
export function periodOf(start: Date | string): 'MORNING' | 'AFTERNOON' | 'EVENING' {
  const h = new Date(start).getUTCHours();
  return h < 12 ? 'MORNING' : h < 18 ? 'AFTERNOON' : 'EVENING';
}

/** A entrada combina com o horário? Profissional (ou qualquer), tipo, período, dia da semana e "desde quando". */
export function matchesSlot(e: WaitlistLike, slot: FreedSlot): boolean {
  if (e.status !== 'WAITING') return false;
  if (e.professionalId && e.professionalId !== slot.professionalId) return false;
  if (e.careTypeId && slot.careTypeId && e.careTypeId !== slot.careTypeId) return false;
  if (e.period !== 'ANY' && e.period !== periodOf(slot.start)) return false;
  const d = new Date(slot.start);
  if (e.weekdays.length && !e.weekdays.includes(d.getUTCDay())) return false;
  if (e.fromDate && new Date(e.fromDate).getTime() > d.getTime()) return false;
  return true;
}

/** Quem da lista combina, do mais indicado ao menos: prioridade, depois quem espera há mais tempo. */
export function suggestForSlot<T extends WaitlistLike>(entries: readonly T[], slot: FreedSlot): T[] {
  return entries
    .filter((e) => matchesSlot(e, slot))
    .sort((a, b) => b.priority - a.priority || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** "há 12 dias", "há 3 meses". */
export function waitingFor(createdAt: Date | string, now: Date = new Date()): string {
  const dias = Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86_400_000));
  if (dias === 0) return 'hoje';
  if (dias < 60) return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  const meses = Math.floor(dias / 30);
  return `há ${meses} meses`;
}
