import 'server-only';

import { getTenantClient, prisma } from '@clinicaiq/db';
import type { DaySchedule, WeekSchedule } from './schedule';
import { workingDay } from './schedule-rules';
import { inUnit } from './unit-rules';

// ─── Working hours ─────────────────────────────────────────────────────────────

interface DayHoursLike { open: boolean; start: string; end: string }

function isDayHoursLike(v: unknown): v is DayHoursLike {
  return (
    !!v && typeof v === 'object' &&
    typeof (v as DayHoursLike).open === 'boolean' &&
    typeof (v as DayHoursLike).start === 'string' &&
    typeof (v as DayHoursLike).end === 'string'
  );
}

/** Reads business hours (clinic settings JSON or a unit's own) as a 7-day fallback. */
function readBusinessWeek(bh: unknown): WeekSchedule {
  return Array.from({ length: 7 }, (_, i) => {
    const day = Array.isArray(bh) ? bh[i] : undefined;
    if (isDayHoursLike(day) && day.open) return { start: day.start, end: day.end };
    return null;
  });
}

/** A unidade da agenda: só valem os dias em que o profissional atende nela. */
export interface UnitScope {
  unitId: string;
  mainId: string;
  /** Horário próprio da unidade; nulo = o da clínica. */
  businessHours: unknown;
}

/**
 * Effective weekly working hours per professional. A professional with saved
 * `ProfessionalSchedule` rows uses them (days without a row = closed); otherwise
 * it falls back to the business hours (the unit's own, or the clinic's). With a
 * `unit`, a day booked at another unit counts as closed here. Index 0..6 = Sunday..Saturday.
 */
export async function buildWorkingHoursMap(
  tenantId: string,
  professionalIds: string[],
  unit?: UnitScope,
): Promise<Record<string, WeekSchedule>> {
  if (professionalIds.length === 0) return {};

  const [schedules, tenant] = await Promise.all([
    prisma.professionalSchedule.findMany({
      where: { professionalId: { in: professionalIds }, professional: { tenantId } },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
  ]);

  const clinicBh = ((tenant?.settings ?? {}) as Record<string, unknown>).businessHours;
  const businessWeek = readBusinessWeek(unit?.businessHours ?? clinicBh);

  const byProf = new Map<string, WeekSchedule>();
  for (const s of schedules) {
    let week = byProf.get(s.professionalId);
    if (!week) {
      week = Array.from({ length: 7 }, () => null);
      byProf.set(s.professionalId, week);
    }
    if (unit && !inUnit(s.unitId, unit.unitId, unit.mainId)) continue;
    week[s.dayOfWeek] = {
      start: s.startTime,
      end: s.endTime,
      lunchStart: s.lunchStart,
      lunchEnd: s.lunchEnd,
    };
  }

  const map: Record<string, WeekSchedule> = {};
  for (const pid of professionalIds) {
    map[pid] = byProf.get(pid) ?? businessWeek;
  }
  return map;
}


// ─── Escala por dia (spec 2026-11-18, F7) ─────────────────────────────────────

/**
 * O horário de cada profissional em cada dia de `from` a `to` (AAAA-MM-DD):
 * a escala nova (`schedule_rules` e as folgas e plantões) e, para quem ainda
 * não tem escala nova, o horário semanal de sempre. Com `unit`, só as regras
 * desta unidade contam.
 */
export async function buildWorkingDaysMap(
  tenantId: string,
  professionalIds: string[],
  from: string,
  to: string,
  unit?: UnitScope,
  careTypeId?: string | null,
): Promise<Record<string, Record<string, DaySchedule | null>>> {
  if (professionalIds.length === 0) return {};
  const ini = new Date(`${from}T00:00:00.000Z`);
  const fim = new Date(`${to}T23:59:59.999Z`);
  const db = getTenantClient(tenantId);
  const [semanal, regras, excecoes] = await Promise.all([
    buildWorkingHoursMap(tenantId, professionalIds, unit),
    db.scheduleRule.findMany({
      where: { professionalId: { in: professionalIds }, active: true, startsOn: { lte: fim }, OR: [{ endsOn: null }, { endsOn: { gte: ini } }] },
    }),
    db.scheduleException.findMany({ where: { professionalId: { in: professionalIds }, date: { gte: ini, lte: fim } } }),
  ]);
  // Quem tem alguma regra ativa (mesmo fora do período) usa só a escala nova.
  const comEscala = new Set(
    (await db.scheduleRule.findMany({ where: { professionalId: { in: professionalIds }, active: true }, select: { professionalId: true }, distinct: ['professionalId'] })).map((r) => r.professionalId),
  );
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const dias: string[] = [];
  for (let t = ini.getTime(); t <= fim.getTime() && dias.length < 400; t += 86_400_000) dias.push(new Date(t).toISOString().slice(0, 10));

  const out: Record<string, Record<string, DaySchedule | null>> = {};
  for (const pid of professionalIds) {
    const minhas = regras
      .filter((r) => r.professionalId === pid && (!unit || inUnit(r.unitId, unit.unitId, unit.mainId)))
      .map((r) => ({ ...r, startsOn: iso(r.startsOn)!, endsOn: iso(r.endsOn) }));
    const folgas = excecoes.filter((e) => e.professionalId === pid).map((e) => ({ ...e, date: iso(e.date)! }));
    const porDia: Record<string, DaySchedule | null> = {};
    for (const d of dias) {
      porDia[d] = workingDay({ rules: comEscala.has(pid) ? minhas : [], exceptions: folgas, fallback: comEscala.has(pid) ? undefined : semanal[pid], date: d, careTypeId });
    }
    out[pid] = porDia;
  }
  return out;
}
