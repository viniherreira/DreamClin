'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { ArrowLeftRight, Check, Link2, Plus, Search, Trash2, Undo2, Upload } from 'lucide-react';
import { Badge, ErrorText, Field, inputCls, Modal, PlanLock } from '@/components/fin/ui';
import type { FinOptions } from '@/app/(app)/financeiro/contas/_components/types';
import type { PendingLine } from '@/fin/reconcile';
import { addDays, dayBR, type Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import {
  accountMovementsAction,
  createFromLineAction,
  discardLineAction,
  importStatementAction,
  lineCandidatesAction,
  linkLineAction,
  reconSummaryAction,
  setReconciledAction,
  statementLinesAction,
  transferFromLineAction,
  undoLineAction,
} from '../actions';

import { DateField } from '@/components/ui/date-field';
/**
 * Conciliação bancária: importar o extrato (OFX ou CSV), casar cada linha com
 * um movimento (as exatas casam sozinhas; as aproximadas aparecem como
 * sugestão), e resolver o resto com Buscar, Lançar, Transferência ou Descartar.
 * Também dá para conferir item a item os movimentos da conta.
 */

type Summary = NonNullable<Exclude<Awaited<ReturnType<typeof reconSummaryAction>>, { locked: true }>>;
type Movement = Awaited<ReturnType<typeof accountMovementsAction>>[number];

const STATUS = { PENDING: 'Pendente', MATCHED: 'Casada', CREATED: 'Lançada', TRANSFER: 'Transferência', DISCARDED: 'Descartada' } as const;

export function BanksView({ options, today }: { options: FinOptions; today: Day }) {
  const [resumo, setResumo] = useState<Summary | { locked: true } | null | undefined>(undefined);
  const [conta, setConta] = useState('');
  const [aba, setAba] = useState<'extrato' | 'movimentos'>('extrato');
  const [linhas, setLinhas] = useState<PendingLine[] | null>(null);
  const [mostrarTudo, setMostrarTudo] = useState(false);
  const [movs, setMovs] = useState<Movement[] | null>(null);
  const [de, setDe] = useState<string>(addDays(today, -30));
  const [ate, setAte] = useState<string>(today);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const [acao, setAcao] = useState<{ kind: 'buscar' | 'lancar' | 'transferir'; line: PendingLine } | null>(null);
  const [pending, start] = useTransition();
  const arquivo = useRef<HTMLInputElement>(null);

  const carregarResumo = useCallback(async () => {
    const r = await reconSummaryAction();
    setResumo(r);
    if (r && !('locked' in r) && !conta && r[0]) setConta(r.find((a) => a.kind !== 'CASH')?.id ?? r[0].id);
  }, [conta]);
  const carregar = useCallback(async () => {
    if (!conta) return;
    if (aba === 'extrato') setLinhas(await statementLinesAction(conta, mostrarTudo ? 'all' : 'pending'));
    else setMovs(await accountMovementsAction(conta, de, ate));
  }, [conta, aba, mostrarTudo, de, ate]);
  useEffect(() => {
    void carregarResumo();
  }, [carregarResumo]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const depois = async (texto?: string) => {
    if (texto) setAviso(texto);
    await Promise.all([carregar(), carregarResumo()]);
  };
  const faz = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, texto: string) =>
    start(async () => {
      setErro('');
      const r = await fn();
      if (!r.ok) return setErro(r.message);
      await depois(texto);
    });

  const importar = (f: File) =>
    start(async () => {
      setErro('');
      const fd = new FormData();
      fd.set('file', f);
      const r = await importStatementAction(conta, fd);
      if (arquivo.current) arquivo.current.value = '';
      if (!r.ok) return setErro(r.message);
      await depois(`${r.added} linha(s) importada(s)${r.skipped ? `, ${r.skipped} já estavam no sistema` : ''}. ${r.matched} casaram sozinhas.`);
    });

  if (resumo && 'locked' in resumo) return <PlanLock what="A conciliação bancária" />;
  if (resumo === undefined) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (resumo === null) return <p className="text-sm text-muted-foreground">Sem acesso.</p>;
  const atual = resumo.find((a) => a.id === conta);

  return (
    <div className="space-y-4">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Contas">
        {resumo.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => setConta(a.id)} aria-pressed={conta === a.id} className={`w-full rounded-xl border p-3 text-left shadow-card focus-visible:outline-2 focus-visible:outline-ring ${conta === a.id ? 'border-primary bg-primary/5' : 'border-border bg-surface hover:border-primary/40'}`}>
              <p className="flex items-center justify-between gap-2 font-medium">
                {a.name} {a.pendingLines > 0 && <Badge tone="amber">{a.pendingLines} pendente(s)</Badge>}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Saldo <span className="tabular-nums">{formatCents(a.balanceCents)}</span> · conciliado <span className="tabular-nums">{formatCents(a.reconciledCents)}</span>
              </p>
            </button>
          </li>
        ))}
      </ul>

      {atual && (
        <section aria-label={`Conciliação da conta ${atual.name}`} className="rounded-xl border border-border bg-surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
            <div role="tablist" aria-label="Como conciliar" className="inline-flex rounded-lg bg-surface-alt p-1">
              {(
                [
                  ['extrato', 'Extrato importado'],
                  ['movimentos', 'Movimentos da conta'],
                ] as const
              ).map(([id, l]) => (
                <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${aba === id ? 'bg-surface shadow-sm' : 'text-muted-foreground'}`}>
                  {l}
                </button>
              ))}
            </div>
            {aba === 'extrato' ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={mostrarTudo} onChange={(e) => setMostrarTudo(e.target.checked)} /> Mostrar as resolvidas
                </label>
                <input ref={arquivo} id="extrato-arquivo" type="file" accept=".ofx,.csv,.txt" className="sr-only" onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
                <label htmlFor="extrato-arquivo" className="btn-primary btn-sm inline-flex cursor-pointer items-center gap-1.5">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Importar extrato (OFX ou CSV)
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="De" className="w-36">{(id) => <DateField id={id} value={de} onChange={(v) => setDe(v)} className={inputCls} />}</Field>
                <Field label="Até" className="w-36">{(id) => <DateField id={id} value={ate} onChange={(v) => setAte(v)} className={inputCls} />}</Field>
              </div>
            )}
          </div>
          <div className="p-3">
            <p role="status" aria-live="polite" className={aviso ? 'mb-3 rounded-lg bg-surface-alt px-3 py-2 text-sm' : 'sr-only'}>
              {aviso}
            </p>
            <ErrorText>{erro}</ErrorText>
            {aba === 'extrato' ? (
              !linhas ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : linhas.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{mostrarTudo ? 'Nenhum extrato importado nesta conta.' : 'Nada pendente. Importe o extrato do banco para conferir.'}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {linhas.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                      <span className="w-20 tabular-nums text-muted-foreground">{dayBR(l.date)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{l.description}</span>
                        {l.status === 'PENDING' && l.suggestion && (
                          <span className="block text-xs text-muted-foreground">
                            Sugestão: movimento nº {l.suggestion.code} de {dayBR(l.suggestion.date)} {l.suggestion.description ? `(${l.suggestion.description})` : ''}
                          </span>
                        )}
                        {l.status !== 'PENDING' && (
                          <span className="block text-xs text-muted-foreground">
                            {STATUS[l.status as keyof typeof STATUS]}
                            {l.transactionCode ? ` · movimento nº ${l.transactionCode}` : ''}
                          </span>
                        )}
                      </span>
                      <span className={`w-28 text-right font-semibold tabular-nums ${l.amountCents < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{formatCents(l.amountCents)}</span>
                      <span className="flex flex-wrap justify-end gap-1">
                        {l.status === 'PENDING' ? (
                          <>
                            {l.suggestion && (
                              <button type="button" disabled={pending} onClick={() => faz(() => linkLineAction(l.id, l.suggestion!.id), 'Linha casada com o movimento.')} className="btn-primary btn-sm inline-flex items-center gap-1" aria-label={`Confirmar a sugestão para ${l.description}`}>
                                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Confirmar
                              </button>
                            )}
                            <button type="button" onClick={() => setAcao({ kind: 'buscar', line: l })} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Buscar movimento para ${l.description}`}>
                              <Search className="h-3.5 w-3.5" aria-hidden="true" /> Buscar
                            </button>
                            <button type="button" onClick={() => setAcao({ kind: 'lancar', line: l })} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Lançar movimento para ${l.description}`}>
                              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Lançar
                            </button>
                            <button type="button" onClick={() => setAcao({ kind: 'transferir', line: l })} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Marcar ${l.description} como transferência`}>
                              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" /> Transferência
                            </button>
                            <button type="button" disabled={pending} onClick={() => faz(() => discardLineAction(l.id), 'Linha descartada.')} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Descartar ${l.description}`}>
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </>
                        ) : (
                          <button type="button" disabled={pending} onClick={() => faz(() => undoLineAction(l.id), 'Desfeito. A linha voltou a ficar pendente.')} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Desfazer ${l.description}`}>
                            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Desfazer
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : !movs ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : movs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum movimento nesta conta no período.</p>
            ) : (
              <ul className="divide-y divide-border">
                {movs.map((m) => (
                  <li key={m.id} className={`flex flex-wrap items-center gap-2 py-2 text-sm ${m.reversed ? 'text-muted-foreground' : ''}`}>
                    <input type="checkbox" className="h-4 w-4" aria-label={`Conciliado: movimento nº ${m.code}`} checked={m.reconciled} disabled={pending || (m.reconciled && m.byStatement)} onChange={(e) => faz(() => setReconciledAction(m.id, e.target.checked), e.target.checked ? 'Movimento conciliado.' : 'Movimento desmarcado.')} />
                    <span className="w-20 tabular-nums text-muted-foreground">{dayBR(m.date)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-xs">nº {m.code}</span> {m.description} {m.reversed && <Badge>Estornado</Badge>}
                    </span>
                    <span className={`w-28 text-right tabular-nums ${m.amountCents < 0 ? 'text-rose-700 dark:text-rose-400' : ''}`}>{formatCents(m.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {acao?.kind === 'buscar' && <BuscarDialog line={acao.line} onClose={() => setAcao(null)} onDone={() => depois('Linha casada com o movimento.')} />}
      {acao?.kind === 'lancar' && <LancarDialog line={acao.line} options={options} onClose={() => setAcao(null)} onDone={() => depois('Movimento lançado e conciliado.')} />}
      {acao?.kind === 'transferir' && <TransferirDialog line={acao.line} accounts={(resumo ?? []).filter((a) => a.id !== conta)} onClose={() => setAcao(null)} onDone={() => depois('Transferência registrada e conciliada.')} />}
    </div>
  );
}

function BuscarDialog({ line, onClose, onDone }: { line: PendingLine; onClose: () => void; onDone: () => void }) {
  const [lista, setLista] = useState<Awaited<ReturnType<typeof lineCandidatesAction>> | null>(null);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    void lineCandidatesAction(line.id).then(setLista);
  }, [line.id]);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Buscar movimento" description={`${dayBR(line.date)} · ${line.description} · ${formatCents(line.amountCents)}`}>
      {!lista ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum movimento desta conta com o mesmo valor, perto desta data. Use Lançar para criar o que faltou.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {lista.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2">
              <span className="tabular-nums text-muted-foreground">{dayBR(c.date)}</span>
              <span className="min-w-0 flex-1 truncate">
                nº {c.code} {c.description}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await linkLineAction(line.id, c.id);
                    if (!r.ok) return setErro(r.message);
                    onClose();
                    onDone();
                  })
                }
                className="btn-primary btn-sm inline-flex items-center gap-1"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Ligar
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <ErrorText>{erro}</ErrorText>
      </div>
    </Modal>
  );
}

function LancarDialog({ line, options, onClose, onDone }: { line: PendingLine; options: FinOptions; onClose: () => void; onDone: () => void }) {
  const entrada = line.amountCents > 0;
  const cats = options.categories.filter((c) => c.parentId && c.direction === (entrada ? 'RECEIVABLE' : 'PAYABLE'));
  const [cat, setCat] = useState(cats[0]?.id ?? '');
  const [desc, setDesc] = useState(line.description);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={entrada ? 'Lançar entrada' : 'Lançar saída'} description={`${dayBR(line.date)} · ${formatCents(line.amountCents)}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createFromLineAction(line.id, cat, desc);
            if (!r.ok) return setErro(r.message);
            onClose();
            onDone();
          });
        }}
      >
        <Field label="Categoria">
          {(id) => (
            <select id={id} value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Descrição">{(id) => <input id={id} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} />}</Field>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending || !cat} className="btn-primary btn-md">
            Lançar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TransferirDialog({ line, accounts, onClose, onDone }: { line: PendingLine; accounts: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [outra, setOutra] = useState(accounts[0]?.id ?? '');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Transferência entre contas" description={`${dayBR(line.date)} · ${formatCents(line.amountCents)}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await transferFromLineAction(line.id, outra);
            if (!r.ok) return setErro(r.message);
            onClose();
            onDone();
          });
        }}
      >
        <Field label={line.amountCents < 0 ? 'Foi para a conta' : 'Veio da conta'}>
          {(id) => (
            <select id={id} value={outra} onChange={(e) => setOutra(e.target.value)} className={inputCls}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending || !outra} className="btn-primary btn-md">
            Registrar transferência
          </button>
        </div>
      </form>
    </Modal>
  );
}
