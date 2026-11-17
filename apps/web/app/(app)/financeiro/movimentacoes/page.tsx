import { FinNav } from '@/components/fin/fin-nav';
import { finPage } from '@/fin/page';
import { addDays } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { financeOptions } from '../../configuracoes/finance-actions';
import { TransactionsView } from '../movimentacoes/_components/transactions-view';

export const metadata = { title: 'Movimentações' };

export default async function Page() {
  const { nav } = await finPage('fin_ver');
  const options = await financeOptions();
  if (!options) return null;
  const today = clinicToday();
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Movimentações</h1>
        <p className="mt-1 text-sm text-muted-foreground">O extrato de tudo o que entrou e saiu de verdade.</p>
      </header>
      <FinNav access={nav} />
      <TransactionsView options={options} range={{ from: addDays(today, -30), to: today }} canReverse={nav.reverse} />
    </div>
  );
}
