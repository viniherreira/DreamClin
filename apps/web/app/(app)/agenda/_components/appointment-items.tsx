'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { MoneyInput } from '@/components/fin/ui';
import { itemTotal } from '@/lib/financeiro/billing';
import { formatCents } from '@/lib/financeiro/money';
import { appointmentItemsForEdit, patientQuoteItems } from '../finance-actions';

/**
 * Procedimentos e valores do agendamento (financeiro completo): vários
 * procedimentos, quantidade, preço e desconto, e "Trazer do orçamento" para o
 * que já foi aprovado (não cobra de novo). No tipo convênio, escolhe o convênio.
 */

export interface ItemRow {
  key: number;
  procedureId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  quoteItemId: string | null;
  quoteLabel: string | null;
}

export interface ItemsFinance {
  showPrices: boolean;
  insurers: { id: string; name: string }[];
}

interface Procedure {
  id: string;
  name: string;
  durationMinutes: number;
  basePrice: number;
}

type QuoteOption = Awaited<ReturnType<typeof patientQuoteItems>>[number];

let seq = 1;

export function AppointmentItems({
  finance,
  procedures,
  patientId,
  appointmentId,
  type,
  insurerId,
  onInsurerChange,
  onChange,
  onFirstProcedure,
}: {
  finance: ItemsFinance;
  procedures: Procedure[];
  patientId: string | null;
  appointmentId: string | null;
  type: string;
  insurerId: string;
  onInsurerChange: (id: string) => void;
  /** `null` enquanto os itens de um agendamento existente carregam (nada é enviado). */
  onChange: (items: ItemRow[] | null) => void;
  /** O primeiro procedimento escolhido: a janela usa a duração dele. */
  onFirstProcedure: (procedureId: string | null) => void;
}) {
  const id = useId();
  const [items, setItems] = useState<ItemRow[] | null>(appointmentId ? null : []);
  const [escolha, setEscolha] = useState('');
  const [orcamento, setOrcamento] = useState<QuoteOption[] | null>(null);
  const [carregando, start] = useTransition();

  // Editar: os itens que já existem (ou o procedimento, em agendamento antigo).
  useEffect(() => {
    if (!appointmentId) return;
    let vivo = true;
    void appointmentItemsForEdit(appointmentId).then((r) => {
      if (!vivo) return;
      setItems((r?.items ?? []).map((i) => ({ ...i, key: seq++ })));
      if (r?.insuranceContactId) onInsurerChange(r.insuranceContactId);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  useEffect(() => {
    onChange(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const muda = (key: number, parte: Partial<ItemRow>) => setItems((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, ...parte } : l)));
  const tira = (key: number) => {
    const resto = (items ?? []).filter((l) => l.key !== key);
    setItems(resto);
    onFirstProcedure(resto.find((l) => l.procedureId)?.procedureId ?? null);
  };

  const adiciona = (procedureId: string) => {
    const p = procedures.find((x) => x.id === procedureId);
    if (!p) return;
    const atual = items ?? [];
    if (!atual.some((l) => l.procedureId)) onFirstProcedure(p.id);
    setItems([...atual, { key: seq++, procedureId: p.id, name: p.name, quantity: 1, unitPriceCents: Math.round(p.basePrice * 100), discountCents: 0, quoteItemId: null, quoteLabel: null }]);
    setEscolha('');
  };

  const abreOrcamento = () =>
    start(async () => {
      if (!patientId) return;
      setOrcamento(await patientQuoteItems(patientId, appointmentId));
    });

  const trazer = (q: QuoteOption) => {
    const atual = items ?? [];
    if (!atual.some((l) => l.procedureId) && q.procedureId) onFirstProcedure(q.procedureId);
    setItems([...atual, { key: seq++, procedureId: q.procedureId, name: q.name, quantity: 1, unitPriceCents: q.unitPriceCents, discountCents: 0, quoteItemId: q.quoteItemId, quoteLabel: q.quoteLabel }]);
  };

  const lista = items ?? [];
  const cobrado = type === 'CORTESIA' ? 0 : lista.reduce((s, i) => s + (i.quoteItemId ? 0 : itemTotal({ quantity: i.quantity, unitPrice: i.unitPriceCents, discount: i.discountCents })), 0);
  const usadoDoOrcamento = (qid: string) => lista.filter((l) => l.quoteItemId === qid).reduce((s, l) => s + l.quantity, 0);
  const campo = 'h-9 rounded-lg border border-border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Procedimentos{finance.showPrices ? ' e valores' : ''}</legend>

      {items === null ? (
        <p className="text-sm text-muted-foreground">Carregando os procedimentos…</p>
      ) : (
        <>
          {lista.length > 0 && (
            <ul className="space-y-2" aria-label="Procedimentos do agendamento">
              {lista.map((l, i) => (
                <li key={l.key} className="rounded-lg border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</p>
                    {l.quoteItemId && (
                      <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                        Coberto pelo orçamento {l.quoteLabel}
                      </span>
                    )}
                    <button type="button" onClick={() => tira(l.key)} aria-label={`Tirar ${l.name}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div>
                      <label htmlFor={`${id}-q${i}`} className="block text-[11px] text-muted-foreground">
                        Quantidade
                      </label>
                      <input id={`${id}-q${i}`} type="number" min={1} max={99} value={l.quantity} onChange={(e) => muda(l.key, { quantity: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })} className={`${campo} w-20`} />
                    </div>
                    {finance.showPrices && !l.quoteItemId && (
                      <>
                        <div>
                          <span className="block text-[11px] text-muted-foreground" aria-hidden="true">
                            Valor unitário
                          </span>
                          <MoneyInput ariaLabel={`Valor unitário de ${l.name}`} value={l.unitPriceCents} onChange={(c) => muda(l.key, { unitPriceCents: c })} className="w-32" />
                        </div>
                        <div>
                          <span className="block text-[11px] text-muted-foreground" aria-hidden="true">
                            Desconto
                          </span>
                          <MoneyInput ariaLabel={`Desconto em ${l.name}`} value={l.discountCents} onChange={(c) => muda(l.key, { discountCents: c })} className="w-28" />
                        </div>
                        <p className="ml-auto pb-2 text-sm font-semibold tabular-nums">{formatCents(itemTotal({ quantity: l.quantity, unitPrice: l.unitPriceCents, discount: l.discountCents }))}</p>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-add`} className="sr-only">
              Adicionar procedimento
            </label>
            <select id={`${id}-add`} value={escolha} onChange={(e) => adiciona(e.target.value)} className={`${campo} min-w-0 flex-1`}>
              <option value="">{lista.length ? 'Adicionar outro procedimento…' : 'Adicionar procedimento…'}</option>
              {procedures.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.durationMinutes} min{finance.showPrices ? ` · ${formatCents(Math.round(p.basePrice * 100))}` : ''})
                </option>
              ))}
            </select>
            <button type="button" onClick={abreOrcamento} disabled={!patientId || carregando} className="btn-outline btn-sm inline-flex items-center gap-1.5" title={patientId ? undefined : 'Escolha o paciente primeiro'}>
              <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Trazer do orçamento
            </button>
          </div>

          {orcamento && (
            <div className="rounded-lg border border-border bg-surface-alt/40 p-2.5">
              {orcamento.length === 0 ? (
                <p className="text-sm text-muted-foreground">Este paciente não tem orçamento aprovado com procedimento por fazer.</p>
              ) : (
                <ul className="space-y-1.5" aria-label="Itens dos orçamentos aprovados">
                  {orcamento.map((q) => {
                    const sobra = q.remaining - usadoDoOrcamento(q.quoteItemId);
                    return (
                      <li key={q.quoteItemId} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          {q.name} <span className="text-muted-foreground">· {q.quoteLabel} · falta fazer {sobra}</span>
                        </span>
                        <button type="button" disabled={sobra <= 0} onClick={() => trazer(q)} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Trazer ${q.name} do ${q.quoteLabel}`}>
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Trazer
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {type === 'CONVENIO' && (
            <div>
              <label htmlFor={`${id}-conv`} className="block text-xs font-medium text-foreground">
                Convênio que paga
              </label>
              <select id={`${id}-conv`} value={insurerId} onChange={(e) => onInsurerChange(e.target.value)} className={`${campo} mt-1 w-full`}>
                <option value="">{finance.insurers.length ? 'Escolha o convênio…' : 'Nenhum convênio cadastrado'}</option>
                {finance.insurers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {finance.insurers.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Cadastre o convênio em Configurações › Financeiro › Clientes e fornecedores, com o tipo convênio.</p>}
            </div>
          )}

          {finance.showPrices && lista.length > 0 && (
            <p className="flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2 text-sm">
              <span>{type === 'CORTESIA' ? 'Cortesia: não gera cobrança' : type === 'CONVENIO' ? 'Valor para o convênio' : 'Valor para o paciente'}</span>
              <strong className="tabular-nums">{formatCents(cobrado)}</strong>
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
