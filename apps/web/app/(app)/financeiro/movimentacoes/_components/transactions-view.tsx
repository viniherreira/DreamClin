'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { FileDown, Pencil, Undo2 } from 'lucide-react';
import { ReverseDialog } from '@/components/fin/reverse-dialog';
import { Badge, ErrorText, Field, inputCls, Modal } from '@/components/fin/ui';
import { dayBR } from '@/lib/financeiro/dates';
import { ORIGIN_LABEL } from '@/lib/financeiro/defaults';
import { formatCents } from '@/lib/financeiro/money';
import { listTransactions, updateTransactionAction, type TxFilters, type TxList, type TxRow } from '../../fin-actions';
import type { FinOptions } from '../../contas/_components/types';

import { DateField } from '@/components/ui/date-field';
const TIPO: Record<string, string> = {
  RECEIPT: 'Recebimento',
  PAYMENT: 'Pagamento',
  REINFORCEMENT: 'Reforço de caixa',
  WITHDRAWAL: 'Sangria',
  TRANSFER_IN: 'Transferência (entrada)',
  TRANSFER_OUT: 'Transferência (saída)',
  REVERSAL: 'Estorno',
  FEE: 'Taxa',
};

/**
 * O extrato de tudo o que entrou e saiu de verdade. A mesma tela, só com os
 * estornos, é a tela de Estornos.
 */
