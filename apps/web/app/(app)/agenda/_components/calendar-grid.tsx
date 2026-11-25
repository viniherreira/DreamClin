'use client';

import { useCallback, useMemo } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useGrid } from './grid-context';
import { AppointmentBlock } from './appointment-block';
import { owesMoney, type BillingStatus } from '@/lib/financeiro/billing';
import { CurrentTimeIndicator } from './current-time-indicator';
import { WorkingHoursOverlay } from './working-hours-overlay';
import { BlockedSlotBlock, type BlockedSlotItem } from './blocked-slot-block';
import type { DaySchedule, WeekSchedule } from '@/lib/schedule';
import { clinicToday } from '@/lib/tz';
import { firstLetters } from '@/lib/initials';

interface Professional {
  id: string;
  name: string;
  specialty?: string | null;
  color: string;
}

interface Appointment {
  id: string;
  startTime: Date | string;
  endTime: Date | string;
  status: string;
  patient: { id: string; name: string };
  professional: { id: string; name: string; specialty?: string | null };
  procedure?: { id: string; name: string; durationMinutes: number } | null;
  badges?: string[];
}

interface CalendarGridProps {
  dateStr: string;
  view: 'day' | 'week';
  professionals: Professional[];
  appointments: Appointment[];
  blockedSlots: BlockedSlotItem[];
  workingHours: Record<string, WeekSchedule>;
  /** Escala por dia (F7): profissional → data → horário. */
  workingDays?: Record<string, Record<string, DaySchedule | null>>;
  visibleProfessionals: Set<string>;
  mode: 'grouped' | 'sidebyside';
  onAppointmentClick: (id: string) => void;
  onBlockedSlotClick?: (id: string) => void;
  onSlotClick?: (professionalId: string, dateStr: string, timeStr: string) => void;
  /** Week view: clicking a day header opens that day. */
  onDayClick?: (dateStr: string) => void;
  /** Situação financeira de cada horário (financeiro completo). */
  billing?: Record<string, BillingStatus> | null;
  /** "Só quem falta pagar". */
  onlyOwing?: boolean;
}

/** Weekday index (0=Sun..6=Sat) for a `yyyy-MM-dd` string. */
function weekdayOf(iso: string): number {
  return parseISO(iso).getDay();
}

const HEADER_H = 44;

/**
 * De quantos em quantos minutos vai uma linha (e um horário escrito) na grade:
 * o intervalo da agenda, ou o múltiplo dele que dá pelo menos 15px de altura
 * (intervalo de 5 min viraria um risco por cima do outro).
 */
function rowMinutes(slotMinutes: number, hourPx: number): number {
  let step = Math.max(5, slotMinutes);
  while ((step * hourPx) / 60 < 15 && step < 60) step += slotMinutes;
  return Math.min(step, 60);
}

/** As linhas da grade numa camada pintada só (sem centenas de divs): fina a cada linha, mais forte na hora cheia. */
function gridBackground(hourPx: number, rowPx: number): React.CSSProperties {
  return {
    backgroundImage: [
      `repeating-linear-gradient(to bottom, hsl(var(--border)) 0 1px, transparent 1px ${hourPx}px)`,
      `repeating-linear-gradient(to bottom, hsl(var(--border) / 0.5) 0 1px, transparent 1px ${rowPx}px)`,
    ].join(', '),
  };
}

/** Os horários à esquerda, um por linha da grade, como uma tabela: a hora cheia em destaque. */
function TimeColumn() {
  const { startHour, endHour, hourPx, totalHeight, slotMinutes } = useGrid();
  const passo = rowMinutes(slotMinutes, hourPx);
  const rowPx = (passo * hourPx) / 60;
  const linhas: React.ReactNode[] = [];
  for (let m = startHour * 60; m < endHour * 60; m += passo) {
    const cheia = m % 60 === 0;
    linhas.push(
      <span
        key={m}
        className={`absolute inset-x-0 flex select-none items-center justify-end pr-2 tabular-nums ${cheia ? 'text-[11px] font-semibold text-foreground/80' : 'text-[10.5px] text-muted-foreground'}`}
        style={{ top: ((m - startHour * 60) * hourPx) / 60, height: rowPx }}
        aria-hidden="true"
      >
        {String(Math.floor(m / 60)).padStart(2, '0')}:{String(m % 60).padStart(2, '0')}
      </span>,
    );
  }
  return (
    <div className="relative w-14 shrink-0 border-r border-border bg-surface" style={{ height: totalHeight, ...gridBackground(hourPx, rowPx) }}>
      {linhas}
    </div>
  );
}

