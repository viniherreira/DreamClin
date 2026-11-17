'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Ban, Download, Receipt, Undo2, Wallet } from 'lucide-react';
import { Badge, ErrorText, Field, inputCls, Modal } from '@/components/fin/ui';
import { SettleDialog } from '@/components/fin/settle-dialog';
import type { ToBillRow } from '@/fin/to-bill';
import { addDays, type Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { wallClockTime, wallDateBR } from '@/lib/tz';
import { billAppointmentAction, discardReceiveAction, noChargeAction, receiveAppointmentAction, undoNoChargeAction } from '../../../agenda/finance-actions';
import { billBatchAction, listToBillAction } from '../actions';

/**
 * A faturar: os atendimentos com valor que ainda não viraram conta nem foram
 * recebidos. Abre no dia de hoje. Receber, Faturar e Não cobrar por linha, e
 * Faturar selecionados em lote.
 */

interface Options {
  professionals: { id: string; name: string }[];
  units: { id: string; name: string }[];
}

const TIPO = { PARTICULAR: 'Particular', CONVENIO: 'Convênio', CORTESIA: 'Cortesia' } as const;

export function ToBillView({ today, options, canReceive }: { today: Day; options: Options; canReceive: boolean }) {
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [professionalId, setProfessionalId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [type, setType] = useState<'' | 'PARTICULAR' | 'CONVENIO'>('');
  const [patient, setPatient] = useState('');
  const [withNoCharge, setWithNoCharge] = useState(false);
  const [data, setData] = useState<{ rows: ToBillRow[]; truncated: boolean } | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const [receber, setReceber] = useState<{ titleId: string; created: boolean; paid: boolean } | null>(null);
  const [faturar, setFaturar] = useState<string[] | null>(null);
  const [naoCobrar, setNaoCobrar] = useState<ToBillRow | null>(null);
  const [pending, start] = useTransition();
  const pedido = useRef(0);

  const carregar = useCallback(() => {
    const n = ++pedido.current;
    start(async () => {
      const r = await listToBillAction({ from, to, professionalId: professionalId || undefined, unitId: unitId || undefined, type: type || undefined, patient: patient || undefined, withNoCharge });
      if (n === pedido.current) {
        setData(r);
        setMarcados(new Set());
      }
    });
  }, [from, to, professionalId, unitId, type, patient, withNoCharge]);

  useEffect(() => {
    const t = setTimeout(carregar, patient ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, patient]);

  const rows = data?.rows ?? [];
  const cobraveis = rows.filter((r) => r.billingStatus === 'TO_RECEIVE');
  const todos = cobraveis.length > 0 && cobraveis.every((r) => marcados.has(r.id));
  const soma = (k: 'patientCents' | 'insuranceCents') => rows.filter((r) => r.billingStatus === 'TO_RECEIVE').reduce((s, r) => s + r[k], 0);

  const abrirReceber = (r: ToBillRow) =>
    start(async () => {
      setErro('');
      const x = await receiveAppointmentAction(r.id);
      if (!x.ok) return setErro(`${r.patientName}: ${x.message}`);
      setReceber({ titleId: x.titleId, created: x.created, paid: false });
    });

  const fecharReceber = () =>
    start(async () => {
      if (receber?.created && !receber.paid) await discardReceiveAction(receber.titleId);
      setReceber(null);
      carregar();
    });

  const desfazer = (r: ToBillRow) =>
    start(async () => {
      const x = await undoNoChargeAction(r.id);
      if (!x.ok) return setErro(x.message);
      setAviso(`${r.patientName} voltou para a lista de cobrança.`);
      carregar();
    });

  const exportar = () => {
    const cab = ['Paciente', 'Data', 'Hora', 'Profissional', 'Procedimentos', 'Tipo', 'Valor do paciente', 'Valor do convênio', 'Situação'];
    const num = (c: number) => (c / 100).toFixed(2).replace('.', ',');
    const csv = [cab, ...rows.map((r) => [r.patientName, wallDateBR(r.startTime), wallClockTime(r.startTime), r.professionalName, r.procedures, TIPO[r.type], num(r.patientCents), num(r.insuranceCents), r.billingStatus === 'NO_CHARGE' ? 'Não cobrar' : 'A receber'])]
      .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `a-faturar-${from}-a-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="rounded-xl border border-border bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="De" className="w-40">{(id) => <input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />}</Field>
          <Field label="Até" className="w-40">{(id) => <input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />}</Field>
          <Field label="Profissional" className="w-48">
            {(id) => (
              <select id={id} value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} className={inputCls}>
                <option value="">Todos</option>
                {options.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {options.units.length > 1 && (
            <Field label="Unidade" className="w-44">
              {(id) => (
                <select id={id} value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputCls}>
                  <option value="">Todas</option>
                  {options.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Tipo" className="w-36">
            {(id) => (
              <select id={id} value={type} onChange={(e) => setType(e.target.value as typeof type)} className={inputCls}>
                <option value="">Todos</option>
                <option value="PARTICULAR">Particular</option>
                <option value="CONVENIO">Convênio</option>
              </select>
            )}
          </Field>
          <Field label="Paciente" className="w-48">{(id) => <input id={id} maxLength={80} value={patient} onChange={(e) => setPatient(e.target.value)} className={inputCls} />}</Field>
          <label className="inline-flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={withNoCharge} onChange={(e) => setWithNoCharge(e.target.checked)} /> Mostrar os de não cobrar
          </label>
          <button type="button" onClick={exportar} disabled={!rows.length} className="btn-outline btn-md ml-auto inline-flex items-center gap-1.5">
            <Download className="h-4 w-4" aria-hidden="true" /> Exportar
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {[
            ['Hoje', today, today],
            ['Ontem', addDays(today, -1), addDays(today, -1)],
            ['Últimos 7 dias', addDays(today, -6), today],
            ['Últimos 30 dias', addDays(today, -29), today],
          ].map(([rotulo, de, ate]) => (
            <button
              key={rotulo}
              type="button"
              onClick={() => {
                setFrom(de);
                setTo(ate);
              }}
              aria-pressed={from === de && to === ate}
              className={`rounded-full border px-2.5 py-1 font-medium focus-visible:outline-2 focus-visible:outline-ring ${from === de && to === ate ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      {marcados.size > 0 && canReceive && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <p>{marcados.size} atendimento(s) marcado(s)</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMarcados(new Set())} className="btn-ghost btn-sm">
              Desmarcar
            </button>
            <button type="button" onClick={() => setFaturar([...marcados])} className="btn-primary btn-sm">
              Faturar selecionados
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
        <table className="w-full min-w-[900px] text-sm">
          <caption className="sr-only">Atendimentos a faturar</caption>
          <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="w-8 px-3 py-2.5">
                {canReceive && cobraveis.length > 0 && <input type="checkbox" aria-label="Marcar todos os atendimentos" className="h-4 w-4" checked={todos} onChange={(e) => setMarcados(e.target.checked ? new Set(cobraveis.map((r) => r.id)) : new Set())} />}
              </th>
              <th scope="col" className="px-3 py-2.5">Paciente</th>
              <th scope="col" className="px-3 py-2.5">Data e hora</th>
              <th scope="col" className="px-3 py-2.5">Profissional</th>
              <th scope="col" className="px-3 py-2.5">Procedimentos</th>
              <th scope="col" className="px-3 py-2.5 text-right">Valor do paciente</th>
              <th scope="col" className="px-3 py-2.5 text-right">Valor do convênio</th>
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
                  Nada para faturar neste período. Os atendimentos com valor aparecem aqui até serem recebidos ou faturados.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-alt/40">
                  <td className="px-3 py-2">{canReceive && r.billingStatus === 'TO_RECEIVE' && <input type="checkbox" aria-label={`Marcar ${r.patientName}`} className="h-4 w-4" checked={marcados.has(r.id)} onChange={(e) => setMarcados((m) => { const n = new Set(m); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />}</td>
                  <td className="max-w-[14rem] px-3 py-2">
                    <Link href={`/pacientes/${r.patientId}`} className="block truncate font-medium hover:underline">
                      {r.patientName}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {TIPO[r.type]}
                      {r.insurerName ? ` · ${r.insurerName}` : ''}
                      {r.status === 'ATTENDED' ? ' · Atendido' : ''}
                      {r.unitName ? ` · ${r.unitName}` : ''}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {wallDateBR(r.startTime)} {wallClockTime(r.startTime)}
                  </td>
                  <td className="px-3 py-2">{r.professionalName}</td>
                  <td className="max-w-[16rem] px-3 py-2">
                    <p className="truncate">{r.procedures || 'Sem procedimento'}</p>
                    {r.billingStatus === 'NO_CHARGE' && (
                      <p className="truncate text-xs text-muted-foreground">
                        <Badge>Não cobrar</Badge> {r.noChargeReason}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{r.patientCents ? formatCents(r.patientCents) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{r.insuranceCents ? formatCents(r.insuranceCents) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {canReceive &&
                      (r.billingStatus === 'NO_CHARGE' ? (
                        <button type="button" onClick={() => desfazer(r)} disabled={pending} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Voltar a cobrar ${r.patientName}`}>
                          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Desfazer
                        </button>
                      ) : (
                        <div className="inline-flex gap-1">
                          <button type="button" onClick={() => abrirReceber(r)} disabled={pending} className="btn-outline btn-sm inline-flex items-center gap-1" aria-label={`Receber de ${r.patientName}`}>
                            <Wallet className="h-3.5 w-3.5" aria-hidden="true" /> Receber
                          </button>
                          <button type="button" onClick={() => setFaturar([r.id])} disabled={pending} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Faturar ${r.patientName}`}>
                            <Receipt className="h-3.5 w-3.5" aria-hidden="true" /> Faturar
                          </button>
                          <button type="button" onClick={() => setNaoCobrar(r)} disabled={pending} className="btn-ghost btn-sm inline-flex items-center gap-1" aria-label={`Não cobrar ${r.patientName}`}>
                            <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t border-border bg-surface-alt/40 text-sm">
              <tr>
                <td colSpan={5} className="px-3 py-2 font-medium">
                  Total a faturar
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCents(soma('patientCents'))}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCents(soma('insuranceCents'))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {data?.truncated && <p className="mt-2 text-xs text-muted-foreground">Mostrando os 500 primeiros. Diminua o período para ver o resto.</p>}

      {receber && (
        <SettleDialog
          titleId={receber.titleId}
          open
          onOpenChange={(o) => {
            if (!o) fecharReceber();
          }}
          onDone={() => setReceber((x) => (x ? { ...x, paid: true } : x))}
        />
      )}
      {faturar && (
        <FaturarDialog
          ids={faturar}
          today={today}
          onClose={() => setFaturar(null)}
          onDone={(texto) => {
            setAviso(texto);
            carregar();
          }}
        />
      )}
      {naoCobrar && (
        <NaoCobrarDialog
          row={naoCobrar}
          onClose={() => setNaoCobrar(null)}
          onDone={() => {
            setAviso(`${naoCobrar.patientName} saiu da lista de cobrança.`);
            carregar();
          }}
        />
      )}
    </div>
  );
}

function FaturarDialog({ ids, today, onClose, onDone }: { ids: string[]; today: Day; onClose: () => void; onDone: (texto: string) => void }) {
  const [vence, setVence] = useState<string>(addDays(today, 30));
  const [parcelas, setParcelas] = useState(1);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const um = ids.length === 1;
  const salvar = () =>
    start(async () => {
      setErro('');
      if (um) {
        const r = await billAppointmentAction({ appointmentId: ids[0], dueDate: vence, installments: parcelas });
        if (!r.ok) return setErro(r.message);
        onClose();
        return onDone(parcelas > 1 ? `Faturado em ${parcelas} parcelas.` : 'Faturado.');
      }
      const r = await billBatchAction({ ids, dueDate: vence });
      if (!r.ok) return setErro(r.message);
      onClose();
      onDone(`${r.done} faturado(s).${r.skipped.length ? ` ${r.skipped.length} ficaram de fora: ${r.skipped.map((s) => s.reason).join(' ')}` : ''}`);
    });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={um ? 'Faturar' : `Faturar ${ids.length} atendimentos`} description="Cria a conta a receber para pagar depois.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={parcelas > 1 ? 'Vencimento da 1ª parcela' : 'Vencimento'}>{(id) => <input id={id} type="date" min={today} value={vence} onChange={(e) => setVence(e.target.value)} className={inputCls} />}</Field>
          {um && <Field label="Parcelas">{(id) => <input id={id} type="number" min={1} max={24} value={parcelas} onChange={(e) => setParcelas(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} className={inputCls} />}</Field>}
        </div>
        <p className="text-xs text-muted-foreground">Convênio sem o convênio escolhido fica de fora: escolha o convênio na janela do agendamento.</p>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="btn-primary btn-md">
            {pending ? 'Faturando…' : 'Faturar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NaoCobrarDialog({ row, onClose, onDone }: { row: ToBillRow; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const salvar = () =>
    start(async () => {
      setErro('');
      const r = await noChargeAction(row.id, motivo);
      if (!r.ok) return setErro(r.message);
      onClose();
      onDone();
    });
  const quando = wallDateBR(row.startTime);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Não cobrar" description={`${row.patientName} · ${quando}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <Field label="Motivo" hint={`${motivo.length}/150`}>
          {(id) => <input id={id} required minLength={3} maxLength={150} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputCls} />}
        </Field>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline btn-md">
            Voltar
          </button>
          <button type="submit" disabled={pending || motivo.trim().length < 3} className="btn-primary btn-md">
            Não cobrar
          </button>
        </div>
      </form>
    </Modal>
  );
}
