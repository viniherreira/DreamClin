import { finPage } from '@/fin/page';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { ProceduresView } from '../_components/other-reports';
import { ReportShell } from '../layout-parts';

export const metadata = { title: 'Procedimentos realizados' };

export default async function ProcedimentosPage() {
  const { nav, advanced } = await finPage('fin_relatorios');
  return (
    <ReportShell title="Procedimentos realizados" description="O que foi atendido no período e quanto já foi faturado." nav={nav}>
      <ProceduresView today={clinicToday() as Day} canExport={advanced} />
    </ReportShell>
  );
}
