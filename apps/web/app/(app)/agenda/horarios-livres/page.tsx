import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantClient } from '@clinicaiq/db';
import { requireCapability } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { clinicToday, wallDateBR } from '@/lib/tz';
import { findFreeSlots } from '../operacao-actions';
import { AgendaOpsNav } from '../_components/agenda-ops-nav';

import { DateField } from '@/components/ui/date-field';
export const metadata = { title: 'Horários livres' };

const field = 'h-9 rounded-lg border border-border bg-background px-2 text-sm';

/** Os próximos horários vagos de cada profissional. Clicar abre o agendamento já preenchido. */
export default async function HorariosLivresPage({ searchParams }: { searchParams: Promise<{ de?: string; profissional?: string; tipo?: string }> }) {
  const { tenantId } = await requireCapability('agenda');
  if (!(await pacienteAgendaEnabled(tenantId))) notFound();
  const sp = await searchParams;
  const de = /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? '') ? sp.de! : clinicToday();
  const db = getTenantClient(tenantId);
  const [lista, profs, tipos] = await Promise.all([
    findFreeSlots({ from: de, professionalId: sp.profissional || undefined, careTypeId: sp.tipo || undefined }),
    db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.careType.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, durationMinutes: true } }),
  ]);
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 lg:p-8">
      <AgendaOpsNav current="/agenda/horarios-livres" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Horários livres</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Os próximos horários vagos de cada profissional, já sem feriados, bloqueios e horário de almoço. Clique num horário para agendar.</p>
      </header>
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
        <label className="text-xs">
          <span className="block text-muted-foreground">A partir de</span>
          <DateField name="de" defaultValue={de} className={field} />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Profissional</span>
          <select name="profissional" defaultValue={sp.profissional ?? ''} className={field}>
            <option value="">Todos</option>
            {profs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Tipo de atendimento (define a duração)</span>
          <select name="tipo" defaultValue={sp.tipo ?? ''} className={field}>
            <option value="">Padrão da clínica</option>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.durationMinutes} min)
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary btn-md">
          Procurar
        </button>
      </form>
      {lista.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">Nenhum profissional ativo.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {lista.map((l) => {
            const porDia = new Map<string, string[]>();
            for (const s of l.slots) porDia.set(s.date, [...(porDia.get(s.date) ?? []), s.time]);
            return (
              <section key={l.professional.id} aria-labelledby={`hl-${l.professional.id}`} className="rounded-xl border border-border bg-surface p-4 shadow-card">
                <h2 id={`hl-${l.professional.id}`} className="text-sm font-semibold">
                  {l.professional.name} <span className="font-normal text-muted-foreground">· {l.duration} min</span>
                </h2>
                {porDia.size === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Sem horário livre nas próximas 3 semanas. Confira o horário de atendimento em Configurações.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {[...porDia.entries()].map(([d, horas]) => (
                      <li key={d}>
                        <p className="text-xs font-medium text-muted-foreground">{wallDateBR(d)}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {horas.map((h) => (
                            <Link
                              key={h}
                              href={`/agenda?date=${d}&novo=1&hora=${h}&profissional=${l.professional.id}`}
                              className="rounded-md border border-border px-2 py-1 text-sm tabular-nums hover:border-primary hover:bg-primary/5"
                              aria-label={`Agendar ${wallDateBR(d)} às ${h} com ${l.professional.name}`}
                            >
                              {h}
                            </Link>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