function ProfessionalHeader({ prof }: { prof: Professional }) {
  return (
    <div
      className="sticky top-0 z-30 flex items-center justify-center gap-2 border-b border-l border-border bg-surface/95 px-2 backdrop-blur-sm"
      style={{ height: HEADER_H }}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: prof.color }}
        aria-hidden="true"
      >
        {firstLetters(prof.name)}
      </span>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-xs font-semibold text-foreground">{prof.name}</p>
        {prof.specialty && <p className="truncate text-[10px] text-muted-foreground">{prof.specialty}</p>}
      </div>
    </div>
  );
}

export function CalendarGrid({
  dateStr, view, professionals, appointments, blockedSlots, workingHours, workingDays, visibleProfessionals, mode,
  onAppointmentClick, onBlockedSlotClick, onSlotClick, onDayClick, billing, onlyOwing = false,
}: CalendarGridProps) {
  const grid = useGrid();
  const TOTAL_HEIGHT_PX = grid.totalHeight;
  const GRID_BG = useMemo(
    () => gridBackground(grid.hourPx, (rowMinutes(grid.slotMinutes, grid.hourPx) * grid.hourPx) / 60),
    [grid.hourPx, grid.slotMinutes],
  );
  const visibleProfs = professionals.filter((p) => visibleProfessionals.has(p.id));
  const todayStr = clinicToday();

  const appointmentsWithColor = appointments
    .filter((a) => visibleProfessionals.has(a.professional.id))
    .filter((a) => !onlyOwing || owesMoney(billing?.[a.id]))
    .map((apt) => ({
      ...apt,
      professionalColor: professionals.find((p) => p.id === apt.professional.id)?.color,
    }));

  const visibleBlocks = blockedSlots.filter((b) => b.professional && visibleProfessionals.has(b.professional.id));
  // A escala do dia (F7) quando veio; senão o horário semanal.
  const scheduleFor = (profId: string, iso: string) => {
    const dia = workingDays?.[profId];
    if (dia && iso in dia) return dia[iso] ?? null;
    return workingHours[profId]?.[weekdayOf(iso)] ?? null;
  };

  const handleSlotClick = useCallback(
    (professionalId: string, slotDate: string, e: React.MouseEvent<HTMLElement>) => {
      if (!onSlotClick) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const y = Math.max(0, e.clientY - rect.top);
      const minutes = Math.floor(y / grid.slotHeight) * grid.slotMinutes;
      const hours = grid.startHour + Math.floor(minutes / 60);
      const mins = minutes % 60;
      const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      onSlotClick(professionalId, slotDate, timeStr);
    },
    [onSlotClick, grid]
  );

  // ── Week view: 7 day columns (Mon–Sun), appointments grouped by day ──
  if (view === 'week') {
    const base = parseISO(dateStr);
    const monday = addDays(base, -((base.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      return { iso: format(d, 'yyyy-MM-dd'), date: d };
    });
    const singleProf = visibleProfs.length === 1 ? visibleProfs[0] : null;

    return (
      <div className="flex min-w-max">
        <div className="sticky left-0 z-40 bg-surface">
          <div className="sticky top-0 z-50 border-b border-border bg-surface" style={{ height: HEADER_H }} />
          <TimeColumn />
        </div>

        {days.map(({ iso, date }) => {
          const isToday = iso === todayStr;
          const dayApts = appointmentsWithColor.filter(
            (a) => new Date(a.startTime).toISOString().slice(0, 10) === iso,
          );
          return (
            <div key={iso} className="w-44 min-w-36 flex-1">
              <button
                type="button"
                onClick={() => onDayClick?.(iso)}
                className="sticky top-0 z-30 flex w-full items-center justify-center gap-1.5 border-b border-l border-border bg-surface/95 px-2 backdrop-blur-sm transition-colors hover:bg-surface-alt focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                style={{ height: HEADER_H }}
                aria-label={`Abrir ${format(date, "EEEE, d 'de' MMMM", { locale: ptBR })}`}
              >
                <span className={`text-xs font-medium capitalize ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                  {format(date, 'EEEEEE', { locale: ptBR }).replace('.', '')}
                </span>
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                    isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'
                  }`}
                >
                  {date.getDate()}
                </span>
              </button>
              <div
                className={`relative border-l border-border ${isToday ? 'bg-primary/[0.03]' : ''}`}
                style={{ height: TOTAL_HEIGHT_PX, ...GRID_BG }}
              >
                {singleProf && <WorkingHoursOverlay day={scheduleFor(singleProf.id, iso)} />}
                {onSlotClick && singleProf && (
                  <button
                    type="button"
                    onClick={(e) => handleSlotClick(singleProf.id, iso, e)}
                    className="absolute inset-0 w-full cursor-pointer transition-colors hover:bg-primary/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    aria-label={`Criar agendamento em ${format(date, 'dd/MM')}`}
                  />
                )}
                {isToday && <CurrentTimeIndicator />}
                {singleProf && visibleBlocks
                  .filter((b) => new Date(b.startTime).toISOString().slice(0, 10) === iso)
                  .map((b) => <BlockedSlotBlock key={b.id} slot={b} onClick={onBlockedSlotClick} />)}
                {dayApts.map((apt) => (
                  <AppointmentBlock key={apt.id} appointment={apt} onClick={onAppointmentClick} billing={billing?.[apt.id]} narrow />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Day view ──────────────────────────────────────────────────────────
  const isCurrentDay = dateStr === todayStr;

  if (mode === 'sidebyside') {
    return (
      <div className="flex min-w-max">
        <div className="sticky left-0 z-40 bg-surface">
          <div className="sticky top-0 z-50 border-b border-border bg-surface" style={{ height: HEADER_H }} />
          <TimeColumn />
        </div>

        {visibleProfs.map((prof) => {
          const profApts = appointmentsWithColor.filter((a) => a.professional.id === prof.id);
          return (
            <div key={prof.id} className="w-56 min-w-44 flex-1">
              <ProfessionalHeader prof={prof} />
              <div className="relative border-l border-border" style={{ height: TOTAL_HEIGHT_PX, ...GRID_BG }}>
                <WorkingHoursOverlay day={scheduleFor(prof.id, dateStr)} />
                {onSlotClick && (
                  <button
                    type="button"
                    onClick={(e) => handleSlotClick(prof.id, dateStr, e)}
                    className="absolute inset-0 w-full cursor-pointer transition-colors hover:bg-primary/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    aria-label={`Criar agendamento para ${prof.name}`}
                  />
                )}
                {isCurrentDay && <CurrentTimeIndicator />}
                {visibleBlocks
                  .filter((b) => b.professional?.id === prof.id)
                  .map((b) => <BlockedSlotBlock key={b.id} slot={b} onClick={onBlockedSlotClick} />)}
                {profApts.map((apt) => (
                  <AppointmentBlock key={apt.id} appointment={apt} onClick={onAppointmentClick} billing={billing?.[apt.id]} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Grouped mode
  return (
    <div className="flex">
      <div className="sticky left-0 z-40 bg-surface">
        <div className="sticky top-0 z-50 border-b border-border bg-surface" style={{ height: HEADER_H }} />
        <TimeColumn />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="sticky top-0 z-30 flex items-center gap-3 overflow-x-auto border-b border-border bg-surface/95 px-3 backdrop-blur-sm"
          style={{ height: HEADER_H }}
        >
          {visibleProfs.map((p) => (
            <span key={p.id} className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} aria-hidden="true" />
              {p.name}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height: TOTAL_HEIGHT_PX, ...GRID_BG }}>
          {onSlotClick && visibleProfs.length === 1 && (
            <button
              type="button"
              onClick={(e) => handleSlotClick(visibleProfs[0].id, dateStr, e)}
              className="absolute inset-0 w-full cursor-pointer transition-colors hover:bg-primary/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              aria-label="Criar agendamento"
            />
          )}
          {isCurrentDay && <CurrentTimeIndicator />}
          {visibleBlocks.map((b) => (
            <BlockedSlotBlock key={b.id} slot={b} onClick={onBlockedSlotClick} />
          ))}
          {appointmentsWithColor.map((apt) => (
            <AppointmentBlock key={apt.id} appointment={apt} onClick={onAppointmentClick} billing={billing?.[apt.id]} />
          ))}
        </div>
      </div>
    </div>
  );
}
