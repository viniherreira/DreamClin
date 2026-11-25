'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Check, FastForward, RotateCcw, Upload } from 'lucide-react';
import { Badge, ErrorText, Field, inputCls, Modal, MoneyInput, PlanLock } from '@/components/fin/ui';
import type { ReceivableRow } from '@/fin/reconcile';
import { addDays, dayBR, type Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { anticipateAction, checkReturnedAction, previewCardFileAction, receivablesAction, reconcileReceivablesAction } from '../actions';

import { DateField } from '@/components/ui/date-field';
/**
 * Cartões e cheques: os recebíveis de cada venda no cartão (uma linha por
 * parcela) e os cheques, para conferir com o que a operadora pagou. Concilia
 * marcando ou pelo arquivo da operadora; antecipa; marca cheque devolvido.
 */

const STATUS: Record<string, { label: string; tone: 'amber' | 'green' | 'gray' | 'red' }> = {
  OPEN: { label: 'A compensar', tone: 'amber' },
  RECONCILED: { label: 'Conciliado', tone: 'green' },
  CANCELLED: { label: 'Cancelado', tone: 'gray' },
  RETURNED: { label: 'Devolvido', tone: 'red' },
};

type Preview = Extract<Awaited<ReturnType<typeof previewCardFileAction>>, { ok: true }>['rows'];

export function CardsView({ today }: { today: Day }) {
  const [from, setFrom] = useState<string>(addDays(today, -30));
  const [to, setTo] = useState<string>(addDays(today, 60));
  const [by, setBy] = useState<'expected' | 'reconciled'>('expected');
  const [status, setStatus] = useState<'OPEN' | 'RECONCILED' | 'CANCELLED' | 'RETURNED' | 'ALL'>('OPEN');
  const [kind, setKind] = useState<'' | 'CARD' | 'CHECK'>('');
  const [rows, setRows] = useState<ReceivableRow[] | { locked: true } | null | undefined>(undefined);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [antecipar, setAntecipar] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const arquivo = useRef<HTMLInputElement>(null);

  const carregar = useCallback(() => {
    start(async () => {
      setRows(await receivablesAction({ from, to, by, status, kind: kind || null }));
      setMarcados(new Set());
    });
  }, [from, to, by, status, kind]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  if (rows && 'locked' in rows) return <PlanLock what="A conciliação de cartões" />;
  const lista = rows ?? [];
  const selecionados = lista.filter((r) => marcados.has(r.id));
  const abertosSel = selecionados.length > 0 && selecionados.every((r) => r.status === 'OPEN');

  const conciliar = (ids: string[]) =>
    start(async () => {
      setErro('');
      const r = await reconcileReceivablesAction(ids);
      if (!r.ok) return setErro(r.message);
      setAviso(`${r.reconciled} recebível(is) conciliado(s).`);
      setPreview(null);
      carregar();
    });

  const lerArquivo = (f: File) =>
    start(async () => {
      setErro('');
      const fd = new FormData();
      fd.set('file', f);
      const r = await previewCardFileAction(fd);
      if (arquivo.current) arquivo.current.value = '';
      if (!r.ok) return setErro(r.message);
      setPreview(r.rows);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Data por" className="w-40">
            {(id) => (
              <select id={id} value={by} onChange={(e) => setBy(e.target.value as typeof by)} className={inputCls}>
                <option value="expected">Compensação</option>
                <option value="reconciled">Conciliação</option>
              </select>
            )}
          </Field>
          <Field label="De" className="w-36">{(id) => <DateField id={id} value={from} onChange={(v) => setFrom(v)} className={inputCls} />}</Field>
          <Field label="Até" className="w-36">{(id) => <DateField id={id} value={to} onChange={(v) => setTo(v)} className={inputCls} />}</Field>
          <Field label="Mostrar" className="w-40">
            {(id) => (
              <select id={id} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputCls}>
                <option value="OPEN">Não conciliados</option>
                <option value="RECONCILED">Conciliados</option>
                <option value="CANCELLED">Cancelados</option>
                <option value="RETURNED">Cheques devolvidos</option>
                <option value="ALL">Todos</option>
              </select>
            )}
          </Field>
          <Field label="Tipo" className="w-32">
            {(id) => (
              <select id={id} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputCls}>
                <option value="">Todos</option>
                <option value="CARD">Cartão</option>
                <option value="CHECK">Cheque</option>
              </select>
            )}
          </Field>
        </div>
        <div>
          <input ref={arquivo} id="cartao-arquivo" type="file" accept=".csv,.txt" className="sr-only" onChange={(e) => e.target.files?.[0] && lerArquivo(e.target.files[0])} />
          <label htmlFor="cartao-arquivo" className="btn-outline btn-sm inline-flex cursor-pointer items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Arquivo da operadora (CSV)
          </label>
        </div>
      </div>

      {selecionados.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <p>
            {selecionados.length} marcado(s) · líquido {formatCents(selecionados.reduce((s, r) => s + r.netCents, 0))}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={!abertosSel || pending} onClick={() => conciliar(selecionados.map((s) => s.id))} className="btn-primary btn-sm inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Conciliar
            </button>
            <button type="button" disabled={!abertosSel || selecionados.some((s) => s.kind !== 'CARD')} onClick={() => setAntecipar(true)} className="btn-outline btn-sm inline-flex items-center gap-1">
              <FastForward className="h-3.5 w-3.5" aria-hidden="true" /> Antecipar
            </button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" className={aviso ? 'rounded-lg bg-surface-alt px-3 py-2 text-sm' : 'sr-only'}>
        {aviso}
      </p>
      <ErrorText>{erro}</ErrorText>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[980px] text-sm">
          <caption className="sr-only">Recebíveis de cartão e cheques</caption>
          <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="w-8 px-3 py-2.5">
                {lista.length > 0 && <input type="checkbox" aria-label="Marcar todos" className="h-4 w-4" checked={lista.every((r) => marcados.has(r.id))} onChange={(e) => setMarcados(e.target.checked ? new Set(lista.map((r) => r.id)) : new Set())} />}
              </th>
              <th scope="col" className="px-3 py-2.5">Nº</th>
              <th scope="col" className="px-3 py-2.5">Cliente</th>
              <th scope="col" className="px-3 py-2.5">Forma</th>
              <th scope="col" className="px-3 py-2.5">Parcela</th>
              <th scope="col" className="px-3 py-2.5">Compensação</th>
              <th scope="col" className="px-3 py-2.5 text-right">Valor</th>
              <th scope="col" className="px-3 py-2.5 text-right">Taxa</th>
              <th scope="col" className="px-3 py-2.5 text-right">Líquido</th>
              <th scope="col" className="px-3 py-2.5">Situação</th>
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows === undefined ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            ) : lista.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum recebível neste filtro.
                </td>
              </tr>
            ) : (
              lista.map((r) => (
                <tr key={r.id} className="hover:bg-surface-alt/40">
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Marcar o recebível ${r.code} parcela ${r.installment}`} className="h-4 w-4" checked={marcados.has(r.id)} onChange={(e) => setMarcados((m) => { const n = new Set(m); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="max-w-[12rem] truncate px-3 py-2">{r.party}</td>
                  <td className="px-3 py-2">
                    {r.methodName}
                    {r.nsu && <span className="block text-xs text-muted-foreground">NSU {r.nsu}</span>}
                    {r.kind === 'CHECK' && r.documentNumber && <span className="block text-xs text-muted-foreground">Cheque {r.documentNumber}</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.installment}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dayBR(r.expectedDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCents(r.grossCents)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{r.feeCents ? formatCents(r.feeCents) : ''}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formatCents(r.netCents)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS[r.status]?.tone ?? 'gray'}>{STATUS[r.status]?.label ?? r.status}</Badge>
                    {r.anticipated && <span className="ml-1 text-xs text-muted-foreground">antecipado</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.kind === 'CHECK' && r.status !== 'RETURNED' && r.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (!confirm('Marcar este cheque como devolvido? O recebimento é estornado e a conta do paciente volta a ficar em aberto.')) return;
                          start(async () => {
                            const x = await checkReturnedAction(r.id);
                            if (!x.ok) return setErro(x.message);
                            setAviso('Cheque marcado como devolvido. A conta do paciente reabriu.');
                            carregar();
                          });
                        }}
                        className="btn-ghost btn-sm inline-flex items-center gap-1"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Devolvido
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Arquivo da operadora: um CSV com as colunas data;nsu;parcela;valor_bruto;taxa;valor_liquido (data e valor líquido são obrigatórios).</p>

      {antecipar && (
        <AnteciparDialog
          rows={selecionados}
          today={today}
          onClose={() => setAntecipar(false)}
          onDone={(custo) => {
            setAviso(`Antecipação registrada${custo > 0 ? `, com custo de ${formatCents(custo)} lançado como despesa` : ''}.`);
            carregar();
          }}
        />
      )}
      {preview && <ArquivoDialog rows={preview} pending={pending} onClose={() => setPreview(null)} onConfirm={(ids) => conciliar(ids)} />}
    </div>
  );
}

function AnteciparDialog({ rows, today, onClose, onDone }: { rows: ReceivableRow[]; today: Day; onClose: () => void; onDone: (custo: number) => void }) {
  const liquido = rows.reduce((s, r) => s + r.netCents, 0);
  const [dia, setDia] = useState<string>(today);
  const [recebido, setRecebido] = useState(liquido);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Antecipar recebíveis" description={`${rows.length} parcela(s) · líquido ${formatCents(liquido)}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await anticipateAction(rows.map((x) => x.id), dia, recebido);
            if (!r.ok) return setErro(r.message);
            onClose();
            onDone(r.costCents);
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Data do crédito">{(id) => <DateField id={id} max={today} value={dia} onChange={(v) => setDia(v)} className={inputCls} />}</Field>
          <Field label="Valor recebido" hint={`Custo da antecipação: ${formatCents(Math.max(0, liquido - recebido))}`}>{(id) => <MoneyInput id={id} value={recebido} onChange={setRecebido} />}</Field>
        </div>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="btn-primary btn-md">
            Antecipar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ArquivoDialog({ rows, pending, onClose, onConfirm }: { rows: Preview; pending: boolean; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const casados = rows.filter((r) => r.receivableId);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Arquivo da operadora" description={`${casados.length} de ${rows.length} pagamento(s) encontrados no sistema.`} size="lg">
      <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">Pagamentos do arquivo e recebíveis do sistema</caption>
          <thead className="sticky top-0 bg-surface-alt text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">Data</th>
              <th scope="col" className="px-3 py-2">NSU</th>
              <th scope="col" className="px-3 py-2">Cliente</th>
              <th scope="col" className="px-3 py-2 text-right">Operadora</th>
              <th scope="col" className="px-3 py-2 text-right">Sistema</th>
              <th scope="col" className="px-3 py-2 text-right">Diferença</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className={!r.receivableId ? 'text-muted-foreground' : r.diffCents ? 'bg-amber-50 dark:bg-amber-950/30' : ''}>
                <td className="px-3 py-1.5 tabular-nums">{dayBR(r.date)}</td>
                <td className="px-3 py-1.5">{r.nsu ?? ''}</td>
                <td className="px-3 py-1.5">{r.receivableId ? r.party : 'Não encontrado'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatCents(r.netCents)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.systemNetCents != null ? formatCents(r.systemNetCents) : '—'}</td>
                <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${r.diffCents ? 'text-destructive' : ''}`}>{r.diffCents ? formatCents(r.diffCents) : r.receivableId ? 'Bateu' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-outline btn-md">
          Cancelar
        </button>
        <button type="button" disabled={pending || casados.length === 0} onClick={() => onConfirm(casados.map((r) => r.receivableId!))} className="btn-primary btn-md">
          Conciliar {casados.length} encontrado(s)
        </button>
      </div>
    </Modal>
  );
}
