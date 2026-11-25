'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Check, Download, Eye, EyeOff, Filter, Plus, Repeat, X } from 'lucide-react';
import { SettleDialog } from '@/components/fin/settle-dialog';
import { ErrorText, Field, inputCls, Modal, MoneyInput } from '@/components/fin/ui';
import { dayBR } from '@/lib/financeiro/dates';
import { ORIGIN_LABEL } from '@/lib/financeiro/defaults';
import { formatCents } from '@/lib/financeiro/money';
import { TITLE_STATUS_LABEL } from '@/lib/financeiro/title-status';
import { exportTitles, listTitles, settleBatchAction, type TitleFilters, type TitleList, type TitleRow } from '../../fin-actions';
import { NewTitleDialog } from './new-title-dialog';
import { originHref, StatusBadge, TitleDetailDialog } from './title-detail-dialog';
import type { FinOptions } from './types';

import { DateField } from '@/components/ui/date-field';
type Tab = 'RECEIVABLE' | 'PAYABLE' | 'ALL';
type View = 'open' | 'overdue' | 'paid' | 'all';

interface Extra {
  party: string;
  categoryId: string;
  accountId: string;
  methodId: string;
  origin: string;
  description: string;
  document: string;
  minCents: number;
  maxCents: number;
}

const SEM_EXTRA: Extra = { party: '', categoryId: '', accountId: '', methodId: '', origin: '', description: '', document: '', minCents: 0, maxCents: 0 };

const TABS: { id: Tab; label: string }[] = [
  { id: 'RECEIVABLE', label: 'A receber' },
  { id: 'PAYABLE', label: 'A pagar' },
  { id: 'ALL', label: 'Todas' },
];

