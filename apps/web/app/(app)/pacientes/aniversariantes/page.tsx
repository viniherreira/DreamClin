import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Cake, MessageCircle } from 'lucide-react';
import { decrypt, getTenantClient, prisma } from '@clinicaiq/db';
import { buildBirthdayBody, renderBirthdayTemplate } from '@clinicaiq/whatsapp';
import { requireCapability } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { birthdayDays, birthdayInRange, turningAge, type BirthdayRange } from '@/lib/birthdays';
import { clinicToday, wallDateBR } from '@/lib/tz';
import { PatientAvatar } from '../_components/patient-avatar';

export const metadata = { title: 'Aniversariantes' };

const RANGES: { id: BirthdayRange; label: string }[] = [
  { id: 'dia', label: 'Hoje' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mês' },
];

const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Número para o wa.me: com o 55 quando vier só com DDD. */
function waNumber(phone: string) {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

/**
 * Aniversariantes do dia, da semana ou do mês. "Mandar parabéns" abre o
 * WhatsApp com o texto de aniversário da clínica (Configurações › Comunicação)
 * já escrito. Quem marcou que não quer receber aparece sem o botão.
 */
export default async function BirthdaysPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const { tenantId } = await requireCapability('pacientes');
  if (!(await pacienteAgendaEnabled(tenantId))) notFound();
  const periodo = (await searchParams).periodo;
  const range: BirthdayRange = periodo === 'dia' || periodo === 'mes' ? periodo : 'semana';
  const hoje = clinicToday();
  const dias = birthdayDays(hoje, range);

  const [patients, tenant, session] = await Promise.all([
    getTenantClient(tenantId).patient.findMany({
      where: { deletedAt: null, active: true, birthDate: { not: null } },
      select: { id: true, name: true, socialName: true, birthDate: true, phoneEncrypted: true, birthdayMessages: true, controlNumber: true },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    prisma.whatsAppSession.findUnique({ where: { tenantId }, select: { birthdayMessage: true } }),
  ]);
  const key = process.env.ENCRYPTION_MASTER_KEY ?? '';
  const lista = patients
    .map((p) => ({ p, dia: birthdayInRange(p.birthDate!, dias) }))
    .filter((x): x is { p: (typeof patients)[number]; dia: string } => !!x.dia)
    .sort((a, b) => a.dia.localeCompare(b.dia) || a.p.name.localeCompare(b.p.name))
    .map(({ p, dia }) => {
      let phone = '';
      try {
        phone = decrypt(p.phoneEncrypted, key, tenantId);
      } catch {}
      const nome = p.socialName || p.name;
      const dados = { patientName: nome, clinicName: tenant?.name ?? 'clínica' };
      const texto = session?.birthdayMessage ? renderBirthdayTemplate(session.birthdayMessage, dados) : buildBirthdayBody(dados);
      return { id: p.id, nome, dia, idade: turningAge(p.birthDate!, dia), nascimento: wallDateBR(p.birthDate!), phone, aceita: p.birthdayMessages, texto, numero: p.controlNumber };
    });

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aniversariantes</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Quem faz aniversário no período. O texto do parabéns é o de Configurações › Comunicação.</p>
        </div>
        <nav aria-label="Período" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {RANGES.map((r) => (
            <Link
              key={r.id}
              href={`/pacientes/aniversariantes?periodo=${r.id}`}
              aria-current={r.id === range ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${r.id === range ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </header>

      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-14 text-center">
          <Cake className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">Ninguém faz aniversário neste período.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          {lista.map((x) => {
            const d = new Date(`${x.dia}T12:00:00Z`);
            const ehHoje = x.dia === hoje;
            return (
              <li key={x.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${ehHoje ? 'bg-primary/5' : ''}`}>
                <div className="w-14 shrink-0 text-center">
                  <p className="text-lg font-semibold leading-none tabular-nums">{String(d.getUTCDate()).padStart(2, '0')}</p>
                  <p className="text-[11px] text-muted-foreground">{ehHoje ? 'hoje' : SEMANA[d.getUTCDay()]}</p>
                </div>
                <PatientAvatar name={x.nome} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link href={`/pacientes/${x.id}`} className="block truncate font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                    {x.nome}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Faz {x.idade} anos · nasceu em {x.nascimento} · nº {x.numero}
                  </p>
                </div>
                {x.aceita && x.phone ? (
                  <a href={`https://wa.me/${waNumber(x.phone)}?text=${encodeURIComponent(x.texto)}`} target="_blank" rel="noreferrer" className="btn-outline btn-sm">
                    <MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> Mandar parabéns
                    <span className="sr-only"> para {x.nome} (abre o WhatsApp em nova aba)</span>
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">{x.aceita ? 'Sem celular' : 'Não quer receber parabéns'}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
