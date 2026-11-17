import { finPage } from '@/fin/page';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { financeOptions } from '../../../configuracoes/finance-actions';
import { BanksView } from '../_components/banks-view';
import { ReportShell } from '../../relatorios/layout-parts';
import { ConciliacaoTabs } from '../tabs';

export const metadata = { title: 'Conciliação bancária' };

export default async function Page() {
  const { nav } = await finPage('fin_relatorios');
  const options = await financeOptions();
  return (
    <ReportShell title="Conciliação bancária" description="Confira o extrato do banco com os movimentos de cada conta." nav={nav}>
      <ConciliacaoTabs />
      {options && <BanksView options={options} today={clinicToday() as Day} />}
    </ReportShell>
  );
}
