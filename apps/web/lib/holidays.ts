/**
 * Feriados nacionais do Brasil, calculados (fixos e os que dependem da
 * Páscoa), sem precisar cadastrar ano a ano. Os municipais e os dias que a
 * clínica marcar ficam na tabela `holidays`. Puro e testado.
 */

export interface HolidayDay {
  date: string; // AAAA-MM-DD
  name: string;
  national: boolean;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Os feriados nacionais (e o Carnaval e Corpus Christi, ponto facultativo muito usado) de um ano. */
export function nationalHolidays(year: number): HolidayDay[] {
  const pascoa = easterSunday(year);
  const fixos: [string, string][] = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Dia da Consciência Negra'],
    ['12-25', 'Natal'],
  ];
  const lista: HolidayDay[] = [
    ...fixos.map(([md, name]) => ({ date: `${year}-${md}`, name, national: true })),
    { date: shift(pascoa, -48), name: 'Carnaval', national: true },
    { date: shift(pascoa, -47), name: 'Carnaval', national: true },
    { date: shift(pascoa, -2), name: 'Sexta-feira Santa', national: true },
    { date: shift(pascoa, 60), name: 'Corpus Christi', national: true },
  ];
  return lista.sort((x, y) => x.date.localeCompare(y.date));
}

/** O feriado do dia (nacional ou da clínica), ou null. */
export function holidayOn(date: string, custom: readonly { date: string; name: string }[] = []): HolidayDay | null {
  const proprio = custom.find((c) => c.date === date);
  if (proprio) return { date, name: proprio.name, national: false };
  return nationalHolidays(Number(date.slice(0, 4))).find((h) => h.date === date) ?? null;
}

/** Os feriados entre duas datas (inclusive). */
export function holidaysBetween(from: string, to: string, custom: readonly { date: string; name: string }[] = []): HolidayDay[] {
  const anos = new Set<number>();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) anos.add(y);
  const nac = [...anos].flatMap(nationalHolidays);
  const proprios = custom.map((c) => ({ date: c.date, name: c.name, national: false }));
  const todos = [...proprios, ...nac.filter((n) => !proprios.some((p) => p.date === n.date))];
  return todos.filter((h) => h.date >= from && h.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}
