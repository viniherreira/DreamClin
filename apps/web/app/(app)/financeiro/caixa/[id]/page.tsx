import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FinNav } from '@/components/fin/fin-nav';
import { cashAccounts, cashView } from '@/fin/cash-read';
import { finPage } from '@/fin/page';
import { CashSessionPanel } from '../_components/cash-view';

export const metadata = { title: 'Caixa' };

export default async function CaixaDetalhePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fechado?: string }> }) {
  const { ctx, nav } = await finPage('fin_caixa');
  const [{ id }, { fechado }] = await Promise.all([params, searchParams]);
  const [view, contas] = await Promise.all([cashView(ctx, id), cashAccounts(ctx)]);
  // Caixa de outra pessoa, para quem não gerencia, é como se não existisse.
  if (!view) notFound();

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Caixa nº {view.code}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{view.status === 'OPEN' ? `Caixa aberto de ${view.userName}.` : `Caixa fechado de ${view.userName}.`}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/financeiro/caixa" className="btn-outline btn-md">
            Meu caixa
          </Link>
          <Link href="/financeiro/caixa/fechados" className="btn-outline btn-md">
            Caixas fechados
          </Link>
        </div>
      </header>
      <FinNav access={nav} />
      {fechado === '1' && view.status === 'CLOSED' && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {view.closingNote ? 'Caixa fechado com diferença. A justificativa ficou registrada.' : 'Caixa fechado. Tudo bateu.'} O relatório está no botão ao lado do nome do caixa.
        </p>
      )}
      <CashSessionPanel view={view} accounts={contas.all} canManage={ctx.can('fin_caixas_outros')} />
    </div>
  );
}
