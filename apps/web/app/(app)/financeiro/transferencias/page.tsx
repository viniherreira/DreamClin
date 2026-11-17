import { FinNav } from '@/components/fin/fin-nav';
import { finPage } from '@/fin/page';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { financeOptions } from '../../configuracoes/finance-actions';
import { TransfersView } from './_components/transfers-view';

export const metadata = { title: 'Transferências' };

export default async function TransferenciasPage() {
  const { ctx, nav } = await finPage('fin_ver');
  const options = await financeOptions();
  if (!options) return null;
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Transferências</h1>
        <p className="mt-1 text-sm text-muted-foreground">Dinheiro que passou de uma conta da clínica para outra.</p>
      </header>
      <FinNav access={nav} />
      <TransfersView options={options} today={clinicToday() as Day} canTransfer={ctx.can('fin_pagar')} canReverse={ctx.can('fin_estornar')} />
    </div>
  );
}
