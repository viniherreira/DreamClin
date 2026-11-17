'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, FileDown } from 'lucide-react';
import { addCreditAction, refundCreditAction } from '@/app/(app)/financeiro/f5-actions';
import type { FinOptions } from '@/app/(app)/financeiro/contas/_components/types';
import type { Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { PatientPicker } from './patient-picker';
import { ErrorText, Field, inputCls, Modal, MoneyInput } from './ui';

/**
 * Adicionar crédito na carteira do paciente (entra dinheiro, sai recibo) ou
 * devolver crédito (sai dinheiro, até o saldo).
 */
export function WalletDialog({
  mode,
  patient,
  balanceCents,
  options,
  today,
  onClose,
  onDone,
}: {
  mode: 'credit' | 'refund';
  patient?: { id: string; name: string } | null;
  balanceCents?: number;
  options: FinOptions;
  today: Day;
  onClose: () => void;
  onDone: () => void;
}) {
  const credito = mode === 'credit';
  const [paciente, setPaciente] = useState(patient ?? null);
  const formas = options.methods.filter((m) => m.kind !== 'WALLET' && (m.usage === 'BOTH' || m.usage === (credito ? 'RECEIVE' : 'PAY')));
  const [methodId, setMethodId] = useState(formas.find((m) => m.kind === (credito ? 'PIX' : 'CASH'))?.id ?? formas[0]?.id ?? '');
  const [valor, setValor] = useState(credito ? 0 : (balanceCents ?? 0));
  const [dia, setDia] = useState<string>(today);
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState('');
  const [recibo, setRecibo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const salvar = () =>
    start(async () => {
      setErro('');
      if (!paciente) return setErro('Escolha o paciente.');
      const input = { patientId: paciente.id, amountCents: valor, methodId, paidOn: dia, description: nota || null };
      if (credito) {
        const r = await addCreditAction(input);
        if (!r.ok) return setErro(r.message);
        setRecibo(r.receiptGroupId);
        onDone();
        return;
      }
      const r = await refundCreditAction(input);
      if (!r.ok) return setErro(r.message);
      onDone();
      onClose();
    });

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={recibo ? 'Crédito adicionado' : credito ? 'Adicionar crédito na carteira' : 'Devolver crédito'} description={paciente?.name}>
      {recibo ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> {formatCents(valor)} guardados na carteira.
          </p>
          <div className="flex justify-between gap-2">
            <a href={`/financeiro/recibo/${recibo}`} target="_blank" rel="noopener" className="btn-outline btn-md inline-flex items-center gap-1.5">
              <FileDown className="h-4 w-4" aria-hidden="true" /> Recibo
            </a>
            <button type="button" onClick={onClose} className="btn-primary btn-md">
              Fechar
            </button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          {!patient && <PatientPicker value={paciente} onChange={setPaciente} />}
          {!credito && balanceCents != null && <p className="text-sm text-muted-foreground">Saldo na carteira: {formatCents(balanceCents)}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Valor">{(id) => <MoneyInput id={id} value={valor} onChange={setValor} />}</Field>
            <Field label={credito ? 'Como o paciente pagou' : 'Como vai devolver'}>
              {(id) => (
                <select id={id} value={methodId} onChange={(e) => setMethodId(e.target.value)} className={inputCls}>
                  {formas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Data">{(id) => <input id={id} type="date" max={today} value={dia} onChange={(e) => setDia(e.target.value)} className={inputCls} />}</Field>
            <Field label="Observação (opcional)">{(id) => <input id={id} maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls} />}</Field>
          </div>
          <ErrorText>{erro}</ErrorText>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-outline btn-md">
              Cancelar
            </button>
            <button type="submit" disabled={pending || valor <= 0} className="btn-primary btn-md">
              {pending ? 'Salvando…' : credito ? `Adicionar ${formatCents(valor)}` : `Devolver ${formatCents(valor)}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
