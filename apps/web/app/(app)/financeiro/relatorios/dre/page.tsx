import { finPage } from '@/fin/page';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { DreView } from '../_components/dre-view';
import { ReportShell } from '../layout-parts';

export const metadata = { title: 'DRE' };

export default async function DrePage() {
  const { nav } = await finPage('fin_relatorios');
  return (
    <ReportShell title="DRE" description="Demonstração do resultado, por competência." nav={nav}>
      <DreView today={clinicToday() as Day} />
    </ReportShell>
  );
}
