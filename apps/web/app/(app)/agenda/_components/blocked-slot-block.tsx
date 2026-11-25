'use client';

import { CalendarX2 } from 'lucide-react';
import { wallClockTime, wallClockMinutes } from '@/lib/tz';
import { useGrid } from './grid-context';

export interface BlockedSlotItem {
  id: string;
  startTime: Date | string;
  endTime: Date | string;
  reason?: string | null;
  professional?: { id: string; name: string } | null;
}

/**
 * Tempo em que o profissional não atende (almoço, férias, feriado…): faixa
 * cinza com a barra escura à esquerda e o texto no meio, como nas agendas de
 * clínica de mercado. Clicar pergunta se quer tirar o bloqueio.
 */
export function BlockedSlotBlock({
  slot,
  onClick,
}: {
  slot: BlockedSlotItem;
  onClick?: (id: string) => void;
}) {
  const start = new Date(slot.startTime);
  const end = new Date(slot.endTime);
  const grid = useGrid();
  const topPx = grid.minToPx(wallClockMinutes(start));
  const heightPx = Math.max(grid.minToPx(wallClockMinutes(end)) - topPx - 1, 18);
  const texto = [slot.professional?.name, slot.reason || 'Bloqueado'].filter(Boolean).join(' / ');

  return (
    <button
      type="button"
      onClick={() => onClick?.(slot.id)}
      className="group absolute left-0.5 right-1 z-10 flex overflow-hidden rounded-[4px] bg-surface-alt text-left text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      style={{ top: topPx, height: heightPx }}
      aria-label={`Horário bloqueado das ${wallClockTime(start)} às ${wallClockTime(end)}${slot.reason ? `, ${slot.reason}` : ''}. Clique para remover.`}
      title={slot.reason ? `Bloqueado: ${slot.reason}` : 'Bloqueado'}
    >
      <span className="w-3.5 shrink-0 bg-slate-500 dark:bg-slate-600" aria-hidden="true" />
      <span className={`flex min-w-0 flex-1 gap-1.5 px-2 ${heightPx >= 60 ? 'items-center' : 'items-start py-[3px]'}`}>
        <CalendarX2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span
          className={`min-w-0 text-[11px] font-medium uppercase leading-[15px] ${heightPx >= 40 ? 'overflow-hidden' : 'truncate'}`}
          style={heightPx >= 40 ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3 } : undefined}
        >
          <span className="mr-1 tabular-nums">{wallClockTime(start)}</span>
          {texto}
        </span>
      </span>
    </button>
  );
}
