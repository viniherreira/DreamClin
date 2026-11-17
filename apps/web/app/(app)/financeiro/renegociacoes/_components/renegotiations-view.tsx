'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { FileDown, Plus, Undo2 } from 'lucide-react';
import { Badge, ErrorText, Field, inputCls, Modal, MoneyInput, PercentInput, Toggle } from '@/components/fin/ui';
import { PatientPicker } from '@/components/fin/patient-picker';
import type { FinOptions } from '@/app/(app)/financeiro/contas/_components/types';
import type { RenegRow } from '@/fin/renegotiation';
import { addMonths, dayBR, type Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { planRenegotiation } from '@/lib/financeiro/renegotiation';
import { CLINIC_TZ } from '@/lib/tz';
import { renegotiateAction, renegotiationCandidates, renegotiationListAction, undoRenegotiationAction } from '../../f5-actions';

/**
 * Renegociações: a lista e o assistente em dois passos (escolher as contas,
 * negociar). As contas antigas ficam "Renegociada" e nascem as novas.
 */

type Candidate = NonNullable<Awaited<ReturnType<typeof renegotiationCandidates>>>[number];

export interface RenegDefaults {
  interestPercent: number;
  mode: 'SIMPLE' | 'PRICE';
  lateChargesEnabled: boolean;
  /** Dono e administrador mudam juros e tiram multa. */
  manager: boolean;
  discountLimitPercent: number;
}

export function RenegotiationsView({ options, today, defaults, canRenegotiate, initialPatient }: { options: FinOptions; today: Day; defaults: RenegDefaults; canRenegotiate: boolean; initialPatient: { id: string; name: string } | null }) {
  const [rows, setRows] = useState<RenegRow[] | null>(null);
  const [novo, setNovo] = useState(Boolean(initialPatient) && canRenegotiate);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const carregar = useCallback(() => start(async () => setRows(await renegotiationListAction())), []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const desfazer = (r: RenegRow) =>
    start(async () => {
      if (!confirm(`Desfazer a renegociação nº ${r.code}? As contas novas são canceladas e as antigas voltam a ficar em aberto.`)) return;
      setErro('');
      const x = await undoRenegotiationAction(r.id);
      if (!x.ok) return setErro(x.message);
      setAviso(`Renegociação nº ${r.code} desfeita.`);
      carregar();
    });

  return (
    <div>
      <div className="flex justify-end">
        {canRenegotiate && (
          <button type="button" onClick={() => setNovo(true)} className="btn-primary btn-md inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" /> Nova renegociação
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className={aviso ? 'mt-3 rounded-lg bg-surface-alt px-3 py-2 text-sm' : 'sr-only'}>
        {aviso}
      </p>
      <div className="mt-2">
        <ErrorText>{erro}</ErrorText>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[820px] text-sm">
          <caption className="sr-only">Renegociações</caption>
          <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5">Nº</th>
              <th scope="col" className="px-3 py-2.5">Cliente</th>
              <th scope="col" className="px-3 py-2.5">Data</th>
              <th scope="col" className="px-3 py-2.5 text-right">Corrigido</th>
              <th scope="col" className="px-3 py-2.5 text-right">Desconto</th>
              <th scope="col" className="px-3 py-2.5 text-right">Recebido</th>
              <th scope="col" className="px-3 py-2.5 text-right">Em aberto</th>
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows === null ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma renegociação ainda.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={r.undone ? 'text-muted-foreground' : 'hover:bg-surface-alt/40'}>
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{r.code}</td>
                  <td className="px-3 py-2">
                    {r.patientId ? (
                      <Link href={`/pacientes/${r.patientId}?aba=financeiro`} className="font-medium hover:underline">
                        {r.party}
                      </Link>
                    ) : (
                      r.party
                    )}
                    <p className="text-xs text-muted-foreground">
                      {r.downPaymentCents > 0 ? `entrada de ${formatCents(r.downPaymentCents)} + ` : ''}
                      {r.installments}x {r.undone && <Badge>Desfeita</Badge>}
                    </p>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{new Date(r.createdAt).toLocaleDateString('pt-BR', { timeZone: CLINIC_TZ })}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.correctedCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.discountCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.newPaidCents)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.undone ? '—' : formatCents(r.newOpenCents)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {canRenegotiate && r.canUndo && (
                      <button type="button" onClick={() => desfazer(r)} disabled={pending} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Desfazer a renegociação nº ${r.code}`}>
                        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Desfazer
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {novo && (
        <Wizard
          options={options}
          today={today}
          defaults={defaults}
          initialPatient={initialPatient}
          onClose={() => setNovo(false)}
          onDone={(texto) => {
            setAviso(texto);
            carregar();
          }}
        />
      )}
    </div>
  );
}

function Wizard({ options, today, defaults, initialPatient, onClose, onDone }: { options: FinOptions; today: Day; defaults: RenegDefaults; initialPatient: { id: string; name: string } | null; onClose: () => void; onDone: (texto: string) => void }) {
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [paciente, setPaciente] = useState(initialPatient);
  const [cobraAtraso, setCobraAtraso] = useState(true);
  const [candidatas, setCandidatas] = useState<Candidate[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [desconto, setDesconto] = useState(0);
  const [entrada, setEntrada] = useState(0);
  const [entradaDia, setEntradaDia] = useState<string>(today);
  const [entradaForma, setEntradaForma] = useState('');
  const [parcelas, setParcelas] = useState(3);
  const [intervalo, setIntervalo] = useState<'monthly' | 'days'>('monthly');
  const [dias, setDias] = useState(30);
  const [primeiro, setPrimeiro] = useState<string>(addMonths(today, 1));
  const [juros, setJuros] = useState<number | null>(defaults.interestPercent);
  const [modo, setModo] = useState(defaults.mode);
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState<{ code: number; receiptGroupId: string | null } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!paciente) {
      setCandidatas(null);
      return;
    }
    let vivo = true;
    void renegotiationCandidates({ patientId: paciente.id, chargeLate: cobraAtraso }).then((c) => {
      if (!vivo) return;
      setCandidatas(c ?? []);
      setMarcadas((m) => (m.size ? m : new Set((c ?? []).map((x) => x.id))));
    });
    return () => {
      vivo = false;
    };
  }, [paciente, cobraAtraso]);

  const escolhidas = (candidatas ?? []).filter((c) => marcadas.has(c.id));
  const corrigido = escolhidas.reduce((s, c) => s + c.correctedCents, 0);
  const plano = useMemo(
    () => planRenegotiation({ correctedTotal: corrigido, discount: desconto, downPayment: entrada, installments: parcelas, monthlyInterestPercent: juros ?? 0, mode: modo, firstDueDate: primeiro as Day, interval: intervalo === 'monthly' ? { kind: 'monthly' } : { kind: 'days', days: dias } }),
    [corrigido, desconto, entrada, parcelas, juros, modo, primeiro, intervalo, dias],
  );
  const formas = options.methods.filter((m) => m.kind !== 'WALLET' && m.usage !== 'PAY');
  const acimaDoLimite = corrigido > 0 && (desconto / corrigido) * 100 > defaults.discountLimitPercent + 1e-9;

  const confirmar = () =>
    start(async () => {
      setErro('');
      const r = await renegotiateAction({
        titleIds: escolhidas.map((c) => c.id),
        discountCents: desconto,
        downPaymentCents: entrada,
        downPaymentDate: entrada > 0 ? entradaDia : null,
        downPaymentMethodId: entrada > 0 && entradaForma ? entradaForma : null,
        installments: parcelas,
        interval: intervalo === 'monthly' ? { kind: 'monthly' } : { kind: 'days', days: dias },
        firstDueDate: primeiro,
        monthlyInterestPercent: juros ?? 0,
        mode: modo,
        chargeLate: cobraAtraso,
      });
      if (!r.ok) return setErro(r.message);
      setFeito({ code: r.code, receiptGroupId: r.receiptGroupId });
      setPasso(3);
      onDone(`Renegociação nº ${r.code} feita.`);
    });

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={passo === 3 ? 'Renegociação feita' : `Nova renegociação · passo ${passo} de 2`} description={paciente?.name} size="lg">
      {passo === 1 && (
        <div className="space-y-4">
          {!initialPatient && <PatientPicker value={paciente} onChange={(p) => (setPaciente(p), setMarcadas(new Set()))} />}
          {defaults.lateChargesEnabled && (
            <Toggle label="Cobrar multa e juros das vencidas" hint={defaults.manager ? undefined : 'Só dono ou administrador tira a multa e os juros.'} checked={cobraAtraso} disabled={!defaults.manager} onChange={setCobraAtraso} />
          )}
          {paciente && candidatas === null && <p className="text-sm text-muted-foreground">Carregando as contas…</p>}
          {candidatas && candidatas.length === 0 && <p className="text-sm text-muted-foreground">Este paciente não tem contas em aberto.</p>}
          {candidatas && candidatas.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">Contas em aberto do paciente</caption>
                <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-8 px-3 py-2">
                      <input type="checkbox" aria-label="Marcar todas" className="h-4 w-4" checked={candidatas.every((c) => marcadas.has(c.id))} onChange={(e) => setMarcadas(e.target.checked ? new Set(candidatas.map((c) => c.id)) : new Set())} />
                    </th>
                    <th scope="col" className="px-3 py-2">Conta</th>
                    <th scope="col" className="px-3 py-2">Vencimento</th>
                    <th scope="col" className="px-3 py-2 text-right">Em aberto</th>
                    <th scope="col" className="px-3 py-2 text-right">Multa e juros</th>
                    <th scope="col" className="px-3 py-2 text-right">Corrigido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {candidatas.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label={`Marcar a conta nº ${c.code}`} className="h-4 w-4" checked={marcadas.has(c.id)} onChange={(e) => setMarcadas((m) => { const n = new Set(m); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">nº {c.code}</span> {c.description}
                        {c.installment ? ` (${c.installment})` : ''}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {dayBR(c.dueDate)}
                        {c.daysLate > 0 && <span className="ml-1 text-xs text-destructive">{c.daysLate} dias</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCents(c.openCents)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCents(c.fineCents + c.interestCents)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCents(c.correctedCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">
              Total corrigido: <strong className="tabular-nums">{formatCents(corrigido)}</strong>
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-outline btn-md">
                Cancelar
              </button>
              <button type="button" disabled={!escolhidas.length} onClick={() => setPasso(2)} className="btn-primary btn-md">
                Negociar
              </button>
            </div>
          </div>
        </div>
      )}

      {passo === 2 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirmar();
          }}
        >
          <p className="text-sm">
            {escolhidas.length} conta(s) · total corrigido <strong className="tabular-nums">{formatCents(corrigido)}</strong>
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Desconto" hint={`Seu limite: ${String(defaults.discountLimitPercent).replace('.', ',')}%`}>{(id) => <MoneyInput id={id} value={desconto} onChange={setDesconto} />}</Field>
            <Field label="Entrada">{(id) => <MoneyInput id={id} value={entrada} onChange={setEntrada} />}</Field>
            {entrada > 0 && <Field label="Data da entrada">{(id) => <input id={id} type="date" min={today} value={entradaDia} onChange={(e) => setEntradaDia(e.target.value)} className={inputCls} />}</Field>}
            {entrada > 0 && entradaDia === today && (
              <Field label="Entrada paga agora com" hint="Em branco, a entrada fica em aberto para receber depois.">
                {(id) => (
                  <select id={id} value={entradaForma} onChange={(e) => setEntradaForma(e.target.value)} className={inputCls}>
                    <option value="">Receber depois</option>
                    {formas.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label="Parcelas">{(id) => <input id={id} type="number" min={1} max={60} value={parcelas} onChange={(e) => setParcelas(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} className={inputCls} />}</Field>
            <Field label="Intervalo">
              {(id) => (
                <select id={id} value={intervalo} onChange={(e) => setIntervalo(e.target.value as typeof intervalo)} className={inputCls}>
                  <option value="monthly">Todo mês</option>
                  <option value="days">A cada tantos dias</option>
                </select>
              )}
            </Field>
            {intervalo === 'days' && <Field label="Dias">{(id) => <input id={id} type="number" min={1} max={365} value={dias} onChange={(e) => setDias(Math.max(1, Number(e.target.value) || 1))} className={inputCls} />}</Field>}
            <Field label="Primeiro vencimento">{(id) => <input id={id} type="date" min={today} value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} className={inputCls} />}</Field>
            <Field label="Juros ao mês (%)" hint={defaults.manager ? undefined : 'Definido pela clínica.'}>{(id) => <PercentInput id={id} value={juros} onChange={setJuros} disabled={!defaults.manager} />}</Field>
            <Field label="Cálculo dos juros">
              {(id) => (
                <select id={id} value={modo} disabled={!defaults.manager} onChange={(e) => setModo(e.target.value as typeof modo)} className={inputCls}>
                  <option value="SIMPLE">Simples</option>
                  <option value="PRICE">Tabela Price</option>
                </select>
              )}
            </Field>
          </div>

          {plano.ok ? (
            <div className="rounded-lg border border-border">
              <p className="border-b border-border bg-surface-alt/60 px-3 py-2 text-sm">
                Total a receber: <strong className="tabular-nums">{formatCents(plano.total)}</strong>
                {plano.interest > 0 && <span className="text-muted-foreground"> (juros de {formatCents(plano.interest)})</span>}
              </p>
              <ul className="max-h-48 divide-y divide-border overflow-y-auto text-sm">
                {entrada > 0 && (
                  <li className="flex justify-between px-3 py-1.5">
                    <span>Entrada · {dayBR(entradaDia as Day)}</span>
                    <span className="tabular-nums">{formatCents(entrada)}</span>
                  </li>
                )}
                {plano.lines.map((l) => (
                  <li key={l.number} className="flex justify-between px-3 py-1.5">
                    <span>
                      Parcela {l.number} · {dayBR(l.dueDate)}
                    </span>
                    <span className="tabular-nums">{formatCents(l.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-destructive">{plano.message}</p>
          )}
          {acimaDoLimite && <p className="text-sm text-destructive">Este desconto passa do seu limite. Peça a um dono ou administrador.</p>}
          <ErrorText>{erro}</ErrorText>
          <div className="flex justify-between gap-2">
            <button type="button" onClick={() => setPasso(1)} className="btn-ghost btn-md">
              Voltar
            </button>
            <button type="submit" disabled={pending || !plano.ok || acimaDoLimite} className="btn-primary btn-md">
              {pending ? 'Renegociando…' : 'Confirmar renegociação'}
            </button>
          </div>
        </form>
      )}

      {passo === 3 && feito && (
        <div className="space-y-4">
          <p className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            Renegociação nº {feito.code} feita. As contas antigas ficaram como renegociadas e as novas já estão em Contas a receber.
          </p>
          <div className="flex justify-between gap-2">
            {feito.receiptGroupId ? (
              <a href={`/financeiro/recibo/${feito.receiptGroupId}`} target="_blank" rel="noopener" className="btn-outline btn-md inline-flex items-center gap-1.5">
                <FileDown className="h-4 w-4" aria-hidden="true" /> Recibo da entrada
              </a>
            ) : (
              <span />
            )}
            <button type="button" onClick={onClose} className="btn-primary btn-md">
              Fechar
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

