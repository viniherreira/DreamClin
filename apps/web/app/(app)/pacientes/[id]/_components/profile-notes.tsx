'use client';

import { useState, useTransition } from 'react';
import { CalendarDays, Pencil, Pin, PinOff } from 'lucide-react';
import { instantDateTimeBR } from '@/lib/tz';
import { addNoteAction, editNote, setNoteFlags } from '../profile-actions';

interface Note {
  id: string;
  content: string;
  pinned: boolean;
  showInAgenda: boolean;
  createdAt: Date | string;
  userId: string;
  user: { name: string };
}

/**
 * Observações da equipe: fixar no topo, "aparece na agenda" (mostra na janela
 * do agendamento) e editar a própria.
 */
export function ProfileNotes({ patientId, notes, meId, canEditAll }: { patientId: string; notes: Note[]; meId: string; canEditAll: boolean }) {
  const [texto, setTexto] = useState('');
  const [fixar, setFixar] = useState(false);
  const [naAgenda, setNaAgenda] = useState(false);
  const [editando, setEditando] = useState<{ id: string; content: string } | null>(null);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, after?: () => void) =>
    start(async () => {
      setErro('');
      const r = await fn();
      if (!r.ok) setErro(r.message);
      else after?.();
    });

  return (
    <section aria-labelledby="obs-titulo" className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 id="obs-titulo" className="text-sm font-semibold">
        Observações da equipe
      </h2>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addNoteAction(patientId, texto, { pinned: fixar, showInAgenda: naAgenda }), () => {
            setTexto('');
            setFixar(false);
            setNaAgenda(false);
          });
        }}
      >
        <label htmlFor="nova-obs" className="sr-only">
          Nova observação
        </label>
        <textarea
          id="nova-obs"
          rows={3}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: prefere horários de manhã, vem acompanhada da filha…"
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fixar} onChange={(e) => setFixar(e.target.checked)} className="h-4 w-4 accent-primary" /> Fixar no topo
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={naAgenda} onChange={(e) => setNaAgenda(e.target.checked)} className="h-4 w-4 accent-primary" /> Aparece na agenda
          </label>
          <button type="submit" disabled={pending || !texto.trim()} className="btn-primary btn-sm ml-auto">
            Salvar observação
          </button>
        </div>
      </form>
      {erro && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erro}
        </p>
      )}
      {notes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma observação ainda.</p>
      ) : (
        <ol className="mt-4 space-y-3" aria-label="Observações">
          {notes.map((n) => {
            const minha = n.userId === meId || canEditAll;
            return (
              <li key={n.id} className={`rounded-xl p-3 ${n.pinned ? 'border border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30' : 'bg-surface-alt/60'}`}>
                {editando?.id === n.id ? (
                  <div className="space-y-2">
                    <label htmlFor={`obs-${n.id}`} className="sr-only">
                      Editar observação
                    </label>
                    <textarea
                      id={`obs-${n.id}`}
                      rows={3}
                      value={editando.content}
                      onChange={(e) => setEditando({ ...editando, content: e.target.value })}
                      className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditando(null)} className="btn-ghost btn-sm">
                        Cancelar
                      </button>
                      <button type="button" disabled={pending} onClick={() => run(() => editNote(n.id, editando.content), () => setEditando(null))} className="btn-primary btn-sm">
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm">{n.content}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {n.user.name} · {instantDateTimeBR(n.createdAt)}
                      </span>
                      {n.showInAgenda && (
                        <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                          <CalendarDays className="h-3 w-3" aria-hidden="true" /> na agenda
                        </span>
                      )}
                      <span className="ml-auto flex gap-1">
                        <button
                          type="button"
                          onClick={() => run(() => setNoteFlags(n.id, { pinned: !n.pinned }))}
                          className="btn-ghost btn-sm"
                          aria-label={n.pinned ? 'Desafixar' : 'Fixar no topo'}
                          title={n.pinned ? 'Desafixar' : 'Fixar no topo'}
                        >
                          {n.pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Pin className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => run(() => setNoteFlags(n.id, { showInAgenda: !n.showInAgenda }))}
                          className="btn-ghost btn-sm"
                          aria-label={n.showInAgenda ? 'Tirar da agenda' : 'Mostrar na agenda'}
                          title={n.showInAgenda ? 'Tirar da agenda' : 'Mostrar na agenda'}
                        >
                          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        {minha && (
                          <button type="button" onClick={() => setEditando({ id: n.id, content: n.content })} className="btn-ghost btn-sm" aria-label="Editar observação">
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
