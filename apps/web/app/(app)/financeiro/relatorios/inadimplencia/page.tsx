import { prisma } from '@clinicaiq/db';
import { finPage } from '@/fin/page';
import { AgingView } from '../_components/other-reports';
import { ReportShell } from '../layout-parts';

export const metadata = { title: 'Inadimplência' };

export default async function InadimplenciaPage() {
  const { ctx, nav, advanced } = await finPage('fin_relatorios');
  // O nome da clínica (para a mensagem de cobrança). O id vem da sessão.
  const clinica = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
  return (
    <ReportShell title="Inadimplência" description="Contas a receber vencidas, por cliente e faixa de atraso." nav={nav}>
      <AgingView clinicName={clinica?.name ?? 'clínica'} canExport={advanced} />
    </ReportShell>
  );
}
