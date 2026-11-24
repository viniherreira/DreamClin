/**
 * Escalas (spec 2026-11-18, F7): qual o horário de atendimento de um
 * profissional num dia, pelas regras com vigência e pelas exceções (folga e
 * plantão). Sem nenhuma regra, vale o horário semanal antigo. Puro e testado.
 */
import { timeToMin, type DaySchedule, type WeekSchedule } from './schedule';

export type RepeatKind = 'WEEKLY' | 'BIWEEKLY' | 'EVERY_N_DAYS' | 'MONTH_DAY';

export const SCHEDULE_REPEATS: { value: RepeatKind; label: string }[] = [
  { value: 'WEEKLY', label: 'Toda semana' },
  { value: 'BIWEEKLY', label: 'A cada 15 dias' },
  { value: 'EVERY_N_DAYS', label: 'A cada N dias' },
  { value: 'MONTH_DAY', label: 'Um dia do mês' },
];

export interface RuleLike {
  id?: string;
  unitId?: string | null;
  careTypeId?: string | null;
  /** AAAA-MM-DD */
  startsOn: string;
  endsOn?: string | null;
  repeat: RepeatKind | string;
  weekdays: number[];
  everyDays?: number | null;
  monthDay?: number | null;
  start1: string;
  end1: string;
  start2?: string | null;
  end2?: string | null;
}

export interface ExceptionLike {
  /** AAAA-MM-DD */
  date: string;
  kind: 'OFF' | 'EXTRA' | string;
  start?: string | null;
  end?: string | null;
}

const DIA = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const weekday = (d: string) => new Date(t(d)).getUTCDay();
/** Segunda-feira da semana da data, em milissegundos. */
const monday = (d: string) => t(d) - ((weekday(d) + 6) % 7) * DIA;

/** A regra vale neste dia? (vigência e repetição) */
export function ruleAppliesOn(r: RuleLike, date: string): boolean {
  if (date < r.startsOn || (r.endsOn && date > r.endsOn)) return false;
  switch (r.repeat) {
    case 'WEEKLY':
      return r.weekdays.includes(weekday(date));
    case 'BIWEEKLY': {
      if (!r.weekdays.includes(weekday(date))) return false;
      const semanas = Math.round((monday(date) - monday(r.startsOn)) / (7 * DIA));
      return semanas % 2 === 0;
    }
    case 'EVERY_N_DAYS': {
      const n = Math.max(1, r.everyDays ?? 1);
      return Math.round((t(date) - t(r.startsOn)) / DIA) % n === 0;
    }
    case 'MONTH_DAY':
      return Number(date.slice(8, 10)) === r.monthDay;
    default:
      return false;
  }
}

/** Os dois períodos viram o formato da agenda: o intervalo entre eles é o almoço. */
export function ruleDay(r: Pick<RuleLike, 'start1' | 'end1' | 'start2' | 'end2'>): DaySchedule {
  if (r.start2 && r.end2) return { start: r.start1, end: r.end2, lunchStart: r.end1, lunchEnd: r.start2 };
  return { start: r.start1, end: r.end1 };
}

/** Junta dois horários do mesmo dia: do começo mais cedo ao fim mais tarde (o almoço some). */
function merge(a: DaySchedule | null, b: DaySchedule): DaySchedule {
  if (!a) return b;
  const ini = (timeToMin(a.start) ?? 0) <= (timeToMin(b.start) ?? 0) ? a.start : b.start;
  const fim = (timeToMin(a.end) ?? 0) >= (timeToMin(b.end) ?? 0) ? a.end : b.end;
  return { start: ini, end: fim };
}

/**
 * O horário do profissional no dia. `rules` são só as dele (já filtradas por
 * unidade, se for o caso). Sem regra nenhuma, vale `fallback` (o semanal
 * antigo). Folga apaga o dia; plantão abre ou estica o dia.
 */
export function workingDay(input: { rules: readonly RuleLike[]; exceptions: readonly ExceptionLike[]; fallback: WeekSchedule | undefined; date: string; careTypeId?: string | null }): DaySchedule | null {
  const { rules, exceptions, fallback, date } = input;
  let dia: DaySchedule | null;
  if (!rules.length) {
    dia = fallback?.[weekday(date)] ?? null;
  } else {
    dia = null;
    for (const r of rules) {
      if (input.careTypeId && r.careTypeId && r.careTypeId !== input.careTypeId) continue;
      if (ruleAppliesOn(r, date)) dia = dia ? merge(dia, ruleDay(r)) : ruleDay(r);
    }
  }
  for (const e of exceptions) {
    if (e.date !== date) continue;
    if (e.kind === 'OFF') return null;
    if (e.kind === 'EXTRA' && e.start && e.end) dia = merge(dia, { start: e.start, end: e.end });
  }
  return dia;
}

