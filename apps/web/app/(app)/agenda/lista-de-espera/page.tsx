import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { listWaitlist, waitlistForSlot } from '../operacao-actions';
import { WaitlistView } from './waitlist-view';
import { AgendaOpsNav } from '../_components/agenda-ops-nav';

export const metadata = { title: 'Lista de espera' };

/** Pacientes que querem horário antes; quando um horário vaga, quem da lista combina. */
export default async function ListaDeEsperaPage({ searchParams }: { searchParams: Promise<{ historico?: string; vaga?: string }> }) {
  const { tenantId } = await requireCapability('agenda');
  if (!(await pacienteAgendaEnabled(tenantId))) notFound();
  const sp = await searchParams;
  const [data, vaga] = await Promise.all([listWaitlist({ history: sp.historico === '1' }), sp.vaga ? waitlistForSlot(sp.vaga) : null]);
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 lg:p-8">
      <AgendaOpsNav current="/agenda/lista-de-espera" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Lista de espera</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Quem quer horário antes. Quando alguém cancela, a janela do agendamento cancelado mostra quem da lista combina com o horário.</p>
      </header>
      <WaitlistView data={data} history={sp.historico === '1'} slot={vaga} />
    </div>
  );
}
