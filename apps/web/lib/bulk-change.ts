/**
 * Alterações em massa na agenda (spec 2026-11-18, F6): o que muda em cada
 * agendamento escolhido. Puro e testado; o servidor confere conflitos e grava
 * numa transação só.
 */

export interface BulkChange {
  professionalId?: string | null;
  agendaId?: string | null;
  /** Desloca a data em N dias, mantendo a hora. */
  shiftDays?: number;
  /** Ou move para este dia, mantendo a hora. */
  moveToDate?: string | null;
  status?: 'SCHEDULED' | 'CONFIRMED' | null;
  labelId?: string | null;
}

export interface BulkTarget {
  id: string;
  startTime: Date;
  endTime: Date;
  professionalId: string;
  agendaId: string | null;
  status: string;
  labelId: string | null;
}

export interface BulkPlanItem {
  id: string;
  data: { startTime?: Date; endTime?: Date; professionalId?: string; agendaId?: string | null; status?: string; labelId?: string | null };
  moved: boolean;
}

/** Só o que ainda vai acontecer muda: atendido, faltou e cancelado ficam. */
export const BULK_CHANGEABLE = ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] as const;

export function bulkPlan(targets: readonly BulkTarget[], c: BulkChange): BulkPlanItem[] {
  const out: BulkPlanItem[] = [];
  for (const t of targets) {
    if (!(BULK_CHANGEABLE as readonly string[]).includes(t.status)) continue;
    const data: BulkPlanItem['data'] = {};
    let start = t.startTime;
    let end = t.endTime;
    if (c.moveToDate && /^\d{4}-\d{2}-\d{2}$/.test(c.moveToDate)) {
      const [y, m, d] = c.moveToDate.split('-').map(Number);
      const dur = end.getTime() - start.getTime();
      start = new Date(Date.UTC(y, m - 1, d, start.getUTCHours(), start.getUTCMinutes()));
      end = new Date(start.getTime() + dur);
    } else if (c.shiftDays) {
      start = new Date(start.getTime() + c.shiftDays * 86_400_000);
      end = new Date(end.getTime() + c.shiftDays * 86_400_000);
    }
    const moved = start.getTime() !== t.startTime.getTime();
    if (moved) {
      data.startTime = start;
      data.endTime = end;
    }
    if (c.professionalId && c.professionalId !== t.professionalId) data.professionalId = c.professionalId;
    if (c.agendaId !== undefined && c.agendaId !== t.agendaId) data.agendaId = c.agendaId;
    if (c.status && c.status !== t.status) data.status = c.status;
    if (c.labelId !== undefined && c.labelId !== t.labelId) data.labelId = c.labelId;
    if (Object.keys(data).length) out.push({ id: t.id, data, moved: moved || Boolean(data.professionalId) });
  }
  return out;
}