/** Os minutos de um dia que a regra ocupa, para saber se duas regras se chocam. */
function periods(r: RuleLike): [number, number][] {
  const p: [number, number][] = [[timeToMin(r.start1) ?? 0, timeToMin(r.end1) ?? 0]];
  if (r.start2 && r.end2) p.push([timeToMin(r.start2) ?? 0, timeToMin(r.end2) ?? 0]);
  return p;
}

/**
 * As regras que se chocam com a nova: vigências que se cruzam, algum dia em
 * comum nos próximos 120 dias da sobreposição e horário que se cruza.
 */
export function ruleConflicts<R extends RuleLike>(novo: RuleLike, existentes: readonly R[]): R[] {
  return existentes.filter((r) => {
    if (r.id && r.id === novo.id) return false;
    if ((r.careTypeId ?? null) !== (novo.careTypeId ?? null) && r.careTypeId && novo.careTypeId) return false;
    const ini = novo.startsOn > r.startsOn ? novo.startsOn : r.startsOn;
    const fims = [novo.endsOn, r.endsOn].filter((x): x is string => !!x);
    const fim = fims.length ? fims.sort()[0] : null;
    if (fim && fim < ini) return false;
    const horario = periods(novo).some(([a, b]) => periods(r).some(([c, d]) => a < d && c < b));
    if (!horario) return false;
    for (let i = 0; i < 120; i++) {
      const d = new Date(t(ini) + i * DIA).toISOString().slice(0, 10);
      if (fim && d > fim) break;
      if (ruleAppliesOn(novo, d) && ruleAppliesOn(r, d)) return true;
    }
    return false;
  });
}

/** Confere a regra antes de salvar. `null` quando está tudo certo. */
export function ruleError(r: RuleLike): string | null {
  const ok = (h: string | null | undefined) => !!h && /^\d{2}:\d{2}$/.test(h);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.startsOn)) return 'Escolha a data de início.';
  if (r.endsOn && r.endsOn < r.startsOn) return 'O fim da vigência vem antes do início.';
  if (!ok(r.start1) || !ok(r.end1) || r.end1 <= r.start1) return 'O primeiro período precisa de início e fim, nessa ordem.';
  if (r.start2 || r.end2) {
    if (!ok(r.start2) || !ok(r.end2) || r.end2! <= r.start2!) return 'O segundo período precisa de início e fim, nessa ordem.';
    if (r.start2! < r.end1) return 'O segundo período começa depois do primeiro terminar.';
  }
  if ((r.repeat === 'WEEKLY' || r.repeat === 'BIWEEKLY') && !r.weekdays.length) return 'Marque pelo menos um dia da semana.';
  if (r.repeat === 'EVERY_N_DAYS' && !(r.everyDays && r.everyDays >= 1 && r.everyDays <= 60)) return 'A cada quantos dias? De 1 a 60.';
  if (r.repeat === 'MONTH_DAY' && !(r.monthDay && r.monthDay >= 1 && r.monthDay <= 31)) return 'Qual dia do mês? De 1 a 31.';
  if (!SCHEDULE_REPEATS.some((x) => x.value === r.repeat)) return 'Repetição inválida.';
  return null;
}

/** "Seg, Qua · 08:00–12:00 e 14:00–18:00 · a partir de 01/12/2026" */
export function describeRule(r: RuleLike): string {
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const quando =
    r.repeat === 'WEEKLY'
      ? r.weekdays.map((d) => DIAS[d]).join(', ')
      : r.repeat === 'BIWEEKLY'
        ? `${r.weekdays.map((d) => DIAS[d]).join(', ')}, a cada 15 dias`
        : r.repeat === 'EVERY_N_DAYS'
          ? `a cada ${r.everyDays} dias`
          : `todo dia ${r.monthDay}`;
  const horas = `${r.start1}–${r.end1}${r.start2 && r.end2 ? ` e ${r.start2}–${r.end2}` : ''}`;
  const vig = r.endsOn ? `de ${br(r.startsOn)} a ${br(r.endsOn)}` : `a partir de ${br(r.startsOn)}`;
  return `${quando} · ${horas} · ${vig}`;
}
