'use client';

import { useId, useRef, useState } from 'react';
import { Lock } from 'lucide-react';

export interface GTab {
  id: string;
  label: string;
  badge?: number;
  alert?: boolean;
  /** Trancado para o perfil (prontuário): mostra o cadeado. */
  locked?: boolean;
  content: React.ReactNode;
}

export interface GGroup {
  id: string;
  label: string;
  tabs: GTab[];
}

/**
 * As abas do perfil agrupadas (Resumo, Clínico, Agenda…): em cima os grupos,
 * embaixo as abas do grupo. A aba aberta fica no endereço (`?aba=`) para
 * voltar nela ao recarregar ou mandar o link. Setas andam entre as abas.
 */
export function GroupedTabs({ groups, initial }: { groups: GGroup[]; initial?: string }) {
  const todas = groups.flatMap((g) => g.tabs.map((t) => ({ ...t, group: g.id })));
  const inicial = todas.find((t) => t.id === initial) ?? todas[0];
  const [active, setActive] = useState(inicial?.id);
  const baseId = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const atual = todas.find((t) => t.id === active) ?? todas[0];
  const grupo = groups.find((g) => g.id === atual?.group) ?? groups[0];

  function open(id: string, focus = false) {
    setActive(id);
    const url = new URL(window.location.href);
    url.searchParams.set('aba', id);
    window.history.replaceState(null, '', url);
    if (focus) setTimeout(() => refs.current[id]?.focus(), 0);
  }

  function onKey(e: React.KeyboardEvent, list: { id: string }[], i: number) {
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    if (n >= 0) {
      e.preventDefault();
      open(list[n].id, true);
    }
  }

  const contagem = (g: GGroup) => g.tabs.reduce((s, t) => s + (t.badge ?? 0), 0);
  const alerta = (g: GGroup) => g.tabs.some((t) => t.alert);

  return (
    <div>
      <div className="sticky top-[var(--profile-top,0px)] z-20 -mx-4 bg-canvas/95 px-4 pt-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <nav aria-label="Grupos da ficha" className="flex gap-1.5 overflow-x-auto pb-2">
          {groups.map((g) => {
            const on = g.id === grupo.id;
            return (
              <button
                key={g.id}
                type="button"
                aria-current={on ? 'true' : undefined}
                onClick={() => open(g.tabs[0].id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface text-muted-foreground hover:text-foreground'
                }`}
              >
                {g.label}
                {g.tabs.every((t) => t.locked) && <Lock className="h-3 w-3" aria-label="sem acesso" />}
                {contagem(g) > 0 && (
                  <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${alerta(g) ? 'bg-red-600 text-white' : on ? 'bg-primary-foreground/20' : 'bg-surface-alt'}`}>{contagem(g)}</span>
                )}
              </button>
            );
          })}
        </nav>
        {grupo.tabs.length > 1 && (
          <div role="tablist" aria-label={grupo.label} className="flex gap-1 overflow-x-auto border-b border-border">
            {grupo.tabs.map((t, i) => {
              const on = t.id === atual.id;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    refs.current[t.id] = el;
                  }}
                  role="tab"
                  id={`${baseId}-tab-${t.id}`}
                  aria-selected={on}
                  aria-controls={`${baseId}-panel`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => open(t.id)}
                  onKeyDown={(e) => onKey(e, grupo.tabs, i)}
                  className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${on ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t.label}
                  {t.locked && <Lock className="h-3 w-3" aria-label="sem acesso" />}
                  {!!t.badge && t.badge > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${t.alert ? 'bg-red-600 text-white' : on ? 'bg-primary/15 text-primary' : 'bg-surface-alt text-muted-foreground'}`}>{t.badge}</span>
                  )}
                  {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div
        id={`${baseId}-panel`}
        role={grupo.tabs.length > 1 ? 'tabpanel' : 'region'}
        aria-labelledby={grupo.tabs.length > 1 ? `${baseId}-tab-${atual.id}` : undefined}
        aria-label={grupo.tabs.length > 1 ? undefined : atual.label}
        tabIndex={0}
        className="pt-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {todas.map((t) => (
          <div key={t.id} hidden={t.id !== atual.id}>
            {t.content}
          </div>
        ))}
      </div>
    </div>
  );
}
