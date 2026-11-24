import { notFound } from 'next/navigation';
import { getTenantClient } from '@clinicaiq/db';
import { requireCapability } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { clinicToday } from '@/lib/tz';
import { listConfirmations } from '../operacao-actions';
import { ConfirmationsView } from './confirmations-view';
import { AgendaOpsNav } from '../_components/agenda-ops-nav';

export const metadata = { title: 'Confirmações' };

/** Para a recepção ligar ou mandar mensagem a quem ainda não confirmou (padrão: amanhã). */
export default async function ConfirmacoesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { tenantId } = await requireCapability('agenda');
  if (!(await pacienteAgendaEnabled(tenantId))) notFound();
  const sp = await searchParams;
  const amanha = new Date(new Date(`${clinicToday()}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const filtros = {
    from: /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? '') ? sp.de! : amanha,
    to: /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? '') ? sp.ate! : /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? '') ? sp.de! : amanha,
    professionalId: sp.profissional ?? '',
    status: sp.situacao === 'todos' || sp.situacao === 'CONFIRMED' ? sp.situacao : 'pendentes',
  };
  const [rows, profs] = await Promise.all([
    listConfirmations(filtros),
    getTenantClient(tenantId).professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 lg:p-8">
      <AgendaOpsNav current="/agenda/confirmacoes" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Confirmações</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Quem ainda não confirmou, com o que aconteceu com o lembrete do WhatsApp.</p>
      </header>
      <ConfirmationsView rows={rows} filters={filtros} professionals={profs} />
    </div>
  );
}
