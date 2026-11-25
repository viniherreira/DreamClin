'use client';

import { useMemo } from 'react';
import { Check, CheckCheck, X, Ban, Clock, RotateCw, Armchair, Stethoscope, DollarSign, Cake, Smartphone, UserRound } from 'lucide-react';
import { BADGE_LABEL, type Badge } from '@/lib/agenda-view';
import { BILLING_LABEL, BILLING_TONE, type BillingStatus } from '@/lib/financeiro/billing';
import { wallClockTime, wallClockMinutes } from '@/lib/tz';
import { stageOf, STAGE_LABELS } from '@/lib/appointment-flow';
import { cardColor, readableOn } from '@/lib/agenda-card-color';
import { STATUS_STYLES } from './constants';
import { useGrid } from './grid-context';

interface Appointment {
  id: string;
  startTime: Date | string;
  endTime: Date | string;
  status: string;
  patient: { id: string; name: string };
  professional: { id: string; name: string; specialty?: string | null };
  procedure?: { id: string; name: string; durationMinutes: number; color?: string | null; category?: { color: string | null } | null } | null;
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
  /** Coluna estreita (semana): sem o nome do rótulo, que a cor do card já mostra. */
  narrow?: boolean;
}

/** O cifrão sobre a cor do card: claro no fundo escuro, escuro no claro. */
const CIFRAO: Record<'gray' | 'amber' | 'blue' | 'green', { claro: string; escuro: string }> = {
  gray: { claro: 'text-white/60', escuro: 'text-black/45' },
  amber: { claro: 'text-amber-200', escuro: 'text-amber-800' },
  blue: { claro: 'text-sky-200', escuro: 'text-blue-800' },
  green: { claro: 'text-emerald-200', escuro: 'text-emerald-800' },
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

/** Altura de uma linha de texto do card, para saber quantas cabem. */
const LINHA_PX = 15;

/**
 * Um horário na grade, como nas agendas de clínica de mercado: barra cheia na cor
 * do rótulo, do procedimento ou do profissional, a situação num ícone à esquerda
 * e tudo numa linha: "12:00 PACIENTE / PROFISSIONAL / PROCEDIMENTO". Com espaço,
 * o texto quebra em mais linhas em vez de cortar.
 */
export function AppointmentBlock({ appointment, onClick, billing, narrow = false }: AppointmentBlockProps) {
  // Datas guardadas pelo texto: um objeto novo a cada desenho refaria a conta à toa.
  const start = useMemo(() => new Date(appointment.startTime), [appointment.startTime]);
  const end = useMemo(() => new Date(appointment.endTime), [appointment.endTime]);

  const grid = useGrid();
  const { topPx, heightPx } = useMemo(() => {
    const topo = grid.minToPx(wallClockMinutes(start));
    // 1px de folga embaixo: horários seguidos ficam como faixas separadas.
    return { topPx: topo, heightPx: Math.max(grid.minToPx(wallClockMinutes(end)) - topo - 1, 12) };
  }, [start, end, grid]);

  const key = stageOf(appointment);
  const style = STATUS_STYLES[key] ?? STATUS_STYLES.SCHEDULED;
  const statusLabel = STAGE_LABELS[key];
  const Icon = STATUS_ICON[key] ?? Clock;
  const label = appointment.label;
  const timeLabel = wallClockTime(start);
  const isCancelled = appointment.status === 'CANCELLED';
  const apagado = isCancelled || appointment.status === 'MISSED' || appointment.status === 'RESCHEDULED';
  const selos = (appointment.badges ?? []) as Badge[];

  const cor = cardColor({
    label: label?.color,
    procedure: appointment.procedure?.color ?? appointment.procedure?.category?.color,
    professional: appointment.professionalColor,
  });
  const texto = readableOn(cor);
  const claro = texto === 'light';
  const linhas = Math.max(1, Math.floor((heightPx - 4) / LINHA_PX));
  // Horário curto (5 ou 10 min): uma linha só, centrada, sem a folga de cima.
  const baixo = heightPx < 20;

  return (
    <button
      type="button"
      onClick={() => onClick?.(appointment.id)}
      className={[
        'group absolute left-0.5 right-1 z-10 flex overflow-hidden rounded-[4px] text-left shadow-[0_1px_1px_rgba(15,23,42,0.12)] transition-[box-shadow,transform]',
        'hover:z-20 hover:shadow-md hover:-translate-y-px',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        apagado ? 'opacity-55 saturate-50' : '',
      ].join(' ')}
      style={{ top: topPx, height: heightPx, backgroundColor: cor }}
      aria-label={`${timeLabel} ${appointment.patient.name}, ${appointment.professional.name}${appointment.procedure ? `, ${appointment.procedure.name}` : ''}, ${statusLabel}${label ? `, rótulo ${label.name}` : ''}${billing ? `, financeiro: ${BILLING_LABEL[billing]}` : ''}${selos.length ? `, ${selos.map((b) => BADGE_LABEL[b]).join(', ')}` : ''}`}
    >
      {/* A situação: faixa clara com o ícone, sempre igual, qualquer que seja a cor do card. */}
      <span className={`relative flex w-[22px] shrink-0 justify-center bg-surface ${baixo ? 'items-center' : 'pt-[3px]'}`} title={statusLabel} aria-hidden="true">
        <span className={`absolute inset-0 ${style.bg}`} />
        <Icon className={`relative h-3.5 w-3.5 ${style.icon}`} />
      </span>

      <span className={`flex min-w-0 flex-1 gap-1 px-1.5 ${baixo ? 'items-center' : 'items-start py-[3px]'} ${claro ? 'text-white' : 'text-slate-900'}`}>
        <span
          className={`min-w-0 flex-1 text-[11px] font-semibold uppercase leading-[15px] tracking-[0.01em] ${linhas === 1 ? 'truncate whitespace-nowrap' : 'overflow-hidden'} ${isCancelled ? 'line-through' : ''}`}
          style={linhas > 1 ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: linhas } : undefined}
        >
          <span className="mr-1.5 tabular-nums">{timeLabel}</span>
          {appointment.patient.name}
          <span className={claro ? 'text-white/75' : 'text-slate-900/70'}>
            {' / '}
            <UserRound className="mb-px mr-0.5 inline h-3 w-3 align-middle" aria-hidden="true" />
            {appointment.professional.name}
            {appointment.procedure && ` / ${appointment.procedure.name}`}
          </span>
        </span>

        {(selos.length > 0 || (billing && billing !== 'NONE') || (label && !narrow)) && (
          <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
            {selos.includes('primeira') && !narrow && (
              <span className={`rounded-[3px] px-1 text-[10px] font-bold leading-4 ${claro ? 'bg-white/25' : 'bg-black/10'}`}>1ª</span>
            )}
            {selos.includes('aniversario') && <Cake className="h-3.5 w-3.5" />}
            {selos.includes('paciente') && <Smartphone className="h-3.5 w-3.5" />}
            {billing && billing !== 'NONE' && (
              <DollarSign className={`h-3.5 w-3.5 ${claro ? CIFRAO[BILLING_TONE[billing]].claro : CIFRAO[BILLING_TONE[billing]].escuro}`} />
            )}
            {label && !narrow && (
              <span className={`max-w-[7rem] truncate rounded-[3px] px-1 text-[10px] font-semibold leading-4 ${claro ? 'bg-white/25' : 'bg-black/10'}`}>
                {label.name}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}
