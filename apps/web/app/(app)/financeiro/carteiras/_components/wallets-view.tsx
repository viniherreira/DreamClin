'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { FileDown, Plus } from 'lucide-react';
import { Modal } from '@/components/fin/ui';
import { WalletDialog } from '@/components/fin/wallet-dialog';
import type { FinOptions } from '@/app/(app)/financeiro/contas/_components/types';
import type { WalletRow, WalletStatementLine } from '@/fin/wallet';
import type { Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { CLINIC_TZ } from '@/lib/tz';
import { walletListAction, walletStatementAction } from '../../f5-actions';

/**
 * Carteiras: o crédito que cada paciente tem na clínica. O saldo positivo é
 * dinheiro que a clínica deve ao paciente até ele usar ou receber de volta.
 */
export function WalletsView({ options, today, canReceive, canPay }: { options: FinOptions; today: Day; canReceive: boolean; canPay: boolean }) {
  const [filtro, setFiltro] = useState<'with' | 'without' | 'all'>('with');
  const [busca, setBusca] = useState('');
  const [rows, setRows] = useState<WalletRow[] | null>(null);
  const [dialogo, setDialogo] = useState<{ mode: 'credit' | 'refund'; row: WalletRow | null } | null>(null);
  const [extrato, setExtrato] = useState<WalletRow | null>(null);
  const [, start] = useTransition();

  const carregar = useCallback(() => start(async () => setRows(await walletListAction(filtro, busca))), [filtro, busca]);
  useEffect(() => {
    const t = setTimeout(carregar, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);

  const lista = rows ?? [];
  const total = (k: 'creditsCents' | 'debitsCents' | 'balanceCents') => lista.reduce((s, r) => s + r[k], 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div role="radiogroup" aria-label="Mostrar" className="inline-flex rounded-lg bg-surface-alt p-1">
            {(
              [
                ['with', 'Com saldo'],
                ['without', 'Sem saldo'],
                ['all', 'Todas'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={filtro === v} onClick={() => setFiltro(v)} className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${filtro === v ? 'bg-surface shadow-sm' : 'text-muted-foreground'}`}>
                {l}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="cart-busca" className="sr-only">
              Buscar paciente
            </label>
            <input id="cart-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar paciente…" maxLength={80} className="h-9 w-56 rounded-lg border border-border bg-surface px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
          </div>
        </div>
        {canReceive && (
          <button type="button" onClick={() => setDialogo({ mode: 'credit', row: null })} className="btn-primary btn-md inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar crédito
          </button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Carteiras dos pacientes</caption>
          <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5">Paciente</th>
              <th scope="col" className="px-3 py-2.5">Último movimento</th>
              <th scope="col" className="px-3 py-2.5 text-right">Créditos</th>
              <th scope="col" className="px-3 py-2.5 text-right">Débitos</th>
              <th scope="col" className="px-3 py-2.5 text-right">Saldo</th>
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows === null ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            ) : lista.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {filtro === 'with' ? 'Nenhum paciente com crédito na carteira.' : 'Nenhuma carteira encontrada.'}
                </td>
              </tr>
            ) : (
              lista.map((r) => (
                <tr key={r.patientId} className="hover:bg-surface-alt/40">
                  <td className="px-3 py-2">
                    <Link href={`/pacientes/${r.patientId}?aba=financeiro`} className="font-medium hover:underline">
                      {r.patientName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{new Date(r.lastAt).toLocaleDateString('pt-BR', { timeZone: CLINIC_TZ })}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.creditsCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.debitsCents)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCents(r.balanceCents)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button type="button" onClick={() => setExtrato(r)} className="btn-ghost btn-sm" aria-label={`Extrato de ${r.patientName}`}>
                      Extrato
                    </button>
                    {canReceive && (
                      <button type="button" onClick={() => setDialogo({ mode: 'credit', row: r })} className="btn-ghost btn-sm" aria-label={`Adicionar crédito para ${r.patientName}`}>
                        Crédito
                      </button>
                    )}
                    {canPay && r.balanceCents > 0 && (
                      <button type="button" onClick={() => setDialogo({ mode: 'refund', row: r })} className="btn-outline btn-sm" aria-label={`Devolver crédito de ${r.patientName}`}>
                        Devolver
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {lista.length > 0 && (
            <tfoot className="border-t border-border bg-surface-alt/40">
              <tr>
                <td colSpan={2} className="px-3 py-2 font-medium">
                  Total
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCents(total('creditsCents'))}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCents(total('debitsCents'))}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCents(total('balanceCents'))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">O saldo das carteiras é dinheiro que a clínica deve aos pacientes, até eles usarem o crédito ou receberem de volta.</p>

      {dialogo && (
        <WalletDialog
          mode={dialogo.mode}
          patient={dialogo.row ? { id: dialogo.row.patientId, name: dialogo.row.patientName } : null}
          balanceCents={dialogo.row?.balanceCents}
          options={options}
          today={today}
          onClose={() => setDialogo(null)}
          onDone={carregar}
        />
      )}
      {extrato && <ExtratoDialog row={extrato} onClose={() => setExtrato(null)} />}
    </div>
  );
}

export function ExtratoDialog({ row, onClose }: { row: { patientId: string; patientName: string }; onClose: () => void }) {
  const [d, setD] = useState<{ balanceCents: number; lines: WalletStatementLine[] } | null>(null);
  useEffect(() => {
    void walletStatementAction(row.patientId).then(setD);
  }, [row.patientId]);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Extrato da carteira" description={row.patientName} size="lg">
      {!d ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <WalletStatementList data={d} />
      )}
    </Modal>
  );
}

export function WalletStatementList({ data }: { data: { balanceCents: number; lines: WalletStatementLine[] } }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Saldo: <strong className="tabular-nums">{formatCents(data.balanceCents)}</strong>
      </p>
      {data.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum movimento na carteira.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {data.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="tabular-nums text-muted-foreground">{new Date(l.at).toLocaleDateString('pt-BR', { timeZone: CLINIC_TZ })}</span>
              <span className="min-w-0 flex-1 truncate">
                {l.reasonLabel}
                {l.description && l.description !== l.reasonLabel ? ` · ${l.description}` : ''}
              </span>
              <span className={`tabular-nums font-semibold ${l.amountCents < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'}`}>{formatCents(l.amountCents)}</span>
              {l.receiptGroupId && (
                <a href={`/financeiro/recibo/${l.receiptGroupId}`} target="_blank" rel="noopener" aria-label="Recibo do crédito" className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  <FileDown className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
