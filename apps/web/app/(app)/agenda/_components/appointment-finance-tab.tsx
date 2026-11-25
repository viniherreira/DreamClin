'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Ban, Check, FileDown, Receipt, RotateCcw, Undo2, Wallet } from 'lucide-react';
import { Badge, ErrorText, Field, inputCls, Modal } from '@/components/fin/ui';
import { ReverseDialog } from '@/components/fin/reverse-dialog';
import { SettleDialog } from '@/components/fin/settle-dialog';
import type { AppointmentBillingDetail } from '@/fin/agenda-bridge';
import { addDays, dayBR, type Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { TITLE_STATUS_LABEL, type TitleDisplay } from '@/lib/financeiro/title-status';
import { appointmentBilling, billAppointmentAction, discardReceiveAction, noChargeAction, receiveAppointmentAction, undoNoChargeAction } from '../finance-actions';

import { DateField } from '@/components/ui/date-field';
/**
 * A aba Financeiro do agendamento: os procedimentos com valor, o que já foi
 * faturado e recebido, e os botões Receber, Faturar, Não cobrar e Recibo.
 * "Receber" cria a conta e abre a tela de recebimento num passo só; se a
 * pessoa fechar sem receber, a conta criada some.
 */

const TOM: Record<string, 'gray' | 'amber' | 'blue' | 'green'> = { NONE: 'gray', NO_CHARGE: 'gray', TO_RECEIVE: 'amber', BILLED: 'blue', PARTIAL: 'blue', PAID: 'green' };

export function AppointmentFinanceTab({ appointmentId, today, suggestReceive, onChanged }: { appointmentId: string; today: Day; suggestReceive?: boolean; onChanged: () => void }) {
  const [d, setD] = useState<AppointmentBillingDetail | null | undefined>(undefined);
  const [erro, setErro] = useState('');
  const [receber, setReceber] = useState<{ titleId: string; created: boolean; paid: boolean } | null>(null);
  const [faturar, setFaturar] = useState(false);
  const [naoCobrar, setNaoCobrar] = useState(false);
  const [estornar, setEstornar] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const carregar = useCallback(async () => setD(await appointmentBilling(appointmentId)), [appointmentId]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const depois = async () => {
    await carregar();
    onChanged();
  };

  const abrirReceber = () =>
    start(async () => {
      setErro('');
      const r = await receiveAppointmentAction(appointmentId);
      if (!r.ok) return setErro(r.message);
      setReceber({ titleId: r.titleId, created: r.created, paid: false });
    });

  const fecharReceber = () =>
    start(async () => {
      // Fechou sem receber nada: a conta que o "Receber" criou some.
      if (receber?.created && !receber.paid) await discardReceiveAction(receber.titleId);
      setReceber(null);
      await depois();
    });

  const desfazerNaoCobrar = () =>
    start(async () => {
      const r = await undoNoChargeAction(appointmentId);
      if (!r.ok) return setErro(r.message);
      await depois();
    });

  if (d === undefined) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (d === null) return <p className="text-sm text-muted-foreground">O financeiro deste agendamento fica com a recepção.</p>;

  const falta = d.unbilledCents + d.openCents;
  const ultimoRecibo = [...d.payments].reverse().find((p) => !p.isReversal && !p.reversed && p.receiptGroupId)?.receiptGroupId;
  const podeCobrar = d.can.receive && !d.noCharge && falta > 0;

  return (
    <div className="space-y-4">
      {suggestReceive && podeCobrar && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="flex-1 font-medium">Atendimento concluído. Ficaram {formatCents(falta)} para receber.</p>
          <button type="button" onClick={abrirReceber} disabled={pending} className="btn-primary btn-sm">
            Receber agora
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TOM[d.status]}>{d.statusLabel}</Badge>
        {d.type === 'CORTESIA' && <span className="text-sm text-muted-foreground">Cortesia: não gera cobrança.</span>}
        {d.type === 'CONVENIO' && <span className="text-sm text-muted-foreground">Convênio{d.insurer ? `: ${d.insurer.name}` : ' (escolha o convênio ao faturar)'}</span>}
      </div>

      {d.showPrices && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Numero label="Total dos procedimentos" valor={d.totalCents} />
          <Numero label="Recebido" valor={d.paidCents} tom="text-emerald-700 dark:text-emerald-400" />
          <Numero label="Faturado em aberto" valor={d.openCents} tom={d.openCents > 0 ? 'text-blue-700 dark:text-blue-300' : ''} />
          <Numero label="Sem faturar" valor={d.unbilledCents} tom={d.unbilledCents > 0 ? 'text-amber-700 dark:text-amber-300' : ''} />
        </div>
      )}

      {d.items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">Procedimentos do agendamento</caption>
            <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">Procedimento</th>
                <th scope="col" className="px-3 py-2 text-right">Qtd.</th>
                {d.showPrices && (
                  <th scope="col" className="px-3 py-2 text-right">
                    Valor
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-2">
                    {i.name}
                    {i.quoteItemId && <span className="ml-2 text-xs text-blue-700 dark:text-blue-300">Coberto pelo orçamento{i.quoteNumber ? ` ORC-${String(i.quoteNumber).padStart(4, '0')}` : ''}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.quantity}</td>
                  {d.showPrices && <td className="px-3 py-2 text-right tabular-nums">{i.quoteItemId ? '—' : formatCents(i.totalCents)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sem procedimento neste agendamento. Edite o agendamento para incluir os procedimentos e valores.</p>
      )}

      {d.noCharge && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-alt p-3 text-sm">
          <Ban className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <p className="flex-1">
            Marcado como <strong>não cobrar</strong>: {d.noCharge.reason}
            {d.noCharge.by ? ` (${d.noCharge.by})` : ''}.
          </p>
          {d.can.receive && (
            <button type="button" onClick={desfazerNaoCobrar} disabled={pending} className="btn-ghost btn-sm inline-flex items-center gap-1">
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Desfazer
            </button>
          )}
        </div>
      )}

      {d.titles.length > 0 && (
        <section aria-label="Contas deste agendamento">
          <h3 className="mb-2 text-sm font-semibold">Contas</h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {d.titles.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-mono text-xs font-semibold">nº {t.code}</span>
                <span className="text-muted-foreground">
                  vence {dayBR(t.dueDate)}
                  {t.installment ? ` · parcela ${t.installment}` : ''}
                </span>
                <span className="ml-auto tabular-nums">{formatCents(t.amountCents)}</span>
                <Badge tone={t.display === 'PAID' ? 'green' : t.display === 'OVERDUE' ? 'red' : t.display === 'CANCELLED' ? 'gray' : 'blue'}>{TITLE_STATUS_LABEL[t.display as TitleDisplay]}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.payments.length > 0 && (
        <section aria-label="Pagamentos deste agendamento">
          <h3 className="mb-2 text-sm font-semibold">Pagamentos</h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {d.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                {p.isReversal ? <RotateCcw className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
                <span className={p.reversed ? 'line-through' : ''}>
                  {dayBR(p.paidOn)} · {p.isReversal ? 'Estorno' : p.method}
                </span>
                <span className={`ml-auto tabular-nums ${p.reversed ? 'line-through' : ''} ${p.isReversal ? 'text-destructive' : ''}`}>{formatCents(p.isReversal ? -p.amountCents : p.amountCents)}</span>
                {!p.isReversal && p.receiptGroupId && (
                  <a href={`/financeiro/recibo/${p.receiptGroupId}`} target="_blank" rel="noopener" aria-label={`Recibo do pagamento de ${dayBR(p.paidOn)}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                    <FileDown className="h-4 w-4" aria-hidden="true" />
                  </a>
                )}
                {!p.isReversal && !p.reversed && d.can.reverse && (
                  <button type="button" onClick={() => setEstornar(p.id)} aria-label={`Estornar o pagamento de ${dayBR(p.paidOn)}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring">
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ErrorText>{erro}</ErrorText>

      <div className="flex flex-wrap gap-2">
        {podeCobrar && (
          <>
            <button type="button" onClick={abrirReceber} disabled={pending} className="btn-primary btn-sm inline-flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" aria-hidden="true" /> Receber {formatCents(falta)}
            </button>
            {d.unbilledCents > 0 && (
              <button type="button" onClick={() => setFaturar(true)} disabled={pending} className="btn-outline btn-sm inline-flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" aria-hidden="true" /> Faturar
              </button>
            )}
          </>
        )}
        {d.can.receive && !d.noCharge && d.billedCents === 0 && d.chargeableCents > 0 && (
          <button type="button" onClick={() => setNaoCobrar(true)} disabled={pending} className="btn-outline btn-sm inline-flex items-center gap-1.5">
            <Ban className="h-3.5 w-3.5" aria-hidden="true" /> Não cobrar
          </button>
        )}
        {ultimoRecibo && (
          <a href={`/financeiro/recibo/${ultimoRecibo}`} target="_blank" rel="noopener" className="btn-outline btn-sm inline-flex items-center gap-1.5">
            <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> Recibo
          </a>
        )}
      </div>

      {receber && (
        <SettleDialog
          titleId={receber.titleId}
          open
          onOpenChange={(o) => {
            if (!o) fecharReceber();
          }}
          onDone={() => setReceber((r) => (r ? { ...r, paid: true } : r))}
        />
      )}
      {faturar && <FaturarDialog appointmentId={appointmentId} today={today} detail={d} onClose={() => setFaturar(false)} onDone={depois} />}
      {naoCobrar && <NaoCobrarDialog appointmentId={appointmentId} onClose={() => setNaoCobrar(false)} onDone={depois} />}
      <ReverseDialog transactionId={estornar} open={Boolean(estornar)} onOpenChange={(o) => !o && setEstornar(null)} onDone={depois} />
    </div>
  );
}

function Numero({ label, valor, tom = '' }: { label: string; valor: number; tom?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${tom}`}>{formatCents(valor)}</p>
    </div>
  );
}

function FaturarDialog({ appointmentId, today, detail, onClose, onDone }: { appointmentId: string; today: Day; detail: AppointmentBillingDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [vence, setVence] = useState<string>(addDays(today, 30));
  const [parcelas, setParcelas] = useState(1);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const salvar = () =>
    start(async () => {
      setErro('');
      const r = await billAppointmentAction({ appointmentId, dueDate: vence, installments: parcelas });
      if (!r.ok) return setErro(r.message);
      onClose();
      await onDone();
    });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Faturar" description={`${formatCents(detail.unbilledCents)} para pagar depois.`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={parcelas > 1 ? 'Vencimento da 1ª parcela' : 'Vencimento'}>{(id) => <DateField id={id} min={today} value={vence} onChange={(v) => setVence(v)} className={inputCls} />}</Field>
          <Field label="Parcelas" hint={parcelas > 1 ? `${parcelas}x, uma por mês.` : undefined}>
            {(id) => <input id={id} type="number" min={1} max={24} value={parcelas} onChange={(e) => setParcelas(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} className={inputCls} />}
          </Field>
        </div>
        {detail.type === 'CONVENIO' && !detail.insurer && <p className="text-sm text-muted-foreground">Escolha o convênio na janela de editar o agendamento antes de faturar.</p>}
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

function NaoCobrarDialog({ appointmentId, onClose, onDone }: { appointmentId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const salvar = () =>
    start(async () => {
      setErro('');
      const r = await noChargeAction(appointmentId, motivo);
      if (!r.ok) return setErro(r.message);
      onClose();
      await onDone();
    });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Não cobrar" description="O agendamento sai da lista de A faturar. Dá para desfazer depois.">
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
