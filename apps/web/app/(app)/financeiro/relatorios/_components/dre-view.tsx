'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { HideValues, money, PeriodPicker } from '@/components/fin/report-ui';
import { Modal, PlanLock } from '@/components/fin/ui';
import type { DreReport } from '@/fin/reports';
import { dayBR, type Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { presetRange } from '@/lib/financeiro/reports';
import { downloadXlsx } from '@/lib/xlsx';
import { dreAction, dreEntriesAction } from '../actions';

type Entry = Awaited<ReturnType<typeof dreEntriesAction>>[number];

/**
 * DRE por competência: cada subcategoria cai na linha configurada para ela.
 * Mostra o período anterior e a variação; clicar numa linha abre os
 * lançamentos que a compõem.
 */
export function DreView({ today }: { today: Day }) {
  const inicial = presetRange('month', today);
  const [from, setFrom] = useState<string>(inicial.from);
  const [to, setTo] = useState<string>(inicial.to);
  const [mostrar, setMostrar] = useState(true);
  const [d, setD] = useState<DreReport | { locked: true } | null | undefined>(undefined);
  const [detalhe, setDetalhe] = useState<{ id: string; label: string } | null>(null);
  const [carregando, start] = useTransition();

  const carregar = useCallback(() => start(async () => setD(await dreAction(from, to))), [from, to]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  if (d && 'locked' in d) return <PlanLock what="A DRE" />;
  const v = money(mostrar);
  const pct = (x: number | null) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(1).replace('.', ',')}%`);

  const exportar = () => {
    if (!d || 'locked' in d) return;
    downloadXlsx(`dre-${from}-a-${to}`, [
      {
        name: 'DRE',
        rows: [['Linha', `${dayBR(d.from)} a ${dayBR(d.to)}`, `${dayBR(d.previous.from)} a ${dayBR(d.previous.to)}`, 'Variação (%)'], ...d.rows.map((r) => [`(${r.symbol}) ${r.label}`, r.value / 100, r.previous / 100, r.variation == null ? '' : Math.round(r.variation * 10) / 10])],
        moneyColumns: [1, 2],
      },
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-card print:hidden">
        <PeriodPicker from={from} to={to} today={today} presets={['month', 'prev-month', 'quarter', 'prev-quarter', 'semester', 'year', 'prev-year']} onChange={(f, t) => (setFrom(f), setTo(t))} />
        <div className="flex items-center gap-2">
          {carregando && <span className="text-xs text-muted-foreground">Atualizando…</span>}
          <HideValues shown={mostrar} onToggle={() => setMostrar((x) => !x)} />
          <button type="button" onClick={exportar} disabled={!d} className="btn-outline btn-sm inline-flex items-center gap-1.5">
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> XLSX
          </button>
          <button type="button" onClick={() => window.print()} disabled={!d} className="btn-outline btn-sm inline-flex items-center gap-1.5">
            <Printer className="h-4 w-4" aria-hidden="true" /> PDF
          </button>
        </div>
      </div>

      {!d ? (
        <p className="text-sm text-muted-foreground">{d === null ? 'Sem acesso.' : 'Carregando…'}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="px-3 pt-3 text-left text-xs text-muted-foreground">
              Competência de {dayBR(d.from)} a {dayBR(d.to)}, comparada com {dayBR(d.previous.from)} a {dayBR(d.previous.to)}.
            </caption>
            <thead className="bg-surface-alt/60 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Linha</th>
                <th scope="col" className="px-3 py-2 text-right">Período</th>
                <th scope="col" className="px-3 py-2 text-right">Anterior</th>
                <th scope="col" className="px-3 py-2 text-right">Variação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.rows.map((r) => (
                <tr key={r.id} className={r.kind === 'subtotal' ? 'bg-surface-alt/50 font-semibold' : 'hover:bg-surface-alt/40'}>
                  <th scope="row" className="px-3 py-2 text-left font-[inherit]">
                    {r.kind === 'line' && r.value !== 0 ? (
                      <button type="button" onClick={() => setDetalhe({ id: r.id, label: r.label })} className="text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                        ({r.symbol}) {r.label}
                      </button>
                    ) : (
                      <span className={r.kind === 'line' ? 'text-muted-foreground' : ''}>
                        ({r.symbol}) {r.label}
                      </span>
                    )}
                  </th>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${mostrar && r.value < 0 ? 'text-rose-700 dark:text-rose-400' : ''}`}>{v(r.value)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{v(r.previous)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{pct(r.variation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground print:hidden">Por competência: entram as contas lançadas no mês, pagas ou não, as taxas de cartão e os descontos, juros e multas dos recebimentos. Cada subcategoria vai para a linha escolhida em Configurações › Financeiro › Categorias.</p>

      {detalhe && <Detalhe from={from} to={to} linha={detalhe} onClose={() => setDetalhe(null)} />}
    </div>
  );
}

function Detalhe({ from, to, linha, onClose }: { from: string; to: string; linha: { id: string; label: string }; onClose: () => void }) {
  const [itens, setItens] = useState<Entry[] | null>(null);
  useEffect(() => {
    let vivo = true;
    void dreEntriesAction(from, to, linha.id).then((x) => vivo && setItens(x));
    return () => {
      vivo = false;
    };
  }, [from, to, linha.id]);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={linha.label} description="Os lançamentos que compõem esta linha." size="lg">
      {!itens ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada nesta linha.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Lançamentos de {linha.label}</caption>
            <thead className="sticky top-0 bg-surface-alt text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">Competência</th>
                <th scope="col" className="px-3 py-2">Lançamento</th>
                <th scope="col" className="px-3 py-2">Categoria</th>
                <th scope="col" className="px-3 py-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {itens.map((e, i) => (
                <tr key={`${e.id}${i}`}>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{e.competence.split('-').reverse().join('/')}</td>
                  <td className="px-3 py-1.5">
                    <span className="font-mono text-xs">{e.kind === 'title' ? `conta nº ${e.code}` : `movimento nº ${e.code}`}</span> {e.description}
                  </td>
                  <td className="px-3 py-1.5">{e.category}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatCents(e.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
