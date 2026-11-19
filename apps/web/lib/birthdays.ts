/**
 * Aniversariantes por dia, semana ou mês. A data de nascimento é de parede
 * (meia-noite UTC) e "hoje" é o dia da clínica. Puro e testado.
 */

export type BirthdayRange = 'dia' | 'semana' | 'mes';

/** Os dias (mês 1–12, dia) do período, a partir de hoje (AAAA-MM-DD). A semana vai de segunda a domingo. */
export function birthdayDays(today: string, range: BirthdayRange): { month: number; day: number; date: string }[] {
  const [y, m, d] = today.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  let from = base;
  let count = 1;
  if (range === 'semana') {
    const dow = (base.getUTCDay() + 6) % 7; // segunda = 0
    from = new Date(base.getTime() - dow * 86_400_000);
    count = 7;
  } else if (range === 'mes') {
    from = new Date(Date.UTC(y, m - 1, 1));
    count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  return Array.from({ length: count }, (_, i) => {
    const x = new Date(from.getTime() + i * 86_400_000);
    return { month: x.getUTCMonth() + 1, day: x.getUTCDate(), date: x.toISOString().slice(0, 10) };
  });
}

/** Faz aniversário no dia? Quem nasceu em 29/02 comemora em 28/02 nos anos que não são bissextos. */
export function isBirthdayOn(birth: Date | string, date: string): boolean {
  const b = typeof birth === 'string' ? new Date(birth) : birth;
  const [y, m, d] = date.split('-').map(Number);
  const bm = b.getUTCMonth() + 1;
  const bd = b.getUTCDate();
  if (bm === m && bd === d) return true;
  const bissexto = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return bm === 2 && bd === 29 && !bissexto && m === 2 && d === 28;
}

/** A idade que a pessoa completa no ano da data. */
export function turningAge(birth: Date | string, date: string): number {
  const b = typeof birth === 'string' ? new Date(birth) : birth;
  return Number(date.slice(0, 4)) - b.getUTCFullYear();
}

/** Em qual dia do período cai o aniversário (ou null). */
export function birthdayInRange(birth: Date | string, days: { date: string }[]): string | null {
  return days.find((x) => isBirthdayOn(birth, x.date))?.date ?? null;
}
