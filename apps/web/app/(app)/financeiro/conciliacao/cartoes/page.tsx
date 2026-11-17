import { finPage } from '@/fin/page';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { CardsView } from '../_components/cards-view';
import { ReportShell } from '../../relatorios/layout-parts';
import { ConciliacaoTabs } from '../tabs';

export const metadata = { title: 'Cartões e cheques' };

export default async function Page() {
  const { nav } = await finPage('fin_relatorios');

  return (
    <ReportShell title="Cartões e cheques" description="Confira o que a operadora pagou e acompanhe os cheques." nav={nav}>
      <ConciliacaoTabs />
      <CardsView today={clinicToday() as Day} />
    </ReportShell>
  );
}