export function TitlesView({
  options,
  today,
  range,
  advanced,
  access,
  initialTab,
}: {
  options: FinOptions;
  today: string;
  range: { from: string; to: string };
  advanced: boolean;
  access: { receive: boolean; pay: boolean; reverse: boolean };
  initialTab: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [view, setView] = useState<View>('open');
  const [dateField, setDateField] = useState<'dueDate' | 'issueDate' | 'competence'>('dueDate');
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [extra, setExtra] = useState<Extra>(SEM_EXTRA);
  const [rascunho, setRascunho] = useState<Extra>(SEM_EXTRA);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TitleList | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [mostrarValores, setMostrarValores] = useState(false);
  const [receber, setReceber] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [lote, setLote] = useState(false);
  const [aviso, setAviso] = useState('');
  const [pending, start] = useTransition();
  const pedido = useRef(0);

  const filtros: TitleFilters = useMemo(
    () => ({
      tab,
      view,
      dateField,
      from,
      to,
      page,
      ...(extra.party ? { party: extra.party } : {}),
      ...(extra.categoryId ? { categoryId: extra.categoryId } : {}),
      ...(extra.accountId ? { accountId: extra.accountId } : {}),
      ...(extra.methodId ? { methodId: extra.methodId } : {}),
      ...(extra.origin ? { origin: extra.origin } : {}),
      ...(extra.description ? { description: extra.description } : {}),
      ...(extra.document ? { document: extra.document } : {}),
      ...(extra.minCents ? { minCents: extra.minCents } : {}),
      ...(extra.maxCents ? { maxCents: extra.maxCents } : {}),
    }),
    [tab, view, dateField, from, to, page, extra],
  );

  const carregar = useCallback(() => {
    const n = ++pedido.current;
    start(async () => {
      const r = await listTitles(filtros);
      // Só a resposta do último pedido vale (filtros trocados rápido).
      if (n === pedido.current) setData(r);
    });
  }, [filtros]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const muda = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
    setMarcados(new Set());
  };

  const nomeDe = (lista: { id: string; name: string }[], id: string) => lista.find((x) => x.id === id)?.name ?? '';
  const chips: { key: keyof Extra; texto: string }[] = [
    ...(extra.party ? [{ key: 'party' as const, texto: `Nome: ${extra.party}` }] : []),
    ...(extra.categoryId ? [{ key: 'categoryId' as const, texto: `Categoria: ${nomeDe(options.categories, extra.categoryId)}` }] : []),
    ...(extra.accountId ? [{ key: 'accountId' as const, texto: `Conta: ${nomeDe(options.accounts, extra.accountId)}` }] : []),
    ...(extra.methodId ? [{ key: 'methodId' as const, texto: `Forma: ${nomeDe(options.methods, extra.methodId)}` }] : []),
    ...(extra.origin ? [{ key: 'origin' as const, texto: `Origem: ${ORIGIN_LABEL[extra.origin as keyof typeof ORIGIN_LABEL]}` }] : []),
    ...(extra.description ? [{ key: 'description' as const, texto: `Descrição: ${extra.description}` }] : []),
    ...(extra.document ? [{ key: 'document' as const, texto: `Documento: ${extra.document}` }] : []),
    ...(extra.minCents ? [{ key: 'minCents' as const, texto: `A partir de ${formatCents(extra.minCents)}` }] : []),
    ...(extra.maxCents ? [{ key: 'maxCents' as const, texto: `Até ${formatCents(extra.maxCents)}` }] : []),
  ];

  const rows = data?.rows ?? [];
  const abertas = rows.filter((r) => r.openCents > 0 && (r.status === 'OPEN' || r.status === 'PARTIAL') && (r.direction === 'RECEIVABLE' ? access.receive : access.pay));
  const todosMarcados = abertas.length > 0 && abertas.every((r) => marcados.has(r.id));
  const selecionadas = rows.filter((r) => marcados.has(r.id));

  const exportar = () =>
    start(async () => {
      const linhas = await exportTitles(filtros);
      const cab = ['Código', 'Tipo', 'Origem', 'Categoria', 'Cliente ou fornecedor', 'Descrição', 'Emissão', 'Vencimento', 'Competência', 'Valor', 'Pago', 'Em aberto', 'Situação'];
      const num = (c: number) => (c / 100).toFixed(2).replace('.', ',');
      const csv = [cab, ...linhas.map((r) => [r.code, r.direction === 'RECEIVABLE' ? 'A receber' : 'A pagar', ORIGIN_LABEL[r.origin as keyof typeof ORIGIN_LABEL], r.category, r.party, r.description ?? '', dayBR(r.issueDate), dayBR(r.dueDate), r.competence, num(r.amountCents), num(r.paidCents), num(r.openCents), TITLE_STATUS_LABEL[r.display]])]
        .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
        .join('\r\n');
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `contas-${from}-a-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });

  const podeLancar = access.receive || access.pay;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Tipo de conta" className="inline-flex rounded-lg bg-surface-alt p-1">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => muda(setTab)(t.id)} className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${tab === t.id ? 'bg-surface shadow-sm' : 'text-muted-foreground'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportar} disabled={pending} className="btn-outline btn-md inline-flex items-center gap-1.5">
            <Download className="h-4 w-4" aria-hidden="true" /> Exportar
          </button>
          {podeLancar && (
            <button type="button" onClick={() => setNovo(true)} className="btn-primary btn-md inline-flex items-center gap-1.5 whitespace-nowrap">
              <Plus className="h-4 w-4" aria-hidden="true" /> Novo lançamento
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Mostrar" className="w-40">
            {(id) => (
              <select id={id} value={view} onChange={(e) => muda(setView)(e.target.value as View)} className={inputCls}>
                <option value="open">Em aberto</option>
                <option value="overdue">Só vencidas</option>
                <option value="paid">Pagas</option>
                <option value="all">Todas</option>
              </select>
            )}
          </Field>
          <Field label="Data por" className="w-40">
            {(id) => (
              <select id={id} value={dateField} onChange={(e) => muda(setDateField)(e.target.value as typeof dateField)} className={inputCls}>
                <option value="dueDate">Vencimento</option>
                <option value="issueDate">Emissão</option>
                <option value="competence">Competência</option>
              </select>
            )}
          </Field>
          <Field label="De" className="w-40">{(id) => <DateField id={id} value={from} onChange={(v) => muda(setFrom)(v)} className={inputCls} />}</Field>
          <Field label="Até" className="w-40">{(id) => <DateField id={id} value={to} onChange={(v) => muda(setTo)(v)} className={inputCls} />}</Field>
          <button type="button" onClick={() => (setRascunho(extra), setFiltrosAbertos(true))} className="btn-outline btn-md inline-flex items-center gap-1.5">
            <Filter className="h-4 w-4" aria-hidden="true" /> Mais filtros
          </button>
        </div>
        {chips.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Filtros ligados">
            {chips.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => muda(setExtra)({ ...extra, [c.key]: SEM_EXTRA[c.key] })}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={`Tirar o filtro ${c.texto}`}
                >
                  {c.texto} <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => muda(setExtra)(SEM_EXTRA)} className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                Limpar
              </button>
            </li>
          </ul>
        )}
      </div>

      {selecionadas.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <p>
            {selecionadas.length} conta(s) marcada(s) · {formatCents(selecionadas.reduce((s, r) => s + r.openCents, 0))}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMarcados(new Set())} className="btn-ghost btn-sm">
              Desmarcar
            </button>
            <button type="button" onClick={() => setLote(true)} className="btn-primary btn-sm">
              Baixar selecionadas
            </button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" className={aviso ? 'mt-3 rounded-lg bg-surface-alt px-3 py-2 text-sm' : 'sr-only'}>
        {aviso}
      </p>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Contas a receber e a pagar</caption>
          <thead className="whitespace-nowrap border-b border-border bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Marcar todas as contas em aberto desta página"
                  className="h-4 w-4"
                  checked={todosMarcados}
                  disabled={abertas.length === 0}
                  onChange={(e) => setMarcados(e.target.checked ? new Set(abertas.map((r) => r.id)) : new Set())}
                />
              </th>
              <th scope="col" className="px-3 py-2.5">Nº</th>
              <th scope="col" className="px-3 py-2.5">Cliente ou fornecedor</th>
              <th scope="col" className="px-3 py-2.5">Categoria</th>
              <th scope="col" className="px-3 py-2.5">Vencimento</th>
              <th scope="col" className="px-3 py-2.5 text-right">Em aberto</th>
              <th scope="col" className="px-3 py-2.5">Situação</th>
              <th scope="col" className="px-3 py-2.5 text-right">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data === null ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  Nenhuma conta neste período com estes filtros.
                  {podeLancar && (
                    <>
                      {' '}
                      <button type="button" onClick={() => setNovo(true)} className="font-medium text-primary underline-offset-2 hover:underline">
                        Lançar uma conta
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((r) => <Linha key={r.id} r={r} tab={tab} marcada={marcados.has(r.id)} podeBaixar={abertas.some((a) => a.id === r.id)} onMarca={(v) => setMarcados((m) => { const n = new Set(m); if (v) n.add(r.id); else n.delete(r.id); return n; })} onBaixar={() => setReceber(r.id)} onDetalhe={() => setDetalhe(r.id)} />)
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <button type="button" onClick={() => setMostrarValores((v) => !v)} aria-pressed={mostrarValores} className="btn-ghost btn-sm inline-flex items-center gap-1.5">
            {mostrarValores ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />} {mostrarValores ? 'Esconder valores' : 'Mostrar valores'}
          </button>
          {mostrarValores && data && (
            <>
              <span>
                A receber: <strong className="tabular-nums text-emerald-700 dark:text-emerald-400">{formatCents(data.totals.receivableCents)}</strong>
              </span>
              <span>
                A pagar: <strong className="tabular-nums text-destructive">{formatCents(data.totals.payableCents)}</strong>
              </span>
              <span>
                Saldo: <strong className="tabular-nums">{formatCents(data.totals.balanceCents)}</strong>
              </span>
            </>
          )}
        </div>
        {data && data.pages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-outline btn-sm">
              Anterior
            </button>
            <span>
              Página {page} de {data.pages} · {data.total} contas
            </span>
            <button type="button" disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="btn-outline btn-sm">
              Próxima
            </button>
          </div>
        )}
      </div>

      <Modal open={filtrosAbertos} onOpenChange={setFiltrosAbertos} title="Mais filtros">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            muda(setExtra)(rascunho);
            setFiltrosAbertos(false);
          }}
        >
          <Field label="Nome do cliente ou fornecedor">{(id) => <input id={id} maxLength={80} value={rascunho.party} onChange={(e) => setRascunho({ ...rascunho, party: e.target.value })} className={inputCls} />}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoria">
              {(id) => (
                <select id={id} value={rascunho.categoryId} onChange={(e) => setRascunho({ ...rascunho, categoryId: e.target.value })} className={inputCls}>
                  <option value="">Todas</option>
                  {options.categories
                    .filter((c) => tab === 'ALL' || c.direction === tab)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parentId ? `— ${c.name}` : c.name}
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field label="Origem">
              {(id) => (
                <select id={id} value={rascunho.origin} onChange={(e) => setRascunho({ ...rascunho, origin: e.target.value })} className={inputCls}>
                  <option value="">Todas</option>
                  {Object.entries(ORIGIN_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Conta">
              {(id) => (
                <select id={id} value={rascunho.accountId} onChange={(e) => setRascunho({ ...rascunho, accountId: e.target.value })} className={inputCls}>
                  <option value="">Todas</option>
                  {options.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Forma de pagamento">
              {(id) => (
                <select id={id} value={rascunho.methodId} onChange={(e) => setRascunho({ ...rascunho, methodId: e.target.value })} className={inputCls}>
                  <option value="">Todas</option>
                  {options.methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Valor a partir de">{(id) => <MoneyInput id={id} value={rascunho.minCents} onChange={(c) => setRascunho({ ...rascunho, minCents: c })} />}</Field>
            <Field label="Valor até">{(id) => <MoneyInput id={id} value={rascunho.maxCents} onChange={(c) => setRascunho({ ...rascunho, maxCents: c })} />}</Field>
            <Field label="Descrição">{(id) => <input id={id} maxLength={80} value={rascunho.description} onChange={(e) => setRascunho({ ...rascunho, description: e.target.value })} className={inputCls} />}</Field>
            <Field label="Nº do documento">{(id) => <input id={id} maxLength={40} value={rascunho.document} onChange={(e) => setRascunho({ ...rascunho, document: e.target.value })} className={inputCls} />}</Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setRascunho(SEM_EXTRA)} className="btn-ghost btn-md">
              Limpar
            </button>
            <button type="submit" className="btn-primary btn-md">
              Filtrar
            </button>
          </div>
        </form>
      </Modal>

      <BatchDialog
        open={lote}
        onOpenChange={setLote}
        rows={selecionadas}
        options={options}
        today={today}
        onDone={(texto) => {
          setAviso(texto);
          setMarcados(new Set());
          carregar();
        }}
      />
      <SettleDialog titleId={receber} open={Boolean(receber)} onOpenChange={(o) => !o && setReceber(null)} onDone={carregar} />
      <TitleDetailDialog titleId={detalhe} open={Boolean(detalhe)} onOpenChange={(o) => !o && setDetalhe(null)} options={options} canReverse={access.reverse} onChanged={carregar} onSettle={setReceber} />
      {novo && (
        <NewTitleDialog
          open={novo}
          onOpenChange={setNovo}
          options={options}
          today={today}
          advanced={advanced}
          initialDirection={tab === 'PAYABLE' || !access.receive ? 'PAYABLE' : 'RECEIVABLE'}
          onSaved={(n) => {
            setAviso(n > 1 ? `${n} lançamentos criados.` : 'Lançamento criado.');
            carregar();
          }}
        />
      )}
    </div>
  );
}

function Linha({ r, tab, marcada, podeBaixar, onMarca, onBaixar, onDetalhe }: { r: TitleRow; tab: Tab; marcada: boolean; podeBaixar: boolean; onMarca: (v: boolean) => void; onBaixar: () => void; onDetalhe: () => void }) {
  const link = originHref(r);
  const verbo = r.direction === 'RECEIVABLE' ? 'Receber' : 'Pagar';
  return (
    <tr className="hover:bg-surface-alt/40">
      <td className="px-3 py-2">{podeBaixar && <input type="checkbox" aria-label={`Marcar a conta ${r.code}`} className="h-4 w-4" checked={marcada} onChange={(e) => onMarca(e.target.checked)} />}</td>
      <td className="px-3 py-2">
        <button type="button" onClick={onDetalhe} className="font-mono text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Ver a conta ${r.code}`}>
          {r.code}
        </button>
      </td>
      <td className="max-w-[18rem] px-3 py-2">
        <p className="truncate font-medium">{r.party || 'Sem cadastro'}</p>
        <p className="truncate text-xs text-muted-foreground">
          {tab === 'ALL' && <>{r.direction === 'RECEIVABLE' ? 'A receber' : 'A pagar'} · </>}
          {link ? (
            <Link href={link} className="underline-offset-2 hover:underline">
              {r.description || ORIGIN_LABEL[r.origin as keyof typeof ORIGIN_LABEL]}
            </Link>
          ) : (
            r.description || ORIGIN_LABEL[r.origin as keyof typeof ORIGIN_LABEL]
          )}
        </p>
      </td>
      <td className="px-3 py-2">{r.category}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {dayBR(r.dueDate)}
        {r.installment && <span className="ml-1.5 text-xs text-muted-foreground">{r.installment}</span>}
        {r.recurring && <Repeat className="ml-1.5 inline h-3.5 w-3.5 text-muted-foreground" aria-label="Recorrente" />}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formatCents(r.openCents)}</td>
      <td className="px-3 py-2">
        <StatusBadge display={r.display} />
      </td>
      <td className="px-3 py-2 text-right">
        {podeBaixar && (
          <button type="button" onClick={onBaixar} className="btn-outline btn-sm inline-flex items-center gap-1" aria-label={`${verbo} a conta ${r.code}`}>
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> {verbo}
          </button>
        )}
      </td>
    </tr>
  );
}

