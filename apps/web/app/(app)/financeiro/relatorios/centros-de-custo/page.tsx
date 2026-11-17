import { finPage } from '@/fin/page';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { CostCentersView } from '../_components/other-reports';
import { ReportShell } from '../layout-parts';

export const metadata = { title: 'Centros de custo' };

export default async function CentrosDeCustoPage() {
  const { nav } = await finPage('fin_relatorios');
  return (
    <ReportShell title="Centros de custo" description="Receitas e despesas de cada centro, por competência." nav={nav}>
      <CostCentersView today={clinicToday() as Day} />
    </ReportShell>
  );
}
