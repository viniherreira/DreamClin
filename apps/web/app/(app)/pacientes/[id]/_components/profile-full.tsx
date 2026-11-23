import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  FileHeart,
  FilePlus2,
  History,
  IdCard,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { decrypt, getTenantClient } from '@clinicaiq/db';
import { PatientStatusBadge } from '../../_components/patient-status-badge';
import { GroupedTabs, type GGroup } from './grouped-tabs';
import { PatientPhoto } from './patient-photo';
import { ProfileTimeline } from './profile-timeline';
import { ProfileNotes } from './profile-notes';
import { ProfilePlans } from './profile-plans';
import { ProfileMore } from './profile-more';
import { AppointmentQuick } from './appointment-quick';
import { RememberPatient } from '@/components/patient-palette';
import { missRateText } from '@/lib/attendance';
import { answerText, priorityLabel } from '@/lib/patient-fields';
import { wallClockTime, wallDateBR, instantDateTimeBR, ageFromBirth } from '@/lib/tz';
import type { ProfileExtras } from '../profile-data';
import { addNoteAction } from '../profile-actions';
import type { DocsOverview } from '../docs-actions';
import { AttachmentsTab, DocumentsTab, QuestionnairesTab, SignaturesTab } from './profile-docs';

const APPT: Record<string, { label: string; cls: string }> = {
  SCHEDULED: { label: 'A confirmar', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  CONFIRMED: { label: 'Confirmado', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  ATTENDED: { label: 'Atendido', cls: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' },
  MISSED: { label: 'Faltou', cls: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300' },
  CANCELLED: { label: 'Cancelado', cls: 'bg-surface-alt text-muted-foreground' },
  RESCHEDULED: { label: 'Remarcado', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
};
const PAGA: Record<string, string> = { PARTICULAR: 'Particular', CONVENIO: 'Convênio', CORTESIA: 'Cortesia' };

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}
const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
};
const cancelLabel = (by: string | null) => (by === 'PATIENT' ? 'Cancelado pelo paciente' : by === 'CLINIC' ? 'Cancelado pela clínica' : 'Cancelado');

function Card({ title, icon, children, action }: { title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {icon && <span className="text-primary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <h2 className="mr-auto text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'danger' | 'warn' }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone === 'danger' ? 'text-destructive' : tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : ''}`}>{value}</p>
    </div>
  );
}

type Appt = ProfileExtras['appointments'][number];

function ApptTable({ rows, quick }: { rows: Appt[]; quick?: boolean }) {
  if (!rows.length) return <p className="py-4 text-sm text-muted-foreground">Nenhum agendamento.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">Situação</th>
            <th scope="col" className="py-2 pr-3 font-medium">Data</th>
            <th scope="col" className="py-2 pr-3 font-medium">Horário</th>
            <th scope="col" className="py-2 pr-3 font-medium">Profissional</th>
            <th scope="col" className="py-2 pr-3 font-medium">Tipo</th>
            <th scope="col" className="py-2 pr-3 font-medium">Procedimentos</th>
            {quick && <th scope="col" className="py-2 font-medium"><span className="sr-only">Ações</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((a) => {
            const st = APPT[a.status] ?? APPT.SCHEDULED;
            return (
              <tr key={a.id}>
                <td className="py-2 pr-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{a.status === 'CANCELLED' ? cancelLabel(a.cancelledBy) : st.label}</span>
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  <Link href={`/agenda?date=${a.startTime.toISOString().slice(0, 10)}`} className="hover:underline">
                    {wallDateBR(a.startTime)}
                  </Link>
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {wallClockTime(a.startTime)}–{wallClockTime(a.endTime)}
                </td>
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.professional.color ?? '#94a3b8' }} aria-hidden="true" />
                    {a.professional.name}
                  </span>
                </td>
                <td className="py-2 pr-3">{PAGA[a.type] ?? a.type}</td>
                <td className="py-2 pr-3 text-muted-foreground">{a.procedures.join(', ') || '—'}</td>
                {quick && (
                  <td className="py-2">
                    <AppointmentQuick id={a.id} status={a.status} day={a.startTime.toISOString().slice(0, 10)} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface ProfilePatient {
  id: string;
  name: string;
  socialName: string | null;
  controlNumber: number;
  active: boolean;
  birthDate: Date | null;
  email: string | null;
  priority: boolean;
  priorityType: string | null;
  insurances: { id: string; insurerName: string; planName: string | null; cardNumber: string | null; validUntil: Date | null; active: boolean }[];
}

/**
 * O perfil novo do paciente (spec 2026-11-18, F2): cabeçalho fixo com foto,
 * selos e alertas, e as abas agrupadas. O que já existia (odontograma,
 * anamnese, evoluções, imagens, financeiro, dados) chega pronto da página.
 */
export async function ProfileFull({
  tenantId,
  meId,
  role,
  patient,
  extras,
  aba,
  anamnesisAlerts,
  anamnesisMissing,
  clinical,
  finance,
  dados,
  quotes,
  canExport,
  canPrivacy,
  canFinance,
  canCrm,
  canEdit,
  toggleActive,
  docs,
}: {
  /** Documentos, assinaturas, anexos e questionários (F3). */
  docs: DocsOverview | null;
  tenantId: string;
  meId: string;
  role: string;
  patient: ProfilePatient;
  extras: ProfileExtras;
  aba?: string;
  anamnesisAlerts: { key: string; texto: string; detalhe?: string }[];
  anamnesisMissing: boolean;
  clinical: { odontograma: React.ReactNode; anamnese: React.ReactNode; evolucoes: React.ReactNode; imagens: React.ReactNode; planBadge: number; evolutions: number; files: number };
  finance: React.ReactNode;
  dados: React.ReactNode;
  quotes: { id: string; number: number; status: string; total: number; createdAt: Date }[];
  canExport: boolean;
  canPrivacy: boolean;
  canFinance: boolean;
  canCrm: boolean;
  canEdit: boolean;
  toggleActive: () => Promise<void>;
}) {
  const nome = patient.socialName || patient.name;
  const idade = ageFromBirth(patient.birthDate);
  const x = extras;
  const proximos = x.appointments.filter((a) => x.upcoming.includes(a.id)).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const passados = x.appointments.filter((a) => !x.upcoming.includes(a.id));
  const ultimosAtendidos = passados.filter((a) => a.status === 'ATTENDED').slice(0, 5);
  const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

  // Conversas do CRM: as últimas mensagens, para ler e fixar um recado.
  let mensagens: { id: string; text: string; inbound: boolean; at: Date }[] = [];
  if (canCrm && x.conversationId) {
    const rows = await getTenantClient(tenantId).chatMessage.findMany({
      where: { conversationId: x.conversationId, textEncrypted: { not: null } },
      orderBy: { at: 'desc' },
      take: 15,
      select: { id: true, textEncrypted: true, direction: true, at: true },
    });
    mensagens = rows
      .map((m) => {
        let text = '';
        try {
          text = decrypt(m.textEncrypted!, process.env.ENCRYPTION_MASTER_KEY ?? '', tenantId);
        } catch {}
        return { id: m.id, text, inbound: m.direction === 'INBOUND', at: m.at };
      })
      .filter((m) => m.text)
      .reverse();
  }

  const alertas = [
    ...anamnesisAlerts.map((a) => ({ key: a.key, text: `${a.texto}${a.detalhe ? `: ${a.detalhe}` : ''}` })),
    ...x.highlights.map((h) => ({ key: h.id, text: `${h.label}: ${h.text}` })),
  ];
  const a = x.attendance;

  const visao = (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card
          title="Próximos agendamentos"
          icon={<CalendarClock />}
          action={
            <Link href={`/agenda?novo=1&paciente=${patient.id}`} className="btn-primary btn-sm">
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" /> Agendar
            </Link>
          }
        >
          <ApptTable rows={proximos} quick />
        </Card>
        <Card title="Últimos atendimentos" icon={<History />}>
          {ultimosAtendidos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum atendimento ainda.</p>
          ) : (
            <ul className="divide-y divide-border">
              {ultimosAtendidos.map((ap) => (
                <li key={ap.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="tabular-nums">
                    {wallDateBR(ap.startTime)} {wallClockTime(ap.startTime)}
                  </span>
                  <span className="text-muted-foreground">· {ap.professional.name}</span>
                  {ap.procedures.length > 0 && <span className="text-muted-foreground">· {ap.procedures.join(', ')}</span>}
                  {x.canSeeRecord && (
                    <Link href={`/pacientes/${patient.id}?aba=evolucoes`} className="ml-auto text-xs font-medium text-primary hover:underline">
                      Abrir prontuário
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Comparecimento" icon={<ShieldCheck />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Atendidos" value={a.attended} />
            <Stat label="Faltas" value={a.missed} tone={a.missed ? 'danger' : undefined} />
            <Stat label="Cancelou (paciente)" value={a.cancelledByPatient} />
            <Stat label="Cancelou (clínica)" value={a.cancelledByClinic} />
            <Stat label="Taxa de falta" value={missRateText(a.missRate)} tone={a.missRate && a.missRate >= 0.2 ? 'warn' : undefined} />
            <Stat label="Remarcações" value={x.reschedules} />
          </div>
          {a.cancelledUnknown > 0 && <p className="mt-2 text-xs text-muted-foreground">Mais {a.cancelledUnknown} cancelamentos antigos, sem registro de quem cancelou.</p>}
        </Card>
      </div>
      <aside className="space-y-4">
        <Card title="Dados pessoais" icon={<IdCard />} action={canEdit ? <Link href={`/pacientes/${patient.id}/editar`} className="btn-ghost btn-sm">Editar</Link> : undefined}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Nascimento</dt><dd>{patient.birthDate ? `${wallDateBR(patient.birthDate)}${idade !== null ? ` (${idade})` : ''}` : '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Celular</dt><dd>{x.whatsappPhone ? formatPhone(x.whatsappPhone) : '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">E-mail</dt><dd className="truncate">{patient.email ?? '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Convênio</dt><dd>{x.insurance ? x.insurance.name : 'Particular'}</dd></div>
          </dl>
        </Card>
        {x.customFields.length > 0 && (
          <Card title="Informações adicionais">
            <dl className="space-y-2 text-sm">
              {x.customFields.map((d) => (
                <div key={d.id} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{d.label}</dt>
                  <dd className="text-right">{answerText(d, x.customAnswers[d.id]) || '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
        {canFinance && (
          <Card title="Financeiro" icon={<Wallet />} action={<Link href={`/pacientes/${patient.id}?aba=financeiro`} className="btn-ghost btn-sm">Ver</Link>}>
            <p className={`text-sm ${x.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>{x.overdue ? 'Tem conta vencida.' : 'Nada vencido.'}</p>
          </Card>
        )}
      </aside>
    </div>
  );

  const historico = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Atendidos" value={a.attended} />
        <Stat label="Faltas" value={a.missed} tone={a.missed ? 'danger' : undefined} />
        <Stat label="Cancelados pelo paciente" value={a.cancelledByPatient} />
        <Stat label="Cancelados pela clínica" value={a.cancelledByClinic} />
      </div>
      <Card title="Histórico de agendamentos" icon={<History />}>
        <ApptTable rows={passados} />
      </Card>
    </div>
  );

  const orcamentos = (
    <Card
      title="Orçamentos"
      action={
        canFinance ? (
          <Link href={`/orcamentos/novo?patientId=${patient.id}`} className="btn-primary btn-sm">
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Novo orçamento
          </Link>
        ) : undefined
      }
    >
      {!canFinance ? (
        <p className="text-sm text-muted-foreground">Seu perfil não vê orçamentos.</p>
      ) : quotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum orçamento.</p>
      ) : (
        <ul className="divide-y divide-border">
          {quotes.map((q) => (
            <li key={q.id} className="flex items-center gap-3 py-2 text-sm">
              <Link href={`/orcamentos/${q.id}`} className="font-medium hover:underline">
                Nº {q.number}
              </Link>
              <span className="text-muted-foreground">{wallDateBR(q.createdAt)}</span>
              <span className="text-xs text-muted-foreground">{q.status}</span>
              <span className="ml-auto tabular-nums">{brl(q.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const convenios = (
    <Card title="Convênios do paciente" action={canEdit ? <Link href={`/pacientes/${patient.id}/editar`} className="btn-outline btn-sm">Adicionar ou editar</Link> : undefined}>
      {patient.insurances.length === 0 ? (
        <p className="text-sm text-muted-foreground">Só particular.</p>
      ) : (
        <ul className="divide-y divide-border">
          {patient.insurances.map((i) => {
            const vencido = i.validUntil && i.validUntil.getTime() < Date.now();
            return (
              <li key={i.id} className={`flex flex-wrap items-center gap-2 py-2 text-sm ${i.active ? '' : 'opacity-60'}`}>
                <span className="font-medium">{i.insurerName}</span>
                {i.planName && <span className="text-muted-foreground">· {i.planName}</span>}
                {i.cardNumber && <span className="text-muted-foreground">· carteirinha {i.cardNumber}</span>}
                {i.validUntil && <span className={vencido ? 'text-destructive' : 'text-muted-foreground'}>· validade {wallDateBR(i.validUntil)}{vencido ? ' (vencida)' : ''}</span>}
                {!i.active && <span className="text-xs">inativo</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  const conversas = (
    <Card
      title="Conversas do WhatsApp"
      icon={<MessageCircle />}
      action={x.conversationId ? <Link href={`/crm/conversas?c=${x.conversationId}`} className="btn-outline btn-sm">Abrir no CRM</Link> : undefined}
    >
      {mensagens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem conversa no CRM.</p>
      ) : (
        <ol className="space-y-2">
          {mensagens.map((m) => (
            <li key={m.id} className={`flex ${m.inbound ? '' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.inbound ? 'bg-surface-alt' : 'bg-primary/10'}`}>
                <p className="whitespace-pre-wrap">{m.text}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  {instantDateTimeBR(m.at)}
                  {m.inbound && (
                    <form
                      action={async () => {
                        'use server';
                        await addNoteAction(patient.id, `Recado do paciente: ${m.text}`, { pinned: true });
                      }}
                    >
                      <button type="submit" className="font-medium text-primary hover:underline">Fixar como recado</button>
                    </form>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );

  const groups: GGroup[] = [
    { id: 'resumo', label: 'Resumo', tabs: [{ id: 'visao', label: 'Visão geral', content: visao }] },
    {
      id: 'clinico',
      label: 'Clínico',
      tabs: [
        { id: 'odontograma', label: 'Odontograma', badge: clinical.planBadge, locked: !x.canSeeRecord, content: clinical.odontograma },
        { id: 'anamnese', label: 'Anamnese', badge: anamnesisAlerts.length, alert: anamnesisAlerts.length > 0, locked: !x.canSeeRecord, content: clinical.anamnese },
        { id: 'evolucoes', label: 'Evoluções', badge: clinical.evolutions, locked: !x.canSeeRecord, content: clinical.evolucoes },
        { id: 'imagens', label: 'Imagens', badge: clinical.files, locked: !x.canSeeRecord, content: clinical.imagens },
        ...(docs && x.canSeeRecord
          ? [{ id: 'documentos-clinicos', label: 'Documentos clínicos', badge: docs.docs.filter((d) => d.clinical).length, content: <DocumentsTab patientId={patient.id} data={{ ...docs, docs: docs.docs.filter((d) => d.clinical) }} phone={x.whatsappPhone} /> }]
          : []),
      ],
    },
    {
      id: 'agenda',
      label: 'Agenda',
      tabs: [
        { id: 'proximos', label: 'Próximos', badge: proximos.length, content: <Card title="Próximos agendamentos" icon={<CalendarClock />}><ApptTable rows={proximos} quick /></Card> },
        { id: 'historico', label: 'Histórico de agendamentos', content: historico },
      ],
    },
    { id: 'financeiro-g', label: 'Financeiro', tabs: [{ id: 'financeiro', label: 'Extrato', content: finance }] },
    {
      id: 'comercial',
      label: 'Comercial',
      tabs: [
        { id: 'orcamentos', label: 'Orçamentos', badge: quotes.length, content: orcamentos },
        { id: 'planos', label: 'Planos de tratamento', badge: x.plans.filter((p) => p.status === 'IN_PROGRESS').length, locked: !x.canSeeRecord, content: x.canSeeRecord ? <ProfilePlans patientId={patient.id} plans={x.plans} canFinance={canFinance} /> : <p className="text-sm text-muted-foreground">Sem acesso ao prontuário.</p> },
        { id: 'convenios', label: 'Convênios', content: convenios },
      ],
    },
    {
      id: 'relacionamento',
      label: 'Relacionamento',
      tabs: [
        { id: 'linha-do-tempo', label: 'Linha do tempo', content: <ProfileTimeline patientId={patient.id} initial={x.timeline.items} more={x.timeline.more} /> },
        { id: 'observacoes', label: 'Observações', badge: x.notes.filter((n) => n.pinned).length, content: <ProfileNotes patientId={patient.id} notes={x.notes} meId={meId} canEditAll={role === 'OWNER' || role === 'ADMIN'} /> },
        ...(canCrm ? [{ id: 'conversas', label: 'Conversas', content: conversas }] : []),
      ],
    },
    ...(docs
      ? [
          {
            id: 'documentos-g',
            label: 'Documentos',
            tabs: [
              { id: 'documentos', label: 'Documentos', badge: docs.docs.filter((d) => !d.clinical).length, content: <DocumentsTab patientId={patient.id} data={{ ...docs, docs: docs.docs.filter((d) => !d.clinical) }} phone={x.whatsappPhone} /> },
              { id: 'assinaturas', label: 'Assinaturas', badge: docs.signatures.filter((s) => s.state === 'PENDING' || s.state === 'VIEWED').length, content: <SignaturesTab data={docs} phone={x.whatsappPhone} /> },
              { id: 'anexos', label: 'Anexos', badge: docs.files.length, content: <AttachmentsTab patientId={patient.id} data={docs} /> },
              { id: 'questionarios', label: 'Questionários', badge: docs.questionnaires.filter((q) => !q.answeredAt && !q.expired).length, content: <QuestionnairesTab patientId={patient.id} data={docs} phone={x.whatsappPhone} /> },
            ],
          },
        ]
      : []),
    { id: 'cadastro', label: 'Cadastro', tabs: [{ id: 'dados', label: 'Dados cadastrais', content: dados }] },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6 lg:p-8">
      <RememberPatient id={patient.id} name={nome} controlNumber={patient.controlNumber} />
      <Link href="/pacientes" className="inline-flex items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        ‹ Pacientes
      </Link>

      <header className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <PatientPhoto patientId={patient.id} name={nome} url={x.photoUrl} canEdit={canEdit} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{nome}</h1>
              <PatientStatusBadge active={patient.active} />
              {patient.priority && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{priorityLabel(patient.priorityType)}</span>}
              {x.insurance && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${x.insurance.expired ? 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200' : 'bg-primary/10 text-primary'}`}>
                  {x.insurance.name}
                  {x.insurance.expired ? ' (vencido)' : ''}
                </span>
              )}
              {x.overdue && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200">Devendo</span>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Nº {String(patient.controlNumber).padStart(4, '0')}
              {idade !== null && ` · ${idade} anos`}
              {patient.socialName && patient.socialName !== patient.name && ` · nome civil: ${patient.name}`}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {x.whatsappPhone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatPhone(x.whatsappPhone)}
                </span>
              )}
              {patient.email && (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="truncate">{patient.email}</span>
                </span>
              )}
              <span>Último atendimento: {x.lastAttended ? `${wallDateBR(x.lastAttended.startTime)} com ${x.lastAttended.professional}` : 'nenhum'}</span>
              <span>Próximo: {x.next ? `${wallDateBR(x.next.startTime)} às ${wallClockTime(x.next.startTime)}` : 'nada marcado'}</span>
            </div>
            {(alertas.length > 0 || (x.canSeeRecord && anamnesisMissing)) && (
              <div className="mt-3 flex flex-wrap gap-2" role={alertas.length ? 'alert' : undefined}>
                {alertas.map((al) => (
                  <span key={al.key} className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-800 ring-1 ring-inset ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    {al.text}
                  </span>
                ))}
                {x.canSeeRecord && anamnesisMissing && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
                    <FileHeart className="h-3.5 w-3.5" aria-hidden="true" /> Anamnese não preenchida
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/agenda?novo=1&paciente=${patient.id}`} className="btn-primary btn-sm">
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" /> Agendar
            </Link>
            {x.whatsappPhone && (
              <a
                href={canCrm && x.conversationId ? `/crm/conversas?c=${x.conversationId}` : `https://wa.me/${waNumber(x.whatsappPhone)}`}
                target={canCrm && x.conversationId ? undefined : '_blank'}
                rel="noreferrer"
                className="btn-outline btn-sm"
              >
                <MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> Chamar no WhatsApp
              </a>
            )}
            {canEdit && (
              <Link href={`/pacientes/${patient.id}/editar`} className="btn-outline btn-sm">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Editar cadastro
              </Link>
            )}
            <ProfileMore patientId={patient.id} canExport={canExport} canPrivacy={canPrivacy} active={patient.active} toggleActive={toggleActive} />
          </div>
        </div>
      </header>

      <GroupedTabs groups={groups} initial={aba} />
    </div>
  );
}
