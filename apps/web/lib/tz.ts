/**
 * The app stores appointment datetimes as "wall-clock in UTC": a time entered
 * as 14:00 is stored as 14:00Z, regardless of where the server runs. So we must
 * read the wall-clock back from the UTC components (not the viewer's local
 * timezone), and compute "today" in the clinic's timezone — otherwise a UTC
 * server shows the wrong day/time for Brazilian users.
 */
export const CLINIC_TZ = 'America/Sao_Paulo';

/** Today's calendar date (YYYY-MM-DD) in the clinic timezone. */
export function clinicToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TZ }).format(new Date());
}

/** O dia da clínica (AAAA-MM-DD) de um instante real (ex.: quando o orçamento foi aprovado). */
export function clinicDayOf(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TZ }).format(new Date(d));
}

/** Wall-clock HH:mm of a stored datetime (read from UTC components). */
export function wallClockTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

/** Wall-clock minutes-since-midnight, for positioning blocks on the grid. */
export function wallClockMinutes(d: Date | string): number {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

// ─── Datas em documentos ─────────────────────────────────────────────────────
//
// Dois tipos de data moram no banco, e trocar um pelo outro é o erro clássico
// de "o PDF saiu com um dia a menos":
//
// - Data de parede (validade do orçamento, vencimento): o dia escolhido num
//   <input type="date">, gravado à meia-noite UTC. Lê-se pelos componentes UTC.
// - Instante (criado em, pago em): um momento real. Lê-se no fuso da clínica.

const pad2 = (n: number) => String(n).padStart(2, '0');

/** dd/mm/aaaa de uma data de parede. */
export function wallDateBR(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** dd/mm/aaaa de um instante, no fuso da clínica. */
export function instantDateBR(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: CLINIC_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** "3 de outubro de 2026" — para "São Paulo, 3 de outubro de 2026." */
export function instantDateLongBR(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: CLINIC_TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** dd/mm/aaaa às HH:mm de um instante, no fuso da clínica. */
export function instantDateTimeBR(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: CLINIC_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} às ${get('hour')}:${get('minute')}`;
}

/** dd/mm/aa de uma data de parede (lista apertada, celular). */
export function wallDateShortBR(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${pad2(date.getUTCFullYear() % 100)}`;
}

/** HH:mm de um instante, no fuso da clínica. */
export function instantTimeBR(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: CLINIC_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

/** dd/mm/aa HH:mm de um instante, no fuso da clínica (linha do tempo). */
export function instantDateTimeShortBR(d: Date | string): string {
  const full = instantDateBR(d);
  return `${full.slice(0, 6)}${full.slice(8)} ${instantTimeBR(d)}`;
}

/**
 * Idade em anos completos. A data de nascimento é de parede (meia-noite UTC) e
 * "hoje" é o dia da clínica: assim o servidor (UTC) e o navegador dão a mesma
 * resposta, inclusive no dia do aniversário. `null` sem data ou com data no futuro.
 */
export function ageFromBirth(birth: Date | string | null | undefined, today: string = clinicToday()): number | null {
  if (!birth) return null;
  const b = typeof birth === 'string' ? new Date(birth) : birth;
  if (Number.isNaN(b.getTime())) return null;
  const [y, m, d] = today.split('-').map(Number);
  let age = y - b.getUTCFullYear();
  if (m < b.getUTCMonth() + 1 || (m === b.getUTCMonth() + 1 && d < b.getUTCDate())) age--;
  return age >= 0 ? age : null;
}

/** Hora e minuto de agora na clínica, em minutos desde a meia-noite (a linha do "agora" da agenda). */
export function clinicNowMinutes(now: Date = new Date()): number {
  const [h, m] = instantTimeBR(now).split(':').map(Number);
  return h * 60 + m;
}
