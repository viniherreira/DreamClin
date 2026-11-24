/**
 * Repetição do agendamento (e do compromisso): as datas da série a partir do
 * primeiro dia. Puro e testado.
 */

export const REPEAT_OPTIONS = [
  { value: 'none', label: 'Não repete' },
  { value: 'daily', label: 'Todo dia' },
  { value: 'weekdays', label: 'Dias úteis (seg a sex)' },
  { value: 'mwf', label: 'Seg, qua e sex' },
  { value: 'tt', label: 'Ter e qui' },
  { value: 'weekly', label: 'Toda semana' },
  { value: 'biweekly', label: 'A cada 2 semanas' },
  { value: 'monthly', label: 'Todo mês' },
  { value: 'yearly', label: 'Todo ano' },
  { value: 'every', label: 'A cada N dias' },
] as const;

export type RepeatKind = (typeof REPEAT_OPTIONS)[number]['value'];

export interface RepeatRule {
  kind: RepeatKind;
  /** "A cada N dias". */
  everyDays?: number;
  /** Quantas vezes no total (contando a primeira). */
  count?: number;
  /** Ou até esta data (inclusive). */
  until?: string;
}

/** Teto da série, para ninguém criar 3 anos de agenda por engano. */
export const MAX_OCCURRENCES = 104;

export function isRepeatKind(v: unknown): v is RepeatKind {
  return typeof v === 'string' && REPEAT_OPTIONS.some((o) => o.value === v);
}

const add = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Mês seguinte no mesmo dia; quando o mês não tem o dia (31), vai para o último dia dele. */
function addMonths(iso: string, months: number, day: number): string {
  const [y, m] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + months, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(day, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** As datas da série (a primeira é o próprio dia). */
export function occurrences(start: string, rule: RepeatRule): string[] {
  if (rule.kind === 'none') return [start];
  const limite = Math.min(rule.count && rule.count > 0 ? rule.count : MAX_OCCURRENCES, MAX_OCCURRENCES);
  const ate = rule.until && /^\d{4}-\d{2}-\d{2}$/.test(rule.until) ? rule.until : null;
  if (!rule.count && !ate) return [start];
  const out: string[] = [];
  const dia = Number(start.slice(8, 10));
  const passos: Record<string, ((n: number) => string) | undefined> = {
    weekly: (n) => add(start, 7 * n),
    biweekly: (n) => add(start, 14 * n),
    monthly: (n) => addMonths(start, n, dia),
    yearly: (n) => addMonths(start, 12 * n, dia),
    daily: (n) => add(start, n),
    every: (n) => add(start, Math.max(1, Math.min(365, rule.everyDays ?? 1)) * n),
  };
  const passo = passos[rule.kind];
  if (passo) {
    for (let n = 0; out.length < limite; n++) {
      const d = passo(n);
      if (ate && d > ate) break;
      out.push(d);
    }
    return out;
  }
  // Por dia da semana (dias úteis, seg/qua/sex, ter/qui).
  const dias = rule.kind === 'weekdays' ? [1, 2, 3, 4, 5] : rule.kind === 'mwf' ? [1, 3, 5] : [2, 4];
  for (let d = start, guard = 0; out.length < limite && guard < 800; d = add(d, 1), guard++) {
    if (ate && d > ate) break;
    if (d === start || dias.includes(dow(d))) out.push(d);
  }
  return out;
}
