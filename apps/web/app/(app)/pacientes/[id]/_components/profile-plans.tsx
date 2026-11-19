'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { FilePlus2, Plus, Smile } from 'lucide-react';
import { instantDateBR } from '@/lib/tz';
import { addPlanItem, createBlankPlan, createPlanFromOdontogram, setPlanStatus, togglePlanItem } from '../profile-actions';

interface Plan {
  id: string;
  number: number;
  name: string;
  status: string;
  createdAt: Date | string;
  closedAt: Date | string | null;
  quoteId: string | null;
  items: { id: string; description: string; priceCents: number; quantity: number; doneAt: Date | string | null }[];
}

const STATUS: Record<string, { label: string; cls: string }> = {
  IN_PROGRESS: { label: 'Em andamento', cls: 'bg-primary/10 text-primary' },
  DONE: { label: 'Concluído', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  CANCELLED: { label: 'Cancelado', cls: 'bg-surface-alt text-muted-foreground' },
};

const brl = (c: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100);

/**
 * Planos de tratamento com registro próprio: do odontograma (o que está "a
 * fazer") ou avulsos; marcar o que foi feito mostra o progresso; "Gerar
 * orçamento" leva os itens do odontograma para um orçamento novo.
 */
export function ProfilePlans({ patientId, plans, canFinance }: { patientId: string; plans: Plan[]; canFinance: boolean }) {
  const [erro, setErro] = useState('');
  const [novo, setNovo] = useState<{ planId: string; description: string; price: string } | null>(null);
  const [nome, setNome] = useState('');
  // Marca na hora; se o servidor recusar, volta como estava.
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const feito = (i: { id: string; doneAt: Date | string | null }) => marcados[i.id] ?? Boolean(i.doneAt);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, ok?: () => void) =>
    start(async () => {
      setErro('');
      const r = await fn();
      if (!r.ok) setErro(r.message);
      else ok?.();
    });

  return (
    <section aria-labelledby="planos-titulo" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="planos-titulo" className="mr-auto text-sm font-semibold">
          Planos de tratamento
        </h2>
        <button type="button" disabled={pending} onClick={() => run(() => createPlanFromOdontogram(patientId))} className="btn-primary btn-sm">
          <Smile className="h-3.5 w-3.5" aria-hidden="true" /> Novo plano do odontograma
        </button>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createBlankPlan(patientId, nome), () => setNome(''));
          }}
        >
          <label htmlFor="plano-nome" className="sr-only">
            Nome do plano avulso
          </label>
          <input id="plano-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Plano avulso (nome)" className="h-8 rounded-lg border border-border bg-background px-2 text-sm" />
          <button type="submit" disabled={pending} className="btn-outline btn-sm">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Criar
          </button>
        </form>
      </div>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      {plans.length === 0 && <p className="rounded-2xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">Nenhum plano ainda.</p>}
      {plans.map((p) => {
        const feitos = p.items.filter((i) => feito(i)).length;
        const total = p.items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
        const pct = p.items.length ? Math.round((feitos / p.items.length) * 100) : 0;
        const aberto = p.status === 'IN_PROGRESS';
        const st = STATUS[p.status] ?? STATUS.IN_PROGRESS;
        return (
          <article key={p.id} className="rounded-2xl border border-border bg-surface p-4 shadow-card" aria-labelledby={`plano-${p.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`plano-${p.id}`} className="font-semibold">
                Nº {p.number} · {p.name}
              </h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
              <span className="text-xs text-muted-foreground">
                criado em {instantDateBR(p.createdAt)}
                {p.closedAt && ` · fechado em ${instantDateBR(p.closedAt)}`}
              </span>
              <span className="ml-auto text-sm font-medium tabular-nums">{brl(total)}</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-alt" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Progresso do plano ${p.number}`}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {feitos} de {p.items.length} feitos
              </span>
            </div>
            <ul className="mt-3 divide-y divide-border">
              {p.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={feito(i)}
                    disabled={!aberto}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setMarcados((m) => ({ ...m, [i.id]: v }));
                      start(async () => {
                        setErro('');
                        const r = await togglePlanItem(i.id, v);
                        if (!r.ok) {
                          setErro(r.message);
                          setMarcados((m) => ({ ...m, [i.id]: !v }));
                        }
                      });
                    }}
                    aria-label={`Feito: ${i.description}`}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className={`flex-1 ${feito(i) ? 'text-muted-foreground line-through' : ''}`}>
                    {i.quantity > 1 && `${i.quantity}× `}
                    {i.description}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{brl(i.priceCents * i.quantity)}</span>
                </li>
              ))}
            </ul>
            {aberto && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {novo?.planId === p.id ? (
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => addPlanItem(p.id, { description: novo.description, priceCents: Math.round(Number(novo.price.replace(/\./g, '').replace(',', '.')) * 100) || 0 }), () => setNovo(null));
                    }}
                  >
                    <label className="sr-only" htmlFor={`item-${p.id}`}>
                      Descrição do item
                    </label>
                    <input id={`item-${p.id}`} value={novo.description} onChange={(e) => setNovo({ ...novo, description: e.target.value })} placeholder="Descrição" className="h-8 rounded-lg border border-border bg-background px-2 text-sm" />
                    <label className="sr-only" htmlFor={`preco-${p.id}`}>
                      Valor
                    </label>
                    <input id={`preco-${p.id}`} value={novo.price} onChange={(e) => setNovo({ ...novo, price: e.target.value })} placeholder="Valor (R$)" inputMode="decimal" className="h-8 w-28 rounded-lg border border-border bg-background px-2 text-sm" />
                    <button type="submit" className="btn-primary btn-sm">
                      Adicionar
                    </button>
                    <button type="button" onClick={() => setNovo(null)} className="btn-ghost btn-sm">
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <button type="button" onClick={() => setNovo({ planId: p.id, description: '', price: '' })} className="btn-outline btn-sm">
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Item avulso
                  </button>
                )}
                {canFinance && (
                  <Link href={`/orcamentos/novo?patientId=${patientId}&plano=1`} className="btn-outline btn-sm">
                    <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Gerar orçamento
                  </Link>
                )}
                <button type="button" disabled={pending} onClick={() => run(() => setPlanStatus(p.id, 'DONE'))} className="btn-ghost btn-sm">
                  Concluir
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Cancelar o plano nº ${p.number}?`)) run(() => setPlanStatus(p.id, 'CANCELLED'));
                  }}
                  className="btn-ghost btn-sm text-destructive"
                >
                  Cancelar plano
                </button>
              </div>
            )}
            {!aberto && (
              <button type="button" disabled={pending} onClick={() => run(() => setPlanStatus(p.id, 'IN_PROGRESS'))} className="btn-ghost btn-sm mt-2">
                Reabrir
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}
