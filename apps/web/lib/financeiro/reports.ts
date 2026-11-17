/**
 * Contas puras dos relatórios: os períodos prontos (mês, trimestre, semestre,
 * ano), as colunas do fluxo de caixa (dia, semana ou mês) e as faixas de
 * atraso. Testado em `reports.test.ts`.
 */

import { addDays, addMonths, daysBetween, type Day } from './dates';

export type PeriodPreset = 'month' | 'prev-month' | 'next-month' | 'quarter' | 'prev-quarter' | 'next-quarter' | 'semester' | 'year' | 'prev-year' | 'last-30';

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  month: 'Mês atual',
  'prev-month': 'Mês anterior',
  'next-month': 'Próximo mês',
  quarter: 'Trimestre atual',
  'prev-quarter': 'Trimestre anterior',
  'next-quarter': 'Próximo trimestre',
  semester: 'Semestre atual',
  year: 'Ano atual',
  'prev-year': 'Ano anterior',
  'last-30': 'Últimos 30 dias',
};

const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const dia = (ano: number, mes: number, d: number): Day => `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** O período (de, até) de um atalho, a partir de hoje. */
export function presetRange(p: PeriodPreset, today: Day): { from: Day; to: Day } {
  const ano = Number(today.slice(0, 4));
  const mes = Number(today.slice(5, 7));
  const meses = (inicio: number, n: number) => {
    const a = ano + Math.floor((inicio - 1) / 12);
    const m = ((((inicio - 1) % 12) + 12) % 12) + 1;
    const fim = addMonths(dia(a, m, 1), n);
    return { from: dia(a, m, 1), to: addDays(fim, -1) };
  };
  const tri = Math.floor((mes - 1) / 3) * 3 + 1;
  switch (p) {
    case 'month':
      return meses(mes, 1);
    case 'prev-month':
      return meses(mes - 1, 1);
    case 'next-month':
      return meses(mes + 1, 1);
    case 'quarter':
      return meses(tri, 3);
    case 'prev-quarter':
      return meses(tri - 3, 3);
    case 'next-quarter':
      return meses(tri + 3, 3);
    case 'semester':
      return meses(mes <= 6 ? 1 : 7, 6);
    case 'year':
      return { from: dia(ano, 1, 1), to: dia(ano, 12, 31) };
    case 'prev-year':
      return { from: dia(ano - 1, 1, 1), to: dia(ano - 1, 12, 31) };
    case 'last-30':
      return { from: addDays(today, -29), to: today };
  }
}

/** O mesmo tamanho de período, imediatamente antes (para comparar). */
export function previousRange(from: Day, to: Day): { from: Day; to: Day } {
  // Mês cheio: o mês anterior cheio.
  const mesCheio = from.endsWith('-01') && to === dia(Number(to.slice(0, 4)), Number(to.slice(5, 7)), ultimoDia(Number(to.slice(0, 4)), Number(to.slice(5, 7))));
  if (mesCheio) {
    const n = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
    const ini = addMonths(from, -n);
    return { from: ini, to: addDays(from, -1) };
  }
  const tam = daysBetween(from, to) + 1;
  return { from: addDays(from, -tam), to: addDays(from, -1) };
}

export type Granularity = 'day' | 'week' | 'month';

/** Dia, semana ou mês, pelo tamanho do período (ou semanas, se a pessoa pedir). */
export function granularityFor(from: Day, to: Day, weekly = false): Granularity {
  if (weekly) return 'week';
  const dias = daysBetween(from, to) + 1;
  if (dias <= 31) return 'day';
  if (dias <= 92) return 'week';
  return 'month';
}

export interface Bucket {
  key: string;
  from: Day;
  to: Day;
  label: string;
}

const br = (d: Day) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** As colunas do período. Semana começa na segunda. */
export function buckets(from: Day, to: Day, g: Granularity): Bucket[] {
  const out: Bucket[] = [];
  if (g === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ key: d, from: d, to: d, label: br(d) });
    return out;
  }
  if (g === 'week') {
    let ini = from;
    while (ini <= to) {
      const semana = new Date(`${ini}T00:00:00Z`).getUTCDay();
      const ateDomingo = semana === 0 ? 0 : 7 - semana;
      const fim = addDays(ini, ateDomingo) > to ? to : addDays(ini, ateDomingo);
      out.push({ key: ini, from: ini, to: fim, label: `${br(ini)} a ${br(fim)}` });
      ini = addDays(fim, 1);
    }
    return out;
  }
  let ini = from;
  while (ini <= to) {
    const a = Number(ini.slice(0, 4));
    const m = Number(ini.slice(5, 7));
    const fimMes = dia(a, m, ultimoDia(a, m));
    const fim = fimMes > to ? to : fimMes;
    out.push({ key: `${a}-${String(m).padStart(2, '0')}`, from: ini, to: fim, label: `${MESES[m - 1]}/${String(a).slice(2)}` });
    ini = addDays(fim, 1);
  }
  return out;
}

/** Em qual coluna cai um dia. -1 se fora do período. */
export function bucketIndex(list: readonly Bucket[], d: Day): number {
  for (let i = 0; i < list.length; i++) if (d >= list[i].from && d <= list[i].to) return i;
  return -1;
}

/** Os meses (AAAA-MM) de um período, para a DRE por competência. */
export function competencesBetween(from: Day, to: Day): string[] {
  const out: string[] = [];
  let a = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const fa = Number(to.slice(0, 4));
  const fm = Number(to.slice(5, 7));
  while (a < fa || (a === fa && m <= fm)) {
    out.push(`${a}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }
  return out;
}

export type AgingBucket = '1-30' | '31-60' | '61-90' | '90+';
export const AGING_BUCKETS: readonly AgingBucket[] = ['1-30', '31-60', '61-90', '90+'];

/** Inadimplência: vencido sobre o que venceu no período (em %). Nulo sem base. */
export function defaultRate(overdueCents: number, dueCents: number): number | null {
  if (dueCents <= 0) return null;
  return Math.round((overdueCents / dueCents) * 1000) / 10;
}
