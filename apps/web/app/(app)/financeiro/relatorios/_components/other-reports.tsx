'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { FileSpreadsheet, MessageCircle } from 'lucide-react';
import { HideValues, money, PeriodPicker } from '@/components/fin/report-ui';
import { PlanLock } from '@/components/fin/ui';
import type { AgingRow } from '@/fin/reports';
import { dayBR, type Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { presetRange } from '@/lib/financeiro/reports';
import { downloadXlsx } from '@/lib/xlsx';
import { agingAction, costCentersAction, proceduresAction } from '../actions';

/** Inadimplência: quem deve, há quanto tempo, em faixas, com cobrança pelo WhatsApp. */
export function AgingView({ clinicName, canExport }: { clinicName: string; canExport: boolean }) {
  const [d, setD] = useState<{ rows: AgingRow[]; totals: AgingRow['buckets']; total: number } | null | undefined>(undefined);
  const [mostrar, setMostrar] = useState(true);
  useEffect(() => {
    void agingAction().then(setD);
  }, []);
  const v = money(mostrar);
  if (d === undefined) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (d === null) return <p className="text-sm text-muted-foreground">Sem acesso.</p>;
  const faixas = ['1-30', '31-60', '61-90', '90+'] as const;
  const mensagem = (r: AgingRow) =>
    `Olá, ${r.name.split(' ')[0]}! Aqui é da ${clinicName}. Consta em aberto conosco o valor de ${formatCents(r.overdueCents)}, vencido desde ${dayBR(r.oldestDue)}. Podemos combinar o pagamento? Se já pagou, desconsidere esta mensagem.`;
  const exportar = () =>
    downloadXlsx('inadimplencia', [{ name: 'Inadimplência', rows: [['Cliente', 'Contas', 'Em atraso', '1 a 30 dias', '31 a 60', '61 a 90', 'Mais de 90', 'Maior atraso (dias)', 'Vencida desde'], ...d.rows.map((r) => [r.name, r.titles, r.overdueCents / 100, ...faixas.map((f) => r.buckets[f] / 100), r.maxDaysLate, dayBR(r.oldestDue)])], moneyColumns: [2, 3, 4, 5, 6] }]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex flex-wrap gap-2 text-sm">
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <dt className="text-xs text-muted-foreground">Total vencido</dt>
            <dd className="font-semibold tabular-nums">{v(d.total)}</dd>
          </div>
          {faixas.map((f) => (
            <div key={f} className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">{f === '90+' ? 'Mais de 90 dias' : `${f.replace('-', ' a ')} dias`}</dt>
              <dd className="font-semibold tabular-nums">{v(d.totals[f])}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center gap-2">
          <HideValues shown={mostrar} onToggle={() => setMostrar((x) => !x)} />
          {canExport && (
            <button type="button" onClick={exportar} className="btn-outline btn-sm inline-flex items-center gap-1.5">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> XLSX
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[820px] text-sm">
          <caption className="sr-only">Clientes com contas vencidas</caption>
          <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5">Cliente</th>
              <th scope="col" className="px-3 py-2.5 text-right">Em atraso</th>
              {faixas.map((f) => (
                <th key={f} scope="col" className="px-3 py-2.5 text-right">
                  {f === '90+' ? '+90' : f}
                </th>
              ))}
              <th scope="col" className="px-3 py-2.5 text-right">Maior atraso</th>
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Ninguém com conta vencida.
                </td>
              </tr>
            ) : (
              d.rows.map((r) => (
                <tr key={r.key} className="hover:bg-surface-alt/40">
                  <td className="px-3 py-2">
                    {r.patientId ? (
                      <Link href={`/pacientes/${r.patientId}?aba=financeiro`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                    <p className="text-xs text-muted-foreground">{r.titles} conta(s)</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{v(r.overdueCents)}</td>
                  {faixas.map((f) => (
                    <td key={f} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {r.buckets[f] ? v(r.buckets[f]) : ''}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{r.maxDaysLate} dias</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.whatsapp && (
                      <a href={`https://wa.me/${r.whatsapp}?text=${encodeURIComponent(mensagem(r))}`} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm inline-flex items-center gap-1 text-green-700 dark:text-green-400" aria-label={`Cobrar ${r.name} pelo WhatsApp (abre em outra aba)`}>
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Cobrar
                      </a>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Procedimentos realizados no período: quantidade, valor, faturado e coberto por orçamento. */
export function ProceduresView({ today, canExport }: { today: Day; canExport: boolean }) {
  const inicial = presetRange('month', today);
  const [from, setFrom] = useState<string>(inicial.from);
  const [to, setTo] = useState<string>(inicial.to);
  const [d, setD] = useState<Awaited<ReturnType<typeof proceduresAction>> | undefined>(undefined);
  const [, start] = useTransition();
  const carregar = useCallback(() => start(async () => setD(await proceduresAction(from, to))), [from, to]);
  useEffect(() => {
    carregar();
  }, [carregar]);
  const rows = d ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
        <PeriodPicker from={from} to={to} today={today} presets={['month', 'prev-month', 'quarter', 'year']} onChange={(f, t) => (setFrom(f), setTo(t))} />
        {canExport && (
          <button
            type="button"
            onClick={() => downloadXlsx(`procedimentos-${from}-a-${to}`, [{ name: 'Procedimentos', rows: [['Procedimento', 'Quantidade', 'Valor', 'Faturado', 'Coberto por orçamento', 'Cortesias'], ...rows.map((r) => [r.name, r.quantity, r.totalCents / 100, r.billedCents / 100, r.coveredCents / 100, r.courtesy])], moneyColumns: [2, 3, 4] }])}
            className="btn-outline btn-sm inline-flex items-center gap-1.5"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> XLSX
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Procedimentos realizados</caption>
          <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5">Procedimento</th>
              <th scope="col" className="px-3 py-2.5 text-right">Qtd.</th>
              <th scope="col" className="px-3 py-2.5 text-right">Valor</th>
              <th scope="col" className="px-3 py-2.5 text-right">Faturado</th>
              <th scope="col" className="px-3 py-2.5 text-right">Coberto por orçamento</th>
              <th scope="col" className="px-3 py-2.5 text-right">Cortesias</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d === undefined ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum atendimento realizado no período.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.name}>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCents(r.totalCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.billedCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.coveredCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.courtesy || ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Centros de custo: receitas e despesas por competência. */
export function CostCentersView({ today }: { today: Day }) {
  const inicial = presetRange('month', today);
  const [from, setFrom] = useState<string>(inicial.from);
  const [to, setTo] = useState<string>(inicial.to);
  const [d, setD] = useState<Awaited<ReturnType<typeof costCentersAction>> | undefined>(undefined);
  const [, start] = useTransition();
  const carregar = useCallback(() => start(async () => setD(await costCentersAction(from, to))), [from, to]);
  useEffect(() => {
    carregar();
  }, [carregar]);
  if (d && 'locked' in d) return <PlanLock what="O relatório de centros de custo" />;
  const rows = d ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
        <PeriodPicker from={from} to={to} today={today} presets={['month', 'prev-month', 'quarter', 'year']} onChange={(f, t) => (setFrom(f), setTo(t))} />
        <button
          type="button"
          onClick={() => downloadXlsx(`centros-de-custo-${from}-a-${to}`, [{ name: 'Centros de custo', rows: [['Centro de custo', 'Receitas', 'Despesas', 'Resultado'], ...rows.map((r) => [r.name, r.revenueCents / 100, r.expenseCents / 100, (r.revenueCents - r.expenseCents) / 100])], moneyColumns: [1, 2, 3] }])}
          className="btn-outline btn-sm inline-flex items-center gap-1.5"
        >
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> XLSX
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Centros de custo</caption>
          <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5">Centro de custo</th>
              <th scope="col" className="px-3 py-2.5 text-right">Receitas</th>
              <th scope="col" className="px-3 py-2.5 text-right">Despesas</th>
              <th scope="col" className="px-3 py-2.5 text-right">Resultado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d === undefined ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma conta lançada no período.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.name}>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.revenueCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.expenseCents)}</td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.revenueCents - r.expenseCents < 0 ? 'text-destructive' : ''}`}>{formatCents(r.revenueCents - r.expenseCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