function BatchDialog({ open, onOpenChange, rows, options, today, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; rows: TitleRow[]; options: FinOptions; today: string; onDone: (texto: string) => void }) {
  const formas = options.methods.filter((m) => m.kind !== 'WALLET' && m.kind !== 'CREDIT_CARD');
  const [methodId, setMethodId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [documentNumber, setDocumentNumber] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const pix = formas.find((m) => m.kind === 'PIX') ?? formas[0];
    setMethodId(pix?.id ?? '');
    setAccountId(pix?.accountId ?? options.accounts.find((a) => a.isDefault)?.id ?? '');
    setPaidOn(today);
    setDocumentNumber('');
    setErro('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const salvar = () =>
    start(async () => {
      setErro('');
      const r = await settleBatchAction({ ids: rows.map((x) => x.id), methodId, accountId: accountId || null, paidOn, documentNumber: documentNumber || null });
      if (!r.ok) return setErro(r.message);
      const pulados = r.data.skipped.length ? ` ${r.data.skipped.length} ficaram de fora: ${r.data.skipped.map((s) => `nº ${s.code} (${s.reason})`).join('; ')}` : '';
      onDone(`${r.data.done} conta(s) baixada(s).${pulados}`);
      onOpenChange(false);
    });

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Baixar selecionadas" description={`${rows.length} conta(s) · ${formatCents(rows.reduce((s, r) => s + r.openCents, 0))}. Cada uma é quitada pelo valor em aberto.`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Forma">
            {(id) => (
              <select
                id={id}
                value={methodId}
                onChange={(e) => {
                  setMethodId(e.target.value);
                  const f = formas.find((m) => m.id === e.target.value);
                  if (f?.accountId) setAccountId(f.accountId);
                }}
                className={inputCls}
              >
                {formas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Conta">
            {(id) => (
              <select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
                {options.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Data do pagamento">{(id) => <DateField id={id} max={today} value={paidOn} onChange={(v) => setPaidOn(v)} className={inputCls} />}</Field>
          <Field label="Nº do documento (opcional)">{(id) => <input id={id} maxLength={60} value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} className={inputCls} />}</Field>
        </div>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending || !methodId} className="btn-primary btn-md">
            {pending ? 'Baixando…' : `Baixar ${rows.length}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
