'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { HideValues, money, PeriodPicker } from '@/components/fin/report-ui';
import { inputCls, PlanLock, Toggle } from '@/components/fin/ui';
import type { CashFlow, FlowRow } from '@/fin/reports';
import type { Day } from '@/lib/financeiro/dates';
import { presetRange } from '@/lib/financeiro/reports';
import { downloadXlsx } from '@/lib/xlsx';
import { cashFlowAction } from '../actions';

/**
 * Fluxo de caixa: linhas por categoria, colunas por dia, semana ou mês, o que
 * já entrou e saiu (realizado) e o que está para vencer (previsto), com saldo
 * inicial e final de cada coluna.
 */
export function CashFlowView({ today, accounts }: { today: Day; accounts: { id: string; name: string }[] }) {
  const inicial = presetRange('month', today);
  const [from, setFrom] = useState<string>(inicial.from);
  const [to, setTo] = useState<string>(inicial.to);
  const [conta, setConta] = useState('');
  const [semanal, setSemanal] = useState(false);
  const [mostrar, setMostrar] = useState(true);
  const [d, setD] = useState<CashFlow | { locked: true } | null | undefined>(undefined);
  const [carregando, start] = useTransition();

  const carregar = useCallback(() => start(async () => setD(await cashFlowAction(from, to, conta, semanal))), [from, to, conta, semanal]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  if (d && 'locked' in d) return <PlanLock what="O fluxo de caixa" />;
  const v = money(mostrar);

  const exportar = () => {
    if (!d || 'locked' in d) return;
    const cab = ['', ...d.buckets.map((b) => b.label), 'Total'];
    const reais = (c: number) => Math.round(c) / 100;
    const linha = (l: FlowRow, prefixo: string) => [`${prefixo}${l.name}`, ...l.values.map((x) => reais(l.direction === 'OUT' ? -x : x)), reais(l.direction === 'OUT' ? -l.total : l.total)];
    const rows = [
      cab,
      ['Saldo inicial', reais(d.opening)],
      ['Realizado'],
      ...d.realized.map((l) => linha(l, '  ')),
      ['Previsto'],
      ...d.forecast.map((l) => linha(l, '  ')),
      ['Entradas', ...d.inTotals.map(reais)],
      ['Saídas', ...d.outTotals.map((x) => reais(-x))],
      ['Saldo final', ...d.closing.map(reais)],
    ];
    downloadXlsx(`fluxo-de-caixa-${from}-a-${to}`, [{ name: 'Fluxo de caixa', rows, moneyColumns: d.buckets.map((_, i) => i + 1).concat(d.buckets.length + 1) }]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodPicker from={from} to={to} today={today} presets={['month', 'prev-month', 'next-month', 'quarter', 'prev-quarter', 'next-quarter', 'semester', 'year', 'prev-year']} onChange={(f, t) => (setFrom(f), setTo(t))} />
          <div>
            <label htmlFor="fc-conta" className="block text-sm font-medium">
              Conta
            </label>
            <select id="fc-conta" value={conta} onChange={(e) => setConta(e.target.value)} className={`${inputCls} mt-1 w-48`}>
              <option value="">Todas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="pb-1">
            <Toggle label="Totais semanais" checked={semanal} onChange={setSemanal} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {carregando && <span className="text-xs text-muted-foreground">Atualizando…</span>}
          <HideValues shown={mostrar} onToggle={() => setMostrar((x) => !x)} />
          <button type="button" onClick={exportar} disabled={!d} className="btn-outline btn-sm inline-flex items-center gap-1.5">
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Exportar XLSX
          </button>
        </div>
      </div>

      {!d ? (
        <p className="text-sm text-muted-foreground">{d === null ? 'Sem acesso.' : 'Carregando…'}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Fluxo de caixa</caption>
            <thead className="bg-surface-alt/60 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="sticky left-0 z-10 min-w-[14rem] bg-surface-alt px-3 py-2 text-left">
                  Categoria
                </th>
                {d.buckets.map((b) => (
                  <th key={b.key} scope="col" className="whitespace-nowrap px-3 py-2 text-right">
                    {b.label}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border bg-surface-alt/30 font-medium">
                <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left">
                  Saldo inicial
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{v(d.opening)}</td>
                <td colSpan={d.buckets.length} />
              </tr>
              <Secao titulo="Realizado" linhas={d.realized} colunas={d.buckets.length} v={v} vazio="Nada entrou nem saiu no período." />
              <Secao titulo="Previsto (contas em aberto)" linhas={d.forecast} colunas={d.buckets.length} v={v} vazio="Nenhuma conta vence no período." />
              <Total titulo="Entradas" valores={d.inTotals} v={v} tom="text-emerald-700 dark:text-emerald-400" />
              <Total titulo="Saídas" valores={d.outTotals.map((x) => -x)} v={v} tom="text-rose-700 dark:text-rose-400" />
              <Total titulo="Saldo final" valores={d.closing} v={v} forte semTotal />
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">O realizado mostra o dinheiro que entrou e saiu das contas (sem as transferências entre elas, quando todas as contas estão na tela). O previsto mostra as contas em aberto pelo vencimento.</p>
    </div>
  );
}

function Secao({ titulo, linhas, colunas, v, vazio }: { titulo: string; linhas: FlowRow[]; colunas: number; v: (c: number) => string; vazio: string }) {
  return (
    <>
      <tr className="border-t border-border">
        <th scope="rowgroup" colSpan={colunas + 2} className="sticky left-0 bg-surface px-3 pb-1 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {titulo}
        </th>
      </tr>
      {linhas.length === 0 ? (
        <tr>
          <td colSpan={colunas + 2} className="px-3 py-2 text-muted-foreground">
            {vazio}
          </td>
        </tr>
      ) : (
        linhas.map((l) => (
          <tr key={`${l.direction}${l.id}`} className="hover:bg-surface-alt/40">
            <th scope="row" className="sticky left-0 bg-surface px-3 py-1.5 text-left font-normal">
              <span className={l.direction === 'IN' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'} aria-hidden="true">
                {l.direction === 'IN' ? '+ ' : '− '}
              </span>
              <span className="sr-only">{l.direction === 'IN' ? 'Entrada: ' : 'Saída: '}</span>
              {l.name}
            </th>
            {l.values.map((x, i) => (
              <td key={i} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                {x ? v(x) : ''}
              </td>
            ))}
            <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium tabular-nums">{v(l.total)}</td>
          </tr>
        ))
      )}
    </>
  );
}

function Total({ titulo, valores, v, tom = '', forte = false, semTotal = false }: { titulo: string; valores: number[]; v: (c: number) => string; tom?: string; forte?: boolean; semTotal?: boolean }) {
  return (
    <tr className={`border-t border-border ${forte ? 'bg-surface-alt/50 font-semibold' : 'font-medium'}`}>
      <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left">
        {titulo}
      </th>
      {valores.map((x, i) => (
        <td key={i} className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${tom} ${forte && x < 0 ? 'text-destructive' : ''}`}>
          {v(x)}
        </td>
      ))}
      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${tom}`}>{semTotal ? '' : v(valores.reduce((s, x) => s + x, 0))}</td>
    </tr>
  );
}
