'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { ArrowRight, Plus, RotateCcw } from 'lucide-react';
import { Badge, ErrorText, Field, inputCls, Modal, MoneyInput } from '@/components/fin/ui';
import type { FinOptions } from '@/app/(app)/financeiro/contas/_components/types';
import type { TransferRow } from '@/fin/transfers';
import { addDays, dayBR, type Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { reverseTransferAction, transferAction, transferListAction } from '../../f5-actions';

/** Transferências entre contas (e as sangrias e reforços com conta), com estorno das duas pontas. */
export function TransfersView({ options, today, canTransfer, canReverse }: { options: FinOptions; today: Day; canTransfer: boolean; canReverse: boolean }) {
  const [from, setFrom] = useState<string>(addDays(today, -30));
  const [to, setTo] = useState<string>(today);
  const [conta, setConta] = useState('');
  const [rows, setRows] = useState<TransferRow[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [estornar, setEstornar] = useState<TransferRow | null>(null);
  const [aviso, setAviso] = useState('');
  const [, start] = useTransition();

  const carregar = useCallback(() => start(async () => setRows(await transferListAction(from, to, conta))), [from, to, conta]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="De" className="w-40">{(id) => <input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />}</Field>
          <Field label="Até" className="w-40">{(id) => <input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />}</Field>
          <Field label="Conta" className="w-48">
            {(id) => (
              <select id={id} value={conta} onChange={(e) => setConta(e.target.value)} className={inputCls}>
                <option value="">Todas</option>
                {options.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {canTransfer && (
          <button type="button" onClick={() => setNovo(true)} className="btn-primary btn-md inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" /> Nova transferência
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className={aviso ? 'mt-3 rounded-lg bg-surface-alt px-3 py-2 text-sm' : 'sr-only'}>
        {aviso}
      </p>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[680px] text-sm">
          <caption className="sr-only">Transferências entre contas</caption>
          <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5">Data</th>
              <th scope="col" className="px-3 py-2.5">De → Para</th>
              <th scope="col" className="px-3 py-2.5">Descrição</th>
              <th scope="col" className="px-3 py-2.5 text-right">Valor</th>
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows === null ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma transferência neste período.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.transferId} className={r.reversed ? 'text-muted-foreground' : ''}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dayBR(r.date)}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      {r.fromName} <ArrowRight className="h-3.5 w-3.5" aria-label="para" /> {r.toName}
                    </span>
                    {r.fromCash && <span className="ml-2 text-xs text-muted-foreground">pelo caixa</span>}
                    {r.reversed && (
                      <span className="ml-2">
                        <Badge>Estornada</Badge>
                      </span>
                    )}
                  </td>
                  <td className="max-w-[18rem] truncate px-3 py-2">{r.description}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${r.reversed ? 'line-through' : ''}`}>{formatCents(r.amountCents)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {canReverse && !r.reversed && (
                      <button type="button" onClick={() => setEstornar(r)} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Estornar a transferência de ${dayBR(r.date)}`}>
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Estornar
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
        <NovaTransferencia
          options={options}
          today={today}
          onClose={() => setNovo(false)}
          onDone={() => {
            setAviso('Transferência registrada.');
            carregar();
          }}
        />
      )}
      {estornar && (
        <EstornarTransferencia
          row={estornar}
          onClose={() => setEstornar(null)}
          onDone={() => {
            setAviso('Transferência estornada nas duas contas.');
            carregar();
          }}
        />
      )}
    </div>
  );
}

function NovaTransferencia({ options, today, onClose, onDone }: { options: FinOptions; today: Day; onClose: () => void; onDone: () => void }) {
  const [de, setDe] = useState(options.accounts[0]?.id ?? '');
  const [para, setPara] = useState(options.accounts[1]?.id ?? '');
  const [valor, setValor] = useState(0);
  const [dia, setDia] = useState<string>(today);
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const salvar = () =>
    start(async () => {
      setErro('');
      const r = await transferAction({ fromAccountId: de, toAccountId: para, amountCents: valor, date: dia, description: nota || null });
      if (!r.ok) return setErro(r.message);
      onClose();
      onDone();
    });
  const opcoes = options.accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name}
    </option>
  ));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Nova transferência" description="Sai de uma conta e entra na outra.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Conta de origem">{(id) => <select id={id} value={de} onChange={(e) => setDe(e.target.value)} className={inputCls}>{opcoes}</select>}</Field>
          <Field label="Conta de destino">{(id) => <select id={id} value={para} onChange={(e) => setPara(e.target.value)} className={inputCls}>{opcoes}</select>}</Field>
          <Field label="Valor">{(id) => <MoneyInput id={id} value={valor} onChange={setValor} />}</Field>
          <Field label="Data">{(id) => <input id={id} type="date" max={today} value={dia} onChange={(e) => setDia(e.target.value)} className={inputCls} />}</Field>
          <Field label="Descrição (opcional)" className="sm:col-span-2">{(id) => <input id={id} maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls} />}</Field>
        </div>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending || valor <= 0 || de === para} className="btn-primary btn-md">
            {pending ? 'Salvando…' : 'Transferir'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EstornarTransferencia({ row, onClose, onDone }: { row: TransferRow; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const salvar = () =>
    start(async () => {
      setErro('');
      const r = await reverseTransferAction(row.outId, motivo);
      if (!r.ok) return setErro(r.message);
      onClose();
      onDone();
    });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Estornar transferência" description={`${row.fromName} → ${row.toName} · ${formatCents(row.amountCents)}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <Field label="Motivo" hint={`${motivo.length}/150`}>{(id) => <input id={id} required minLength={3} maxLength={150} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputCls} />}</Field>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline btn-md">
            Voltar
          </button>
          <button type="submit" disabled={pending || motivo.trim().length < 3} className="btn-danger btn-md">
            Estornar
          </button>
        </div>
      </form>
    </Modal>
  );
}
