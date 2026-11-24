'use client';

import { useMemo } from 'react';
import { Check, CheckCheck, X, Ban, Clock, RotateCw, Armchair, Stethoscope, DollarSign, Cake, Smartphone } from 'lucide-react';
import { BADGE_LABEL, type Badge } from '@/lib/agenda-view';
import { BILLING_LABEL, BILLING_TONE, type BillingStatus } from '@/lib/financeiro/billing';
import { wallClockTime, wallClockMinutes } from '@/lib/tz';
import { stageOf, STAGE_LABELS } from '@/lib/appointment-flow';
import { labelClasses } from '@/lib/label-colors';
import { STATUS_STYLES } from './constants';
import { useGrid } from './grid-context';

interface Appointment {
  id: string;
  startTime: Date | string;
  endTime: Date | string;
  status: string;
  patient: { id: string; name: string };
  professional: { id: string; name: string; specialty?: string | null };
  procedure?: { id: string; name: string; durationMinutes: number } | null;
  professionalColor?: string;
  arrivedAt?: Date | string | null;
  startedAt?: Date | string | null;
  label?: { id: string; name: string; color: string } | null;
  /** Agenda nova: 1ª vez, aniversário, confirmou pelo WhatsApp ou link. */
  badges?: string[];
}

interface AppointmentBlockProps {
  appointment: Appointment;
  onClick?: (id: string) => void;
  /** Situação financeira (financeiro completo): o cifrão colorido no card. */
  billing?: BillingStatus;
}

const CIFRAO: Record<'gray' | 'amber' | 'blue' | 'green', string> = {
  gray: 'text-slate-400 dark:text-slate-500',
  amber: 'text-amber-600 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-emerald-600 dark:text-emerald-400',
};

const STATUS_ICON = {
  SCHEDULED: Clock,
  CONFIRMED: Check,
  ARRIVED: Armchair,
  IN_PROGRESS: Stethoscope,
  ATTENDED: CheckCheck,
  CANCELLED: Ban,
  MISSED: X,
  RESCHEDULED: RotateCw,
} as const;

export function AppointmentBlock({ appointment, onClick, billing }: AppointmentBlockProps) {
  // Datas guardadas pelo texto: um objeto novo a cada desenho refaria a conta à toa.
  const start = useMemo(() => new Date(appointment.startTime), [appointment.startTime]);
  const end = useMemo(() => new Date(appointment.endTime), [appointment.endTime]);

  const grid = useGrid();
  const { topPx, heightPx } = useMemo(() => {
    const topo = grid.minToPx(wallClockMinutes(start));
    return { topPx: topo, heightPx: Math.max(grid.minToPx(wallClockMinutes(end)) - topo, 32) };
  }, [start, end, grid]);

  const key = stageOf(appointment);
  const style = STATUS_STYLES[key] ?? STATUS_STYLES.SCHEDULED;
  const statusLabel = STAGE_LABELS[key];
  const Icon = STATUS_ICON[key] ?? Clock;
  const label = appointment.label;
  const timeLabel = wallClockTime(start);
  const isCancelled = appointment.status === 'CANCELLED';
  const compact = heightPx < 34;
  const selos = (appointment.badges ?? []) as Badge[];

  return (
    <button
      type="button"
      onClick={() => onClick?.(appointment.id)}
      className={[
        'group absolute left-1 right-1 z-10 flex flex-col overflow-hidden rounded-md border border-black/5 py-1 pl-2 pr-1.5 text-left shadow-sm transition-all',
        style.bg, style.text,
        'hover:z-20 hover:shadow-md hover:-translate-y-px',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        isCancelled ? 'opacity-70' : '',
      ].join(' ')}
      style={{
        top: topPx,
        height: heightPx,
        borderLeftWidth: 3,
        borderLeftColor: appointment.professionalColor ?? '#94a3b8',
      }}
      aria-label={`${timeLabel} ${appointment.patient.name}, ${appointment.professional.name}, ${statusLabel}${label ? `, rótulo ${label.name}` : ''}${billing ? `, financeiro: ${BILLING_LABEL[billing]}` : ''}${selos.length ? `, ${selos.map((b) => BADGE_LABEL[b]).join(', ')}` : ''}`}
    >
      <div className="flex min-w-0 items-center gap-1">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${style.icon}`} aria-hidden="true" />
        <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums opacity-80">{timeLabel}</span>
        <span className={`truncate text-xs font-semibold leading-tight ${isCancelled ? 'line-through' : ''}`}>
          {appointment.patient.name}
        </span>
        {selos.includes('primeira') && (
          <span className="shrink-0 rounded bg-white/70 px-1 text-[10px] font-bold leading-4 text-foreground dark:bg-black/30" aria-hidden="true">
            1ª
          </span>
        )}
        {selos.includes('aniversario') && <Cake className="h-3.5 w-3.5 shrink-0 text-pink-600 dark:text-pink-400" aria-hidden="true" />}
        {selos.includes('paciente') && <Smartphone className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />}
        {billing && billing !== 'NONE' && (
          <DollarSign className={`h-3.5 w-3.5 shrink-0 ${label ? '' : 'ml-auto'} ${CIFRAO[BILLING_TONE[billing]]}`} aria-hidden="true" />
        )}
        {label && (
          <span className={`ml-auto shrink-0 rounded px-1 text-[10px] font-semibold leading-4 ${labelClasses(label.color).chip}`} aria-hidden="true">
            {label.name}
          </span>
        )}
      </div>
      {!compact && (
        <span className="truncate pl-[18px] text-[11px] leading-tight opacity-70">
          {appointment.professional.name}
          {appointment.procedure && ` · ${appointment.procedure.name}`}
        </span>
      )}
    </button>
  );
}
