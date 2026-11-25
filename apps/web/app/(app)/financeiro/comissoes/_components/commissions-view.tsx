'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Check, Pencil, Receipt } from 'lucide-react';
import { Badge, ErrorText, Field, inputCls, Modal, MoneyInput } from '@/components/fin/ui';
import type { CommissionRow } from '@/fin/commission';
import { COMMISSION_STATUS_LABEL, type CommissionDisplay } from '@/lib/financeiro/commission';
import { addDays, dayBR, type Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { adjustCommissionAction, approveCommissionsAction, invoiceCommissionsAction, listCommissionsAction } from '../actions';

import { DateField } from '@/components/ui/date-field';
/**
 * Comissões e repasses: confere as linhas do período, ajusta com motivo,
 * aprova e fatura (gera a conta a pagar de cada pessoa). O profissional, se a
 * clínica liberar, vê só as dele.
 */

const TOM: Record<CommissionDisplay, 'gray' | 'amber' | 'blue' | 'green' | 'red'> = { PENDING: 'amber', APPROVED: 'blue', BILLED: 'blue', PAID: 'green', REVERSED: 'gray' };
const MOMENTO = { EXECUTION: 'Atendimento', BILLING: 'Faturamento', RECEIPT: 'Recebimento' } as const;

export function CommissionsView({ today, professionals, methods, manage }: { today: Day; professionals: { id: string; name: string }[]; methods: { id: string; name: string }[]; manage: boolean }) {
  const inicioMes = `${today.slice(0, 7)}-01` as Day;
  const [from, setFrom] = useState<string>(inicioMes);
  const [to, setTo] = useState<string>(today);
  const [profissional, setProfissional] = useState('');
  const [situacao, setSituacao] = useState<'ALL' | CommissionDisplay>('ALL');
  const [data, setData] = useState<{ rows: CommissionRow[]; own: boolean } | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [ajustar, setAjustar] = useState<CommissionRow | null>(null);
  const [faturar, setFaturar] = useState(false);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const carregar = useCallback(() => {
    start(async () => {
      setData(await listCommissionsAction({ from, to, professionalId: profissional || null, status: situacao }));
      setMarcados(new Set());
    });
  }, [from, to, profissional, situacao]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const rows = data?.rows ?? [];
  const selecionadas = rows.filter((r) => marcados.has(r.id));
  const porPessoa = useMemo(() => {
    const m = new Map<string, { nome: string; total: number; pendente: number }>();
    for (const r of rows) {
      if (r.display === 'REVERSED') continue;
      const x = m.get(r.beneficiaryKey) ?? { nome: r.beneficiary, total: 0, pendente: 0 };
      x.total += r.totalCents;
      if (r.display === 'PENDING' || r.display === 'APPROVED') x.pendente += r.totalCents;
      m.set(r.beneficiaryKey, x);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [rows]);
  const podeAprovar = manage && selecionadas.length > 0 && selecionadas.every((r) => r.display === 'PENDING');
  const podeFaturar = manage && selecionadas.length > 0 && selecionadas.every((r) => r.display === 'APPROVED') && new Set(selecionadas.map((r) => r.beneficiaryKey)).size === 1;

  const aprovar = () =>
    start(async () => {
      setErro('');
      const r = await approveCommissionsAction(selecionadas.map((s) => s.id));
      if (!r.ok) return setErro(r.message);
      setAviso(`${r.approved} linha(s) aprovada(s).`);
      carregar();
    });

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
        <Field label="De" className="w-40">{(id) => <DateField id={id} value={from} onChange={(v) => setFrom(v)} className={inputCls} />}</Field>
        <Field label="Até" className="w-40">{(id) => <DateField id={id} value={to} onChange={(v) => setTo(v)} className={inputCls} />}</Field>
        {manage && (
          <Field label="Profissional" className="w-48">
            {(id) => (
              <select id={id} value={profissional} onChange={(e) => setProfissional(e.target.value)} className={inputCls}>
                <option value="">Todos</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="Situação" className="w-40">
          {(id) => (
            <select id={id} value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)} className={inputCls}>
              <option value="ALL">Todas</option>
              {(Object.keys(COMMISSION_STATUS_LABEL) as CommissionDisplay[]).map((k) => (
                <option key={k} value={k}>
                  {COMMISSION_STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="flex gap-1 pb-0.5 text-xs">
          <button type="button" onClick={() => (setFrom(inicioMes), setTo(today))} className="rounded-full border border-border px-2.5 py-1 font-medium text-muted-foreground hover:text-foreground">
            Este mês
          </button>
          <button
            type="button"
            onClick={() => {
              const fim = addDays(inicioMes, -1);
              setFrom(`${fim.slice(0, 7)}-01`);
              setTo(fim);
            }}
            className="rounded-full border border-border px-2.5 py-1 font-medium text-muted-foreground hover:text-foreground"
          >
            Mês passado
          </button>
        </div>
      </div>

      {porPessoa.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Total por pessoa">
          {porPessoa.map((p) => (
            <li key={p.nome} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
              <span className="font-medium">{p.nome}</span> · <span className="tabular-nums">{formatCents(p.total)}</span>
              {p.pendente > 0 && <span className="text-xs text-muted-foreground"> ({formatCents(p.pendente)} a faturar)</span>}
            </li>
          ))}
        </ul>
      )}

      {manage && selecionadas.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <p>
            {selecionadas.length} linha(s) · {formatCents(selecionadas.reduce((s, r) => s + r.totalCents, 0))}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMarcados(new Set())} className="btn-ghost btn-sm">
              Desmarcar
            </button>
            <button type="button" onClick={aprovar} disabled={!podeAprovar || pending} className="btn-outline btn-sm inline-flex items-center gap-1" title={podeAprovar ? undefined : 'Marque só linhas pendentes'}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Aprovar
            </button>
            <button type="button" onClick={() => setFaturar(true)} disabled={!podeFaturar} className="btn-primary btn-sm inline-flex items-center gap-1" title={podeFaturar ? undefined : 'Marque linhas aprovadas de uma pessoa só'}>
              <Receipt className="h-3.5 w-3.5" aria-hidden="true" /> Faturar
            </button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" className={aviso ? 'mt-3 rounded-lg bg-surface-alt px-3 py-2 text-sm' : 'sr-only'}>
        {aviso}
      </p>
      <div className="mt-2">
        <ErrorText>{erro}</ErrorText>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[960px] text-sm">
          <caption className="sr-only">Comissões e repasses</caption>
          <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="w-8 px-3 py-2.5">
                {manage && rows.length > 0 && <input type="checkbox" aria-label="Marcar todas" className="h-4 w-4" checked={rows.length > 0 && rows.every((r) => marcados.has(r.id))} onChange={(e) => setMarcados(e.target.checked ? new Set(rows.filter((r) => r.display !== 'REVERSED').map((r) => r.id)) : new Set())} />}
              </th>
              <th scope="col" className="px-3 py-2.5">Data</th>
              <th scope="col" className="px-3 py-2.5">Para quem</th>
              <th scope="col" className="px-3 py-2.5">Lançamento</th>
              <th scope="col" className="px-3 py-2.5 text-right">Base</th>
              <th scope="col" className="px-3 py-2.5 text-right">Valor</th>
              <th scope="col" className="px-3 py-2.5">Situação</th>
              <th scope="col" className="px-3 py-2.5">
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
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma comissão neste período. Elas nascem dos atendimentos, conforme a regra em Configurações › Financeiro › Comissões.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={r.display === 'REVERSED' ? 'text-muted-foreground' : 'hover:bg-surface-alt/40'}>
                  <td className="px-3 py-2">
                    {manage && r.display !== 'REVERSED' && (
                      <input type="checkbox" aria-label={`Marcar ${r.description}`} className="h-4 w-4" checked={marcados.has(r.id)} onChange={(e) => setMarcados((m) => { const n = new Set(m); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dayBR(r.occurredOn)}</td>
                  <td className="px-3 py-2">
                    {r.beneficiary}
                    {r.kind === 'TRANSFER' && <span className="ml-1 text-xs text-muted-foreground">(repasse)</span>}
                  </td>
                  <td className="max-w-[20rem] px-3 py-2">
                    <p className="truncate">{r.description}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {MOMENTO[r.trigger]} · {r.ruleLabel}
                      {r.adjustmentReason ? ` · ajuste: ${r.adjustmentReason}` : ''}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCents(r.baseCents)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                    {formatCents(r.totalCents)}
                    {r.adjustmentCents !== 0 && <span className="block text-xs font-normal text-muted-foreground">ajuste {formatCents(r.adjustmentCents)}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={TOM[r.display]}>{COMMISSION_STATUS_LABEL[r.display]}</Badge>
                    {r.payableTitleCode && <span className="ml-1 text-xs text-muted-foreground">conta nº {r.payableTitleCode}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {manage && (r.display === 'PENDING' || r.display === 'APPROVED') && (
                      <button type="button" onClick={() => setAjustar(r)} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Ajustar ${r.description}`}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Ajustar
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {ajustar && (
        <AjusteDialog
          row={ajustar}
          onClose={() => setAjustar(null)}
          onDone={() => {
            setAviso('Ajuste salvo. A linha volta a ficar pendente para aprovação.');
            carregar();
          }}
        />
      )}
      {faturar && (
        <FaturarDialog
          rows={selecionadas}
          today={today}
          methods={methods}
          onClose={() => setFaturar(false)}
          onDone={(total) => {
            setAviso(`Conta a pagar de ${formatCents(total)} criada em Contas a receber e a pagar.`);
            carregar();
          }}
        />
      )}
    </div>
  );
}

function AjusteDialog({ row, onClose, onDone }: { row: CommissionRow; onClose: () => void; onDone: () => void }) {
  const [sinal, setSinal] = useState<1 | -1>(row.adjustmentCents < 0 ? -1 : 1);
  const [valor, setValor] = useState(Math.abs(row.adjustmentCents));
  const [motivo, setMotivo] = useState(row.adjustmentReason ?? '');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const salvar = () =>
    start(async () => {
      setErro('');
      const r = await adjustCommissionAction(row.id, sinal * valor, motivo);
      if (!r.ok) return setErro(r.message);
      onClose();
      onDone();
    });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Ajustar comissão" description={`${row.description} · ${formatCents(row.amountCents)}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <div role="radiogroup" aria-label="Tipo de ajuste" className="inline-flex rounded-lg bg-surface-alt p-1">
          {([
            [1, 'Somar'],
            [-1, 'Descontar'],
          ] as const).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={sinal === v} onClick={() => setSinal(v)} className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${sinal === v ? 'bg-surface shadow-sm' : 'text-muted-foreground'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Valor do ajuste">{(id) => <MoneyInput id={id} value={valor} onChange={setValor} />}</Field>
          <Field label="Fica">{() => <p className="pt-2 text-sm font-semibold tabular-nums">{formatCents(row.amountCents + sinal * valor)}</p>}</Field>
        </div>
        <Field label="Motivo">{(id) => <input id={id} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputCls} />}</Field>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="btn-primary btn-md">
            Salvar ajuste
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FaturarDialog({ rows, today, methods, onClose, onDone }: { rows: CommissionRow[]; today: Day; methods: { id: string; name: string }[]; onClose: () => void; onDone: (total: number) => void }) {
  const [vence, setVence] = useState<string>(addDays(today, 5));
  const [forma, setForma] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const total = rows.reduce((s, r) => s + r.totalCents, 0);
  const salvar = () =>
    start(async () => {
      setErro('');
      const r = await invoiceCommissionsAction({ ids: rows.map((x) => x.id), dueDate: vence, methodId: forma || null });
      if (!r.ok) return setErro(r.message);
      onClose();
      onDone(r.totalCents);
    });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Faturar comissões" description={`${rows[0]?.beneficiary ?? ''} · ${rows.length} linha(s) · ${formatCents(total)}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vencimento">{(id) => <DateField id={id} value={vence} onChange={(v) => setVence(v)} className={inputCls} />}</Field>
          <Field label="Forma de pagamento (opcional)">
            {(id) => (
              <select id={id} value={forma} onChange={(e) => setForma(e.target.value)} className={inputCls}>
                <option value="">A definir</option>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">Nasce uma conta a pagar com o total. Pague por Contas a receber e a pagar.</p>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="btn-primary btn-md">
            {pending ? 'Faturando…' : `Faturar ${formatCents(total)}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
