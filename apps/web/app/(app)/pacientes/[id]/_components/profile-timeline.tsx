'use client';

import { useState, useTransition } from 'react';
import { CalendarCheck, CalendarClock, CalendarX, ClipboardList, FileText, MessageCircle, UserRound, Wallet, History } from 'lucide-react';
import { EVENT_GROUPS, eventGroup, EVENT_TYPES, isEventType } from '@/lib/patient-events';
import { instantDateTimeBR } from '@/lib/tz';
import { timelineAction } from '../profile-actions';

interface Item {
  id: string;
  type: string;
  summary: string;
  who: string;
  at: string;
}

const ICON: Record<string, typeof History> = {
  cadastro: UserRound,
  agenda: CalendarClock,
  clinico: ClipboardList,
  financeiro: Wallet,
  documentos: FileText,
  mensagens: MessageCircle,
};

function iconFor(type: string) {
  if (type === 'appointment.attended' || type === 'appointment.confirmed') return CalendarCheck;
  if (type === 'appointment.cancelled' || type === 'appointment.missed' || type === 'appointment.deleted') return CalendarX;
  return ICON[eventGroup(type) ?? ''] ?? History;
}

/**
 * "Na clínica": tudo o que aconteceu com o paciente, do mais novo para o mais
 * antigo, com quem fez. Filtro por tipo e "Ver mais" (páginas de 20).
 */
export function ProfileTimeline({ patientId, initial, more: maisInicial }: { patientId: string; initial: Item[]; more: boolean }) {
  const [items, setItems] = useState(initial);
  const [more, setMore] = useState(maisInicial);
  const [group, setGroup] = useState('');
  const [pending, start] = useTransition();

  const filtrar = (g: string) => {
    setGroup(g);
    start(async () => {
      const r = await timelineAction(patientId, { group: g || undefined });
      setItems(r.items);
      setMore(r.more);
    });
  };
  const verMais = () =>
    start(async () => {
      const r = await timelineAction(patientId, { group: group || undefined, before: items[items.length - 1]?.at });
      setItems([...items, ...r.items]);
      setMore(r.more);
    });

  return (
    <section aria-labelledby="linha-tempo" className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="linha-tempo" className="text-sm font-semibold">
          Na clínica
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Mostrar</span>
          <select value={group} onChange={(e) => filtrar(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-sm">
            <option value="">Tudo</option>
            {Object.entries(EVENT_GROUPS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{pending ? 'Carregando…' : 'Nada por aqui ainda.'}</p>
      ) : (
        <ol className="relative mt-4 space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border" aria-busy={pending}>
          {items.map((it) => {
            const Icon = iconFor(it.type);
            return (
              <li key={it.id} className="relative flex gap-3">
                <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm">
                    <span className="font-medium">{isEventType(it.type) ? EVENT_TYPES[it.type].label : it.type}</span>
                    {it.summary && <span className="text-muted-foreground"> · {it.summary}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {instantDateTimeBR(it.at)} · {it.who}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {more && (
        <div className="mt-4 text-center">
          <button type="button" onClick={verMais} disabled={pending} className="btn-outline btn-sm">
            {pending ? 'Carregando…' : 'Ver mais'}
          </button>
        </div>
      )}
    </section>
  );
}
