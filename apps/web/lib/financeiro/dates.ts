/**
 * Datas sem hora do financeiro ("AAAA-MM-DD"): vencimento, emissão, pagamento,
 * compensação. No banco são `DATE`; o Prisma devolve meia-noite UTC. Puro.
 */

export type Day = string;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isDay = (v: unknown): v is Day => typeof v === 'string' && DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`));

/** "AAAA-MM-DD" → Date à meia-noite UTC (o que uma coluna DATE espera). */
export const dayToDate = (day: Day): Date => new Date(`${day}T00:00:00.000Z`);

/** Date de uma coluna DATE → "AAAA-MM-DD". */
export const dateToDay = (d: Date): Day => d.toISOString().slice(0, 10);

export function addDays(day: Day, days: number): Day {
  const d = dayToDate(day);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToDay(d);
}

/** Soma meses sem pular mês: 31/01 + 1 → 28/02 (ou 29). */
export function addMonths(day: Day, months: number): Day {
  const [a, m, d] = day.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + months, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return dateToDay(alvo);
}

export const addYears = (day: Day, years: number): Day => addMonths(day, years * 12);

/** Dias corridos de `from` até `to` (negativo se `to` vem antes). */
export function daysBetween(from: Day, to: Day): number {
  return Math.round((dayToDate(to).getTime() - dayToDate(from).getTime()) / 86_400_000);
}

/** "AAAA-MM" de um dia: o mês de competência padrão. */
export const competenceOf = (day: Day): string => day.slice(0, 7);

export const isCompetence = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
export function dayBR(day: Day): string {
  const [a, m, d] = day.split('-');
  return `${d}/${m}/${a}`;
}

/** "AAAA-MM" → "nov/2026". */
export function competenceBR(c: string): string {
  const [a, m] = c.split('-').map(Number);
  const nome = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][m - 1] ?? '';
  return `${nome}/${a}`;
}

/** O próximo dia `dayOfMonth` estritamente depois de `day` (dia 31 em mês curto cai no último dia). */
export function nextDayOfMonth(day: Day, dayOfMonth: number): Day {
  const [a, m] = day.split('-').map(Number);
  const noMes = (ano: number, mes: number) => {
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return dateToDay(new Date(Date.UTC(ano, mes - 1, Math.min(Math.max(1, dayOfMonth), ultimo))));
  };
  const esteMes = noMes(a, m);
  if (esteMes > day) return esteMes;
  const prox = new Date(Date.UTC(a, m, 1));
  return noMes(prox.getUTCFullYear(), prox.getUTCMonth() + 1);
}
