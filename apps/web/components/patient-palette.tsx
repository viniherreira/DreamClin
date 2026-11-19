'use client';

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Search, UserRound, X } from 'lucide-react';
import { quickSearchPatientsAction } from '@/app/(app)/pacientes/actions';

/**
 * Busca de paciente do topo com Ctrl+K: abre uma janela com os últimos
 * pacientes abertos neste navegador e procura enquanto digita (nome, nº, CPF,
 * telefone e responsável financeiro). Enter abre o escolhido; setas andam.
 */

const CHAVE = 'dc-pacientes-recentes';
type Item = { id: string; name: string; controlNumber: number; via?: string };

export function readRecentPatients(): Item[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** A ficha chama ao abrir: o paciente vai para o topo dos recentes. */
export function rememberPatient(p: Item) {
  try {
    const lista = [p, ...readRecentPatients().filter((x) => x.id !== p.id)].slice(0, 8);
    localStorage.setItem(CHAVE, JSON.stringify(lista));
  } catch {}
}

export function RememberPatient({ id, name, controlNumber }: Item) {
  useEffect(() => {
    rememberPatient({ id, name, controlNumber });
  }, [id, name, controlNumber]);
  return null;
}

export function PatientPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [recentes, setRecentes] = useState<Item[]>([]);
  const [sel, setSel] = useState(0);
  const [pending, start] = useTransition();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const pedido = useRef(0);

  const abrir = useCallback(() => {
    setRecentes(readRecentPatients());
    setQ('');
    setItems([]);
    setSel(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        abrir();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abrir]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) {
      setItems([]);
      return;
    }
    const n = ++pedido.current;
    const t = setTimeout(() => {
      start(async () => {
        const r = await quickSearchPatientsAction(termo);
        if (n === pedido.current) {
          setItems(r);
          setSel(0);
        }
      });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const buscando = q.trim().length >= 2;
  const lista = buscando ? items : recentes;
  const ir = (it: Item) => {
    setOpen(false);
    router.push(`/pacientes/${it.id}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="hidden h-9 w-72 items-center gap-2 rounded-lg border border-border bg-surface-alt/60 px-2.5 text-sm text-muted-foreground hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring lg:flex"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="flex-1 text-left">Buscar paciente…</span>
        <kbd className="rounded border border-border bg-surface px-1.5 text-[11px] font-medium">Ctrl K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
          <div className="absolute inset-0 bg-foreground/40" onMouseDown={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Buscar paciente"
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSel((s) => Math.min(s + 1, Math.max(lista.length - 1, 0)));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSel((s) => Math.max(s - 1, 0));
                  } else if (e.key === 'Enter' && lista[sel]) {
                    e.preventDefault();
                    ir(lista[sel]);
                  }
                }}
                placeholder="Nome, nº, CPF, telefone ou responsável"
                aria-label="Buscar paciente"
                role="combobox"
                aria-expanded={lista.length > 0}
                aria-controls={listId}
                aria-activedescendant={lista[sel] ? `${listId}-${lista[sel].id}` : undefined}
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" aria-live="polite">
              {buscando ? (pending ? 'Procurando…' : `${items.length} encontrado${items.length === 1 ? '' : 's'}`) : 'Abertos por último'}
            </p>
            <ul id={listId} role="listbox" aria-label="Pacientes" className="max-h-80 overflow-y-auto p-2">
              {lista.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {buscando ? (pending ? '' : 'Nenhum paciente com esse termo.') : 'Os pacientes que você abrir aparecem aqui.'}
                </li>
              )}
              {lista.map((it, i) => (
                <li
                  key={it.id}
                  id={`${listId}-${it.id}`}
                  role="option"
                  aria-selected={i === sel}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => ir(it)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') ir(it);
                  }}
                  tabIndex={-1}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === sel ? 'bg-primary/10 text-foreground' : ''}`}
                >
                  {buscando ? (
                    <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{it.name}</span>
                  {it.via && <span className="truncate text-xs text-muted-foreground">{it.via}</span>}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">nº {it.controlNumber}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
