'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Banknote, Landmark } from 'lucide-react';
import { BarChart, HideValues, money, PeriodPicker, TopList } from '@/components/fin/report-ui';
import type { Overview } from '@/fin/reports';
import type { Day } from '@/lib/financeiro/dates';
import { presetRange } from '@/lib/financeiro/reports';
import { overviewAction } from '../relatorios/actions';

/**
 * Visão geral do financeiro novo: receitas e despesas do período, o que venceu,
 * o que vence nos próximos 7 dias, saldo das contas, caixas abertos, os
 * 12 meses de receitas × despesas, ticket médio, inadimplência e os
 * procedimentos que mais faturaram.
 */
export function OverviewView({ today }: { today: Day }) {
  const inicial = presetRange('last-30', today);
  const [from, setFrom] = useState<string>(inicial.from);
  const [to, setTo] = useState<string>(inicial.to);
  const [mostrar, setMostrar] = useState(false);
  const [d, setD] = useState<Overview | null>(null);
  const [carregando, start] = useTransition();

  const carregar = useCallback(() => {
    start(async () => setD(await overviewAction(from, to)));
  }, [from, to]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const v = money(mostrar);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
        <PeriodPicker from={from} to={to} today={today} presets={['last-30', 'month', 'prev-month', 'quarter', 'year']} onChange={(f, t) => (setFrom(f), setTo(t))} />
        <div className="flex items-center gap-2">
          {carregando && <span className="text-xs text-muted-foreground">Atualizando…</span>}
          <HideValues shown={mostrar} onToggle={() => setMostrar((x) => !x)} />
        </div>
      </div>

      {!d ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card icone={ArrowDownCircle} tom="text-emerald-700 dark:text-emerald-400" titulo="Recebido no período" valor={v(d.revenue.period)} linhas={[`A receber: ${v(d.revenue.openTotal)}`, `Próximos 7 dias: ${v(d.revenue.next7)}`]} />
            <Card icone={ArrowUpCircle} tom="text-rose-700 dark:text-rose-400" titulo="Pago no período" valor={v(d.expense.period)} linhas={[`A pagar: ${v(d.expense.openTotal)}`, `Próximos 7 dias: ${v(d.expense.next7)}`]} />
            <Card icone={AlertTriangle} tom="text-amber-700 dark:text-amber-300" titulo="A receber vencido" valor={v(d.revenue.overdue)} linhas={[`A pagar vencido: ${v(d.expense.overdue)}`, d.defaultRate == null ? 'Inadimplência: sem base no período' : `Inadimplência: ${String(d.defaultRate).replace('.', ',')}%`]} href="/financeiro/relatorios/inadimplencia" />
            <Card icone={Landmark} tom="" titulo="Saldo das contas" valor={v(d.accountsTotal)} linhas={[`${d.openCashSessions} caixa(s) aberto(s)`, d.averageTicket == null ? 'Ticket médio: sem atendimentos' : `Ticket médio: ${v(d.averageTicket)} (${d.attended} atendimentos)`]} href="/financeiro/caixa" />
          </div>

          <BarChart
            title="Receitas × despesas · últimos 12 meses"
            labels={d.months.map((m) => m.label)}
            series={[
              { name: 'Receitas', fill: 'fill-sky-600 dark:fill-sky-400', swatch: 'bg-sky-600 dark:bg-sky-400', values: d.months.map((m) => m.revenue) },
              { name: 'Despesas', fill: 'fill-amber-500 dark:fill-amber-400', swatch: 'bg-amber-500 dark:bg-amber-400', values: d.months.map((m) => m.expense) },
            ]}
            shown={mostrar}
            filename="receitas-despesas-12-meses"
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <TopList title="Faturamento por procedimento" rows={d.topProcedures} shown={mostrar} filename={`procedimentos-${from}-a-${to}`} />
            <TopList title="Faturamento por especialidade" rows={d.topSpecialties} shown={mostrar} filename={`especialidades-${from}-a-${to}`} />
          </div>

          <section aria-label="Saldo de cada conta" className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Banknote className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Saldo de cada conta
            </h3>
            <ul className="mt-2 divide-y divide-border text-sm">
              {d.accounts.map((a) => (
                <li key={a.id} className="flex justify-between py-1.5">
                  <span>{a.name}</span>
                  <span className={`tabular-nums ${mostrar && a.balance < 0 ? 'text-destructive' : ''}`}>{v(a.balance)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Card({ icone: Icone, tom, titulo, valor, linhas, href }: { icone: typeof Banknote; tom: string; titulo: string; valor: string; linhas: string[]; href?: string }) {
  const corpo = (
    <>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icone className={`h-4 w-4 ${tom}`} aria-hidden="true" /> {titulo}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{valor}</p>
      {linhas.map((l) => (
        <p key={l} className="mt-0.5 text-xs text-muted-foreground">
          {l}
        </p>
      ))}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl border border-border bg-surface p-4 shadow-card hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring">
      {corpo}
    </Link>
  ) : (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">{corpo}</div>
  );
}