export function TransactionsView({ options, range, canReverse, onlyReversals = false }: { options: FinOptions; range: { from: string; to: string }; canReverse: boolean; onlyReversals?: boolean }) {
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [dateField, setDateField] = useState<'paidOn' | 'competence'>('paidOn');
  const [direction, setDirection] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [accountId, setAccountId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [origin, setOrigin] = useState('');
  const [party, setParty] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TxList | null>(null);
  const [estornar, setEstornar] = useState<string | null>(null);
  const [editar, setEditar] = useState<TxRow | null>(null);
  const [, start] = useTransition();
  const pedido = useRef(0);

  const filtros: TxFilters = useMemo(
    () => ({ from, to, dateField, direction, page, onlyReversals, ...(accountId ? { accountId } : {}), ...(methodId ? { methodId } : {}), ...(origin ? { origin } : {}), ...(party.trim() ? { party: party.trim() } : {}) }),
    [from, to, dateField, direction, page, onlyReversals, accountId, methodId, origin, party],
  );
  const carregar = useCallback(() => {
    const n = ++pedido.current;
    start(async () => {
      const r = await listTransactions(filtros);
      if (n === pedido.current) setData(r);
    });
  }, [filtros]);
  useEffect(() => {
    const t = setTimeout(carregar, party ? 250 : 0);
    return () => clearTimeout(t);
  }, [carregar, party]);

  const muda = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const rows = data?.rows ?? [];

  return (
    <div>
      <div className="rounded-xl border border-border bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Data por" className="w-36">
            {(id) => (
              <select id={id} value={dateField} onChange={(e) => muda(setDateField)(e.target.value as typeof dateField)} className={inputCls}>
                <option value="paidOn">Pagamento</option>
                <option value="competence">Competência</option>
              </select>
            )}
          </Field>
          <Field label="De" className="w-40">{(id) => <DateField id={id} value={from} onChange={(v) => muda(setFrom)(v)} className={inputCls} />}</Field>
          <Field label="Até" className="w-40">{(id) => <DateField id={id} value={to} onChange={(v) => muda(setTo)(v)} className={inputCls} />}</Field>
          {!onlyReversals && (
            <Field label="Tipo" className="w-36">
              {(id) => (
                <select id={id} value={direction} onChange={(e) => muda(setDirection)(e.target.value as typeof direction)} className={inputCls}>
                  <option value="ALL">Tudo</option>
                  <option value="IN">Entradas</option>
                  <option value="OUT">Saídas</option>
                </select>
              )}
            </Field>
          )}
          <Field label="Conta" className="w-44">
            {(id) => (
              <select id={id} value={accountId} onChange={(e) => muda(setAccountId)(e.target.value)} className={inputCls}>
                <option value="">Todas</option>
                {options.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Forma" className="w-44">
            {(id) => (
              <select id={id} value={methodId} onChange={(e) => muda(setMethodId)(e.target.value)} className={inputCls}>
                <option value="">Todas</option>
                {options.methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Origem" className="w-44">
            {(id) => (
              <select id={id} value={origin} onChange={(e) => muda(setOrigin)(e.target.value)} className={inputCls}>
                <option value="">Todas</option>
                {Object.entries(ORIGIN_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Cliente ou fornecedor" className="min-w-[12rem] flex-1">{(id) => <input id={id} maxLength={80} value={party} onChange={(e) => muda(setParty)(e.target.value)} className={inputCls} />}</Field>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[820px] text-sm">
          <caption className="sr-only">{onlyReversals ? 'Estornos' : 'Movimentações'}</caption>
          <thead className="whitespace-nowrap border-b border-border bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5">Nº</th>
              <th scope="col" className="px-3 py-2.5">Data</th>
              <th scope="col" className="px-3 py-2.5">{onlyReversals ? 'Motivo' : 'Lançamento'}</th>
              <th scope="col" className="px-3 py-2.5">Categoria</th>
              <th scope="col" className="px-3 py-2.5">Conta e forma</th>
              <th scope="col" className="px-3 py-2.5 text-right">Valor</th>
              <th scope="col" className="px-3 py-2.5 text-right">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data === null ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  {onlyReversals ? 'Nenhum estorno neste período.' : 'Nenhuma movimentação neste período com estes filtros.'}
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} className={`hover:bg-surface-alt/40 ${m.reversed ? 'text-muted-foreground' : ''}`}>
                  <td className="px-3 py-2 font-mono text-xs">{m.code}</td>
                  <td className="whitespace-nowrap px-3 py-2">{dayBR(m.paidOn)}</td>
                  <td className="max-w-[20rem] px-3 py-2">
                    <p className="truncate font-medium">
                      {onlyReversals ? (m.description ?? '').replace(/^Estorno:\s*/, '') || 'Sem motivo' : m.party || m.description || TIPO[m.kind]}{' '}
                      {m.reversed && <Badge>Estornado</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {onlyReversals ? `${m.party || ORIGIN_LABEL[m.origin as keyof typeof ORIGIN_LABEL]} · por ${m.createdBy || 'sistema'}` : `${TIPO[m.kind]}${m.titleCode ? ` · conta nº ${m.titleCode}` : ''}${m.party && m.description ? ` · ${m.description}` : ''}`}
                    </p>
                  </td>
                  <td className="px-3 py-2">{m.category}</td>
                  <td className="px-3 py-2">
                    <p className="truncate">{m.account}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.method}</p>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${m.reversed ? 'line-through' : m.signedCents < 0 ? 'text-destructive' : m.signedCents > 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                    {formatCents(m.signedCents === 0 ? m.amountCents : m.signedCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {m.kind === 'RECEIPT' && !m.reversed && m.receiptGroupId && m.titleId && (
                      <a href={`/financeiro/recibo/${m.receiptGroupId}`} target="_blank" rel="noopener" aria-label={`Recibo do movimento ${m.code}`} className="inline-flex rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                        <FileDown className="h-4 w-4" aria-hidden="true" />
                      </a>
                    )}
                    {canReverse && m.kind !== 'REVERSAL' && !m.reversed && (
                      <>
                        <button type="button" onClick={() => setEditar(m)} aria-label={`Editar o movimento ${m.code}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {m.kind !== 'TRANSFER_IN' && m.kind !== 'TRANSFER_OUT' && (
                          <button type="button" onClick={() => setEstornar(m.id)} aria-label={`Estornar o movimento ${m.code}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring">
                            <Undo2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        {!onlyReversals && data && data.byAccount.length > 0 ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {data.byAccount.map((c) => (
              <div key={c.account}>
                <dt className="inline font-medium">{c.account}: </dt>
                <dd className="inline tabular-nums">
                  <span className="text-emerald-700 dark:text-emerald-400">+{formatCents(c.inCents)}</span> <span className="text-destructive">−{formatCents(c.outCents)}</span> = <strong>{formatCents(c.inCents - c.outCents)}</strong>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <span />
        )}
        {data && data.pages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-outline btn-sm">
              Anterior
            </button>
            <span>
              Página {page} de {data.pages}
            </span>
            <button type="button" disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="btn-outline btn-sm">
              Próxima
            </button>
          </div>
        )}
      </div>

      <ReverseDialog transactionId={estornar} open={Boolean(estornar)} onOpenChange={(o) => !o && setEstornar(null)} onDone={carregar} />
      <EditDialog row={editar} options={options} onOpenChange={(o) => !o && setEditar(null)} onDone={carregar} />
    </div>
  );
}

function EditDialog({ row, options, onOpenChange, onDone }: { row: TxRow | null; options: FinOptions; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [paidOn, setPaidOn] = useState('');
  const [competence, setCompetence] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!row) return;
    setPaidOn(row.paidOn);
    setCompetence(row.competence);
    setDocumentNumber(row.documentNumber ?? '');
    setDescription(row.description ?? '');
    setCategoryId(options.categories.find((c) => c.name === row.category && c.parentId)?.id ?? '');
    setErro('');
  }, [row, options.categories]);

  const salvar = () =>
    start(async () => {
      if (!row) return;
      const r = await updateTransactionAction({ id: row.id, paidOn, competence, documentNumber: documentNumber || null, description: description || null, ...(categoryId ? { categoryId } : {}) });
      if (!r.ok) return setErro(r.message);
      onDone();
      onOpenChange(false);
    });

  return (
    <Modal open={Boolean(row)} onOpenChange={onOpenChange} title={row ? `Movimento nº ${row.code}` : 'Movimento'} description="O valor não muda aqui. Para corrigir um valor, estorne e lance de novo.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Data do pagamento">{(id) => <DateField id={id} value={paidOn} onChange={(v) => setPaidOn(v)} className={inputCls} />}</Field>
          <Field label="Mês de competência">{(id) => <input id={id} type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} className={inputCls} />}</Field>
          <Field label="Categoria">
            {(id) => (
              <select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
                <option value="">Manter a atual</option>
                {options.categories
                  .filter((c) => c.parentId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field label="Nº do documento">{(id) => <input id={id} maxLength={60} value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} className={inputCls} />}</Field>
          <Field label="Descrição" className="sm:col-span-2">
            {(id) => <input id={id} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />}
          </Field>
        </div>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="btn-primary btn-md">
            {pending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
