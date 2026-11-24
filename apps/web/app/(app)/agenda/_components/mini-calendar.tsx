'use client';

import { useEffect, useState } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, isSameMonth, isSameDay,
  format, parseISO,
} from 'date-fns';
import { clinicToday } from '@/lib/tz';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MiniCalendarProps {
  selectedDate: string;
  onSelect: (dateStr: string) => void;
  /** Agenda nova: os dias com agendamento ganham um ponto (busca o mês mostrado). */
  marksFor?: (month: string) => Promise<Record<string, number>>;
}

export function MiniCalendar({ selectedDate, onSelect, marksFor }: MiniCalendarProps) {
  const selected = parseISO(selectedDate);
  const hoje = clinicToday();
  const [viewMonth, setViewMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));

  const [marks, setMarks] = useState<Record<string, number>>({});
  const mes = format(viewMonth, 'yyyy-MM');
  useEffect(() => {
    if (!marksFor) return;
    let vivo = true;
    marksFor(mes)
      .then((m) => vivo && setMarks(m))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [mes, marksFor]);

  const calStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const calEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });

  const days: Date[] = [];
  let cur = calStart;
  while (cur <= calEnd) {
    days.push(cur);
    cur = addDays(cur, 1);
  }

  const navBtn =
    'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-alt hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

  return (
    <div className="w-full select-none">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setViewMonth((m) => subMonths(m, 1))} className={navBtn} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="text-sm font-semibold capitalize">
          {format(viewMonth, 'MMMM yyyy', { locale: ptBR })}
        </span>
        <button type="button" onClick={() => setViewMonth((m) => addMonths(m, 1))} className={navBtn} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
          <span key={i} className="text-center text-[10px] font-medium text-muted-foreground">{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day) => {
          const isCurrentMonth = isSameMonth(day, viewMonth);
          const isSelected = isSameDay(day, selected);
          const dateStr = format(day, 'yyyy-MM-dd');
          // O dia da clínica, igual no servidor e no navegador: à noite o servidor (UTC) já está em "amanhã".
          const isTodayDay = dateStr === hoje;

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onSelect(dateStr)}
              aria-label={`${format(day, 'PPP', { locale: ptBR })}${marks[dateStr] ? `, ${marks[dateStr]} ${marks[dateStr] === 1 ? 'agendamento' : 'agendamentos'}` : ''}`}
              aria-pressed={isSelected}
              className={[
                'relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                !isCurrentMonth && 'text-muted-foreground',
                isCurrentMonth && !isSelected && !isTodayDay && 'text-foreground hover:bg-surface-alt',
                isTodayDay && !isSelected && 'font-semibold text-primary ring-1 ring-primary/50',
                isSelected && 'bg-primary font-semibold text-primary-foreground',
              ].filter(Boolean).join(' ')}
            >
              {day.getDate()}
              {isCurrentMonth && marks[dateStr] ? (
                <span className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${isSelected ? 'bg-primary-foreground' : 'bg-primary'}`} aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
