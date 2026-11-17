import { FinNav } from '@/components/fin/fin-nav';
import { finPage } from '@/fin/page';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { financeOptions } from '../../configuracoes/finance-actions';
import { WalletsView } from './_components/wallets-view';

export const metadata = { title: 'Carteiras' };

export default async function CarteirasPage() {
  const { ctx, nav } = await finPage('fin_ver');
  const options = await financeOptions();
  if (!options) return null;
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Carteiras</h1>
        <p className="mt-1 text-sm text-muted-foreground">O crédito que cada paciente tem na clínica: adiantamentos, trocos guardados e sobras.</p>
      </header>
      <FinNav access={nav} />
      <WalletsView options={options} today={clinicToday() as Day} canReceive={ctx.can('fin_receber')} canPay={ctx.can('fin_pagar')} />
    </div>
  );
}
