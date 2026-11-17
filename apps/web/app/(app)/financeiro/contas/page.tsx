import { FinNav } from '@/components/fin/fin-nav';
import { finPage } from '@/fin/page';
import { addDays } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { financeOptions } from '../../configuracoes/finance-actions';
import { TitlesView } from './_components/titles-view';

export const metadata = { title: 'Contas a receber e a pagar' };

export default async function ContasPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { ctx, advanced, nav } = await finPage('fin_ver');
  const [options, { aba }] = await Promise.all([financeOptions(), searchParams]);
  if (!options) return null;
  const today = clinicToday();
  const receive = ctx.can('fin_receber');
  const pay = ctx.can('fin_pagar');

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Contas a receber e a pagar</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tudo o que a clínica tem para receber e para pagar, com vencimento.</p>
      </header>
      <FinNav access={nav} />
      <TitlesView
        options={options}
        today={today}
        range={{ from: addDays(today, -30), to: addDays(today, 30) }}
        advanced={advanced}
        access={{ receive, pay, reverse: nav.reverse }}
        initialTab={aba === 'pagar' || !receive ? 'PAYABLE' : aba === 'todas' ? 'ALL' : 'RECEIVABLE'}
      />
    </div>
  );
}
