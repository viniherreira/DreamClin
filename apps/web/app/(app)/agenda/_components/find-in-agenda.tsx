'use client';

import { useEffect, useId, useState } from 'react';
import { Search } from 'lucide-react';
import { wallClockTime, wallDateShortBR } from '@/lib/tz';
import { findPatientInAgenda } from '../view-actions';

type Hit = Awaited<ReturnType<typeof findPatientInAgenda>>[number];

/** "Achar paciente na agenda": os próximos e os últimos horários; clicar leva ao dia. */
export function FindInAgenda({ onPick }: { onPick: (date: string, appointmentId: string) => void }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      findPatientInAgenda(q)
        .then((r) => vivo && setHits(r))
        .catch(() => vivo && setHits([]));
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Achar paciente na agenda
      </label>
      <div className="relative mt-1.5">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou nº" autoComplete="off" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-sm" />
      </div>
      {hits && (
        <ul aria-label="Horários encontrados" className="mt-1.5 max-h-64 space-y-0.5 overflow-y-auto">
          {hits.length === 0 && <li className="px-1 py-1 text-xs text-muted-foreground">Nenhum horário para esse paciente.</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(h.startTime.slice(0, 10), h.id);
                  setQ('');
                }}
                className="block w-full rounded-md px-1.5 py-1 text-left text-xs hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className={`font-medium tabular-nums ${h.future ? '' : 'text-muted-foreground'}`}>
                  {wallDateShortBR(h.startTime)} {wallClockTime(h.startTime)}
                </span>{' '}
                <span className="text-muted-foreground">· {h.status}</span>
                <span className="block truncate">{h.patient}</span>
                <span className="block truncate text-muted-foreground">{h.professional}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
