'use client';

import { Cake } from 'lucide-react';
import { stageOf, STAGE_LABELS } from '@/lib/appointment-flow';
import { BADGE_LABEL, sortAgendaList, type Badge, type ListSort } from '@/lib/agenda-view';
import { wallClockTime, wallDateShortBR } from '@/lib/tz';
import { STATUS_STYLES } from './constants';

interface Item {
  id: string;
  startTime: Date | string;
  endTime: Date | string;
  status: string;
  arrivedAt?: Date | string | null;
  startedAt?: Date | string | null;
  patient: { id: string; name: string };
  professional: { id: string; name: string };
  procedure?: { name: string } | null;
  label?: { name: string } | null;
  badges?: string[];
}

/** A agenda em lista (agenda nova): por horário, profissional ou paciente. */
export function AgendaList({
  appointments,
  sort,
  onSort,
  onOpen,
  showDate,
}: {
  appointments: Item[];
  sort: ListSort;
  onSort: (s: ListSort) => void;
  onOpen: (id: string) => void;
  showDate: boolean;
}) {
  const lista = sortAgendaList(appointments, sort);
  return (
    <div className="p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {lista.length} {lista.length === 1 ? 'agendamento' : 'agendamentos'}
        </p>
        <label className="flex items-center gap-2 text-xs">
          <span className="whitespace-nowrap text-muted-foreground">Ordenar por</span>
          <select value={sort} onChange={(e) => onSort(e.target.value as ListSort)} className="h-8 rounded-lg border border-border bg-background px-2 text-sm">
            <option value="horario">Horário</option>
            <option value="profissional">Profissional</option>
            <option value="paciente">Paciente</option>
          </select>
        </label>
      </div>
      {lista.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Nenhum agendamento.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Agendamentos em lista</caption>
            <thead className="bg-surface-alt/60 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Horário</th>
                <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
                <th scope="col" className="px-3 py-2 font-medium">Profissional</th>
                <th scope="col" className="px-3 py-2 font-medium">Procedimento</th>
                <th scope="col" className="px-3 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lista.map((a) => {
                const etapa = stageOf(a);
                const st = STATUS_STYLES[etapa] ?? STATUS_STYLES.SCHEDULED;
                const selos = (a.badges ?? []) as Badge[];
                return (
                  <tr key={a.id} className={a.status === 'CANCELLED' ? 'text-muted-foreground' : ''}>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {showDate && <span className="mr-1 text-muted-foreground">{wallDateShortBR(a.startTime)}</span>}
                      {wallClockTime(a.startTime)}–{wallClockTime(a.endTime)}
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => onOpen(a.id)} className={`text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring ${a.status === 'CANCELLED' ? 'line-through' : ''}`}>
                        {a.patient.name}
                      </button>
                      {selos.map((b) => (
                        <span key={b} className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-surface-alt px-1.5 text-[11px] font-medium">
                          {b === 'aniversario' && <Cake className="h-3 w-3" aria-hidden="true" />}
                          {BADGE_LABEL[b]}
                        </span>
                      ))}
                      {a.label && <span className="ml-1.5 rounded bg-surface-alt px-1.5 text-[11px]">{a.label.name}</span>}
                    </td>
                    <td className="px-3 py-2">{a.professional.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.procedure?.name ?? ''}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.bg} ${st.text}`}>{STAGE_LABELS[etapa]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
