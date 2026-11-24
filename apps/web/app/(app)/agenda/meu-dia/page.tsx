import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { myDay } from '../operacao-actions';
import { AgendaOpsNav } from '../_components/agenda-ops-nav';
import { MyDayView } from './my-day-view';

export const metadata = { title: 'Meu dia' };

/** Os pacientes de hoje do profissional, com chegada, início e fim do atendimento. */
export default async function MeuDiaPage({ searchParams }: { searchParams: Promise<{ profissional?: string }> }) {
  const { tenantId } = await requireCapability('agenda');
  if (!(await pacienteAgendaEnabled(tenantId))) notFound();
  const sp = await searchParams;
  const data = await myDay(sp.profissional);
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6 lg:p-8">
      <AgendaOpsNav current="/agenda/meu-dia" />
      <MyDayView data={data} />
    </div>
  );
}
