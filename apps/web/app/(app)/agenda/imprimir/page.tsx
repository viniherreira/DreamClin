import { notFound } from 'next/navigation';
import { decrypt, getTenantClient, prisma } from '@clinicaiq/db';
import { requireCapability } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { displayName } from '@/lib/patient-name';
import { statusLabel } from '@/lib/appointment-status';
import { clinicToday, wallClockTime, wallDateBR } from '@/lib/tz';
import { PrintButton } from './print-button';

export const metadata = { title: 'Imprimir agenda' };

const ok = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** A agenda do dia (ou da semana) para imprimir, separada por profissional. */
export default async function ImprimirAgendaPage({ searchParams }: { searchParams: Promise<{ date?: string; view?: string; profissional?: string }> }) {
  const { tenantId } = await requireCapability('agenda');
  if (!(await pacienteAgendaEnabled(tenantId))) notFound();
  const sp = await searchParams;
  const dia = ok(sp.date) ? sp.date : clinicToday();
  const semana = sp.view === 'week';
  // Semana: de segunda a domingo da data escolhida.
  const base = new Date(`${dia}T00:00:00.000Z`);
  const ini = semana ? new Date(base.getTime() - ((base.getUTCDay() + 6) % 7) * 86_400_000) : base;
  const fim = new Date(ini.getTime() + (semana ? 7 : 1) * 86_400_000 - 1);
  const db = getTenantClient(tenantId);
  const [ags, clinica] = await Promise.all([
    db.appointment.findMany({
      where: { startTime: { gte: ini, lte: fim }, status: { not: 'CANCELLED' }, ...(sp.profissional ? { professionalId: sp.profissional } : {}) },
      orderBy: [{ startTime: 'asc' }],
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        confirmationSource: true,
        notes: true,
        professional: { select: { id: true, name: true } },
        procedure: { select: { name: true } },
        items: { select: { procedure: { select: { name: true } } } },
        patient: { select: { name: true, socialName: true, controlNumber: true, phoneEncrypted: true } },
      },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ]);
  const abrir = (c: string | null | undefined) => {
    if (!c) return '';
    try {
      return decrypt(c, process.env.ENCRYPTION_MASTER_KEY ?? '', tenantId);
    } catch {
      return '';
    }
  };
  const porProf = new Map<string, { nome: string; itens: typeof ags }>();
  for (const a of ags) {
    const g = porProf.get(a.professional.id) ?? { nome: a.professional.name, itens: [] };
    g.itens.push(a);
    porProf.set(a.professional.id, g);
  }
  const titulo = semana ? `Semana de ${wallDateBR(ini)} a ${wallDateBR(new Date(fim.getTime() - 1))}` : wallDateBR(dia);

  return (
    <div id="imprimir" className="mx-auto max-w-4xl space-y-6 bg-white p-6 text-black">
      <style>{`@media print { body * { visibility: hidden !important; } #imprimir, #imprimir * { visibility: visible !important; } #imprimir { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0; } .no-print { display: none !important; } section { break-inside: avoid-page; } }`}</style>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Agenda · {titulo}</h1>
          <p className="text-sm text-neutral-600">
            {clinica?.name} · {ags.length} {ags.length === 1 ? 'agendamento' : 'agendamentos'} (sem os cancelados)
          </p>
        </div>
        <PrintButton />
      </div>
      {porProf.size === 0 && <p className="text-sm">Nenhum agendamento.</p>}
      {[...porProf.values()].map((g) => (
        <section key={g.nome} aria-label={g.nome}>
          <h2 className="border-b border-neutral-400 pb-1 text-base font-semibold">{g.nome}</h2>
          <table className="mt-1 w-full text-sm">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                {semana && <th scope="col" className="py-1 pr-2 font-medium">Dia</th>}
                <th scope="col" className="py-1 pr-2 font-medium">Horário</th>
                <th scope="col" className="py-1 pr-2 font-medium">Paciente</th>
                <th scope="col" className="py-1 pr-2 font-medium">Telefone</th>
                <th scope="col" className="py-1 pr-2 font-medium">Procedimento</th>
                <th scope="col" className="py-1 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {g.itens.map((a) => (
                <tr key={a.id} className="border-t border-neutral-200 align-top">
                  {semana && <td className="py-1 pr-2 tabular-nums">{wallDateBR(a.startTime).slice(0, 5)}</td>}
                  <td className="whitespace-nowrap py-1 pr-2 tabular-nums">
                    {wallClockTime(a.startTime)}–{wallClockTime(a.endTime)}
                  </td>
                  <td className="py-1 pr-2">
                    {displayName(a.patient)} <span className="text-neutral-500">nº {a.patient.controlNumber}</span>
                    {a.notes && <span className="block text-xs text-neutral-600">{a.notes}</span>}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-2">{abrir(a.patient.phoneEncrypted)}</td>
                  <td className="py-1 pr-2">{[...new Set([a.procedure?.name, ...a.items.map((i) => i.procedure?.name)].filter(Boolean))].join(', ')}</td>
                  <td className="py-1">{statusLabel(a.status, a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
