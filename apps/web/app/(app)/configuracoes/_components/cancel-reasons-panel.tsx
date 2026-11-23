'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { listCancelReasonsConfig, removeCancelReason, saveCancelReason, setCancelReasonRequired } from '../agenda-config-actions';

type Data = NonNullable<Awaited<ReturnType<typeof listCancelReasonsConfig>>>;

/** Configurações › Agenda › Motivos de cancelamento, com a regra "motivo obrigatório". */
export function CancelReasonsPanel() {
  const id = useId();
  const [data, setData] = useState<Data | null>(null);
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<{ id: string; name: string } | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [pending, start] = useTransition();
  const carregar = useCallback(async () => setData(await listCancelReasonsConfig()), []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, ok: string, depois?: () => void) =>
    start(async () => {
      setErro('');
      setAviso('');
      const r = await fn();
      if (!r.ok) return setErro(r.message);
      setAviso(ok);
      depois?.();
      await carregar();
    });

  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return (
    <section aria-labelledby={`${id}-t`} className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <h2 id={`${id}-t`} className="text-base font-semibold">
        Motivos de cancelamento
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Ao cancelar, a recepção diz quem cancelou (paciente ou clínica) e escolhe o motivo. &ldquo;Outro&rdquo; pede para escrever.</p>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={data.required} disabled={pending} onChange={(e) => run(() => setCancelReasonRequired(e.target.checked), 'Regra salva.')} className="h-4 w-4 accent-primary" />
        Motivo obrigatório ao cancelar
      </label>
      <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
        {data.reasons.map((r) => (
          <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            {editando?.id === r.id ? (
              <>
                <label className="sr-only" htmlFor={`${id}-${r.id}`}>
                  Nome do motivo
                </label>
                <input id={`${id}-${r.id}`} value={editando.name} onChange={(e) => setEditando({ ...editando, name: e.target.value })} className="h-8 flex-1 rounded-md border border-border bg-background px-2" />
                <button type="button" disabled={pending} onClick={() => run(() => saveCancelReason(editando), 'Motivo salvo.', () => setEditando(null))} className="btn-primary btn-sm">
                  Salvar
                </button>
                <button type="button" onClick={() => setEditando(null)} className="btn-ghost btn-sm">
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <span className="flex-1">{r.name}</span>
                {r.uses > 0 && <span className="text-xs text-muted-foreground">{r.uses} usos</span>}
                <button type="button" onClick={() => setEditando({ id: r.id, name: r.name })} className="btn-ghost btn-sm" aria-label={`Renomear ${r.name}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Tirar "${r.name}" da lista? Os cancelamentos que já usaram continuam com ele.`)) run(() => removeCancelReason(r.id), 'Motivo removido.');
                  }}
                  className="btn-ghost btn-sm"
                  aria-label={`Tirar ${r.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveCancelReason({ name: novo }), 'Motivo criado.', () => setNovo(''));
        }}
      >
        <label className="sr-only" htmlFor={`${id}-novo`}>
          Novo motivo
        </label>
        <input id={`${id}-novo`} value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Novo motivo" className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm" />
        <button type="submit" disabled={pending || !novo.trim()} className="btn-primary btn-md">
          <Plus className="h-4 w-4" aria-hidden="true" /> Criar
        </button>
      </form>
      {erro && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
          {aviso}
        </p>
      )}
    </section>
  );
}
