import { finPage } from '@/fin/page';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { CashFlowView } from '../_components/cash-flow-view';
import { ReportShell } from '../layout-parts';

export const metadata = { title: 'Fluxo de caixa' };

export default async function FluxoDeCaixaPage() {
  const { ctx, nav } = await finPage('fin_relatorios');
  const contas = await ctx.db.financialAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true } });
  return (
    <ReportShell title="Fluxo de caixa" description="Realizado e previsto, por categoria." nav={nav}>
      <CashFlowView today={clinicToday() as Day} accounts={contas} />
    </ReportShell>
  );
}
