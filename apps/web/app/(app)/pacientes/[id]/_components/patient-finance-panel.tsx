'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Check, FileDown, Plus, RotateCcw, Wallet } from 'lucide-react';
import { Badge } from '@/components/fin/ui';
import { ReverseDialog } from '@/components/fin/reverse-dialog';
import { SettleDialog } from '@/components/fin/settle-dialog';
import { NewTitleDialog } from '@/app/(app)/financeiro/contas/_components/new-title-dialog';
import type { FinOptions } from '@/app/(app)/financeiro/contas/_components/types';
import { dayBR, type Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { TITLE_STATUS_LABEL } from '@/lib/financeiro/title-status';
import { patientFinance, type PatientFinance } from '../finance-actions';
import { WalletDialog } from '@/components/fin/wallet-dialog';
import { WalletStatementList } from '@/app/(app)/financeiro/carteiras/_components/wallets-view';
import { walletStatementAction } from '@/app/(app)/financeiro/f5-actions';

/**
 * Ficha do paciente › Financeiro (financeiro completo): devendo, vencido e
 * pago no ano no topo; as contas dele com "Receber"; os pagamentos com recibo
 * e estorno; e o saldo da carteira.
 */
export function PatientFinancePanel({ patient, options, today, advanced }: { patient: { id: string; name: string }; options: FinOptions | null; today: Day; advanced: boolean }) {
  const [d, setD] = useState<PatientFinance | null | undefined>(undefined);
  const [receber, setReceber] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [estornar, setEstornar] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [carteira, setCarteira] = useState<'credit' | 'refund' | null>(null);
  const [extrato, setExtrato] = useState<Awaited<ReturnType<typeof walletStatementAction>>>(null);

  const carregar = useCallback(async () => {
    const [f, e] = await Promise.all([patientFinance(patient.id), walletStatementAction(patient.id)]);
    setD(f);
    setExtrato(e);
  }, [patient.id]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (d === undefined) return <p className="p-4 text-sm text-muted-foreground">Carregando…</p>;
  if (d === null) return <p className="p-4 text-sm text-muted-foreground">Sem acesso ao financeiro deste paciente.</p>;

  const abertas = d.titles.filter((t) => t.openCents > 0);
  const fechadas = d.titles.filter((t) => t.openCents === 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Numero label="Devendo" valor={d.owingCents} tom={d.owingCents > 0 ? 'text-amber-700 dark:text-amber-300' : ''} />
        <Numero label="Vencido" valor={d.overdueCents} tom={d.overdueCents > 0 ? 'text-red-700 dark:text-red-400' : ''} />
        <Numero label="Pago neste ano" valor={d.paidThisYearCents} tom="text-emerald-700 dark:text-emerald-400" />
        <Numero label="Crédito na carteira" valor={d.walletCents} />
      </div>

      <div className="flex flex-wrap gap-2">
        {d.can.receive && options && (
          <button type="button" onClick={() => setNovo(true)} className="btn-outline btn-sm inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Nova conta
          </button>
        )}
        {d.can.receive && options && (
          <button type="button" onClick={() => setCarteira('credit')} className="btn-outline btn-sm">
            Adicionar crédito
          </button>
        )}
        {d.walletCents > 0 && options && (
          <button type="button" onClick={() => setCarteira('refund')} className="btn-ghost btn-sm">
            Devolver crédito
          </button>
        )}
        {d.owingCents > 0 && (
          <Link href={`/financeiro/renegociacoes?paciente=${patient.id}`} className="btn-ghost btn-sm">
            Renegociar
          </Link>
        )}
        <Link href={`/orcamentos/novo?patientId=${patient.id}`} className="btn-ghost btn-sm">
          Novo orçamento
        </Link>
      </div>
      <p role="status" aria-live="polite" className={aviso ? 'rounded-lg bg-surface-alt px-3 py-2 text-sm' : 'sr-only'}>
        {aviso}
      </p>

      <section aria-label="Contas em aberto">
        <h3 className="mb-2 text-sm font-semibold">Em aberto</h3>
        {abertas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada em aberto.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {abertas.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {t.originHref ? (
                      <Link href={t.originHref} className="hover:underline">
                        {t.description}
                      </Link>
                    ) : (
                      t.description
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    nº {t.code} · vence {dayBR(t.dueDate)}
                    {t.installment ? ` · parcela ${t.installment}` : ''}
                  </p>
                </div>
                <Badge tone={t.display === 'OVERDUE' ? 'red' : 'blue'}>{TITLE_STATUS_LABEL[t.display]}</Badge>
                <span className="w-28 text-right font-semibold tabular-nums">{formatCents(t.openCents)}</span>
                {d.can.receive && (
                  <button type="button" onClick={() => setReceber(t.id)} className="btn-primary btn-sm inline-flex items-center gap-1" aria-label={`Receber a conta nº ${t.code}`}>
                    <Wallet className="h-3.5 w-3.5" aria-hidden="true" /> Receber
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {fechadas.length > 0 && (
        <section aria-label="Contas pagas">
          <h3 className="mb-2 text-sm font-semibold">Pagas</h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {fechadas.slice(0, 30).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{t.description}</span>
                <span className="text-xs text-muted-foreground">nº {t.code}</span>
                <Badge tone={t.display === 'PAID' ? 'green' : 'gray'}>{TITLE_STATUS_LABEL[t.display]}</Badge>
                <span className="w-28 text-right tabular-nums">{formatCents(t.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.payments.length > 0 && (
        <section aria-label="Pagamentos do paciente">
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

      {extrato && extrato.lines.length > 0 && (
        <section aria-label="Carteira do paciente">
          <h3 className="mb-2 text-sm font-semibold">Carteira</h3>
          <WalletStatementList data={extrato} />
        </section>
      )}

      {carteira && options && (
        <WalletDialog
          mode={carteira}
          patient={patient}
          balanceCents={d.walletCents}
          options={options}
          today={today}
          onClose={() => setCarteira(null)}
          onDone={() => void carregar()}
        />
      )}

      <SettleDialog
        titleId={receber}
        open={Boolean(receber)}
        onOpenChange={(o) => {
          if (!o) {
            setReceber(null);
            void carregar();
          }
        }}
      />
      {options && novo && (
        <NewTitleDialog
          open={novo}
          onOpenChange={setNovo}
          options={options}
          today={today}
          advanced={advanced}
          initialDirection="RECEIVABLE"
          patient={patient}
          onSaved={(n) => {
            setAviso(n > 1 ? `${n} contas criadas.` : 'Conta criada.');
            void carregar();
          }}
        />
      )}
      <ReverseDialog transactionId={estornar} open={Boolean(estornar)} onOpenChange={(o) => !o && setEstornar(null)} onDone={() => void carregar()} />
    </div>
  );
}

function Numero({ label, valor, tom = '' }: { label: string; valor: number; tom?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tom}`}>{formatCents(valor)}</p>
    </div>
  );
}
