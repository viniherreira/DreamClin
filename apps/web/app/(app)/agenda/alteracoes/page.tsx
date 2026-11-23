import { notFound } from 'next/navigation';
import { getTenantClient } from '@clinicaiq/db';
import { requireCapability } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { AgendaOpsNav } from '../_components/agenda-ops-nav';
import { BulkView } from './bulk-view';

export const metadata = { title: 'Alterações em massa' };

/** Trocar profissional, sala, data ou situação de vários agendamentos de uma vez. Só dono e admin. */
export default async function AlteracoesPage() {
  const { tenantId } = await requireCapability('agenda_massa');
  if (!(await pacienteAgendaEnabled(tenantId))) notFound();
  const db = getTenantClient(tenantId);
  const [profs, salas, rotulos] = await Promise.all([
    db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.agendaResource.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
    db.appointmentLabel.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 lg:p-8">
      <AgendaOpsNav current="/agenda/alteracoes" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Alterações em massa</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Para quando um profissional falta ou a clínica fecha num dia: escolha os agendamentos, veja a prévia e aplique. Cada agendamento alterado fica na auditoria.</p>
      </header>
      <BulkView professionals={profs} rooms={salas} labels={rotulos} />
    </div>
  );
}
