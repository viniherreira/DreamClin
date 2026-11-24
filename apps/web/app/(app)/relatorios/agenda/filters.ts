import { clinicToday } from '@/lib/tz';
import type { ReportFilters } from '@/lib/agenda-reports-server';

const okDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Os filtros do endereço (tela e exportação leem igual). Padrão: do dia 1 do mês até hoje. */
export function readReportFilters(sp: Record<string, string | undefined>): ReportFilters {
  const hoje = clinicToday();
  let from = okDate(sp.de) ? sp.de : `${hoje.slice(0, 8)}01`;
  let to = okDate(sp.ate) ? sp.ate : hoje;
  if (from > to) [from, to] = [to, from];
  const dias = Number(sp.dias);
  return {
    from,
    to,
    professionalId: sp.profissional || undefined,
    dim: sp.por || undefined,
    days: Number.isFinite(dias) && dias > 0 ? Math.min(3650, Math.floor(dias)) : undefined,
  };
}
