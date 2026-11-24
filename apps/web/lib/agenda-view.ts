/**
 * Visualizações da agenda (spec 2026-11-18, F5): os selos do card, a ordem da
 * lista e os filtros lembrados no navegador. Puro e testado.
 */
import { confirmedByPatient } from './appointment-status';

export type Badge = 'primeira' | 'aniversario' | 'paciente';

export const BADGE_LABEL: Record<Badge, string> = {
  primeira: '1ª vez',
  aniversario: 'Aniversário',
  paciente: 'Confirmou pelo WhatsApp ou link',
};

/** Data de parede AAAA-MM-DD de um horário gravado como relógio da clínica. */
const dia = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/**
 * Os selos de cada agendamento. "1ª vez" vai só no primeiro agendamento do
 * período (que não seja cancelado) de quem nunca foi atendido antes.
 */
export function appointmentBadges<A extends { id: string; patientId: string; startTime: Date | string; status: string; confirmationSource?: string | null; birthDate?: Date | string | null }>(
  list: readonly A[],
  attendedBefore: ReadonlySet<string>,
): Record<string, Badge[]> {
  const primeiro = new Map<string, A>();
  for (const a of [...list].sort((x, y) => new Date(x.startTime).getTime() - new Date(y.startTime).getTime())) {
    if (a.status === 'CANCELLED' || attendedBefore.has(a.patientId) || primeiro.has(a.patientId)) continue;
    primeiro.set(a.patientId, a);
  }
  const out: Record<string, Badge[]> = {};
  for (const a of list) {
    const b: Badge[] = [];
    if (primeiro.get(a.patientId)?.id === a.id) b.push('primeira');
    if (a.birthDate && dia(a.birthDate).slice(5) === dia(a.startTime).slice(5)) b.push('aniversario');
    if (a.status === 'CONFIRMED' && confirmedByPatient(a.confirmationSource)) b.push('paciente');
    if (b.length) out[a.id] = b;
  }
  return out;
}

export type ListSort = 'horario' | 'profissional' | 'paciente';

export function sortAgendaList<A extends { startTime: Date | string; patient: { name: string }; professional: { name: string } }>(list: readonly A[], by: ListSort): A[] {
  const t = (a: A) => new Date(a.startTime).getTime();
  const cmp = (x: string, y: string) => x.localeCompare(y, 'pt-BR', { sensitivity: 'base' });
  return [...list].sort((a, b) => {
    if (by === 'profissional') return cmp(a.professional.name, b.professional.name) || t(a) - t(b);
    if (by === 'paciente') return cmp(a.patient.name, b.patient.name) || t(a) - t(b);
    return t(a) - t(b) || cmp(a.professional.name, b.professional.name);
  });
}

/** O que a agenda lembra entre uma visita e outra, neste navegador. */
export interface AgendaPrefs {
  hidden: string[];
  layout: 'grouped' | 'sidebyside' | 'list';
  onlyOwing: boolean;
  sort: ListSort;
}

export const DEFAULT_PREFS: AgendaPrefs = { hidden: [], layout: 'sidebyside', onlyOwing: false, sort: 'horario' };
export const PREFS_KEY = 'dreamclin.agenda.v1';

/** Lê o que veio do navegador sem confiar: qualquer coisa estranha vira o padrão. */
export function parsePrefs(raw: string | null | undefined): AgendaPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<AgendaPrefs>;
    return {
      hidden: Array.isArray(v.hidden) ? v.hidden.filter((x): x is string => typeof x === 'string').slice(0, 200) : [],
      layout: v.layout === 'grouped' || v.layout === 'list' ? v.layout : 'sidebyside',
      onlyOwing: v.onlyOwing === true,
      sort: v.sort === 'profissional' || v.sort === 'paciente' ? v.sort : 'horario',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
