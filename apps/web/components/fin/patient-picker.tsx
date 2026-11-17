'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { Search, X } from 'lucide-react';
import { searchPatients } from '@/app/(app)/agenda/actions';
import { inputCls } from './ui';

/** Busca de paciente pelo nome, para as telas do financeiro. */
export function PatientPicker({ label = 'Paciente', value, onChange }: { label?: string; value: { id: string; name: string } | null; onChange: (p: { id: string; name: string } | null) => void }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<{ id: string; name: string; controlNumber: number }[]>([]);
  const [aberto, setAberto] = useState(false);
  const [, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    if (value || q.trim().length < 2) {
      setLista([]);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(
      () =>
        start(async () => {
          const r = await searchPatients(q);
          if (n === seq.current) {
            setLista(r);
            setAberto(true);
          }
        }),
      250,
    );
    return () => clearTimeout(t);
  }, [q, value]);

  if (value)
    return (
      <div>
        <span className="block text-sm font-medium">{label}</span>
        <p className="mt-1 flex h-9 items-center justify-between rounded-lg border border-border bg-surface-alt px-2.5 text-sm">
          <span className="truncate font-medium">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Trocar o paciente" className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </p>
      </div>
    );

  return (
    <div className="relative">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          id={id}
          role="combobox"
          aria-expanded={aberto && lista.length > 0}
          aria-controls={`${id}-lista`}
          aria-autocomplete="list"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => setTimeout(() => setAberto(false), 150)}
          placeholder="Digite o nome…"
          className={`${inputCls} pl-8`}
        />
      </div>
      {aberto && lista.length > 0 && (
        <ul id={`${id}-lista`} role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-xl">
          {lista.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={() => {
                  onChange({ id: p.id, name: p.name });
                  setQ('');
                  setAberto(false);
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-surface-alt"
              >
                {p.name} <span className="text-xs text-muted-foreground">· ficha {String(p.controlNumber).padStart(4, '0')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
