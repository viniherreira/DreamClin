import 'server-only';

import { decrypt, getTenantClient, prisma } from '@clinicaiq/db';
import { getTenantModules, hasCapability } from '@/lib/access';
import { attendanceOf } from '@/lib/attendance';
import { highlightedAnswers, readCustomAnswers } from '@/lib/patient-fields';
import { BACKFILL_MARK } from '@/lib/patient-events';
import { backfillPatientTimeline } from '@/lib/patient-timeline';
import { signObject, storageEnabled } from '@/lib/storage';
import { clinicToday } from '@/lib/tz';
import { loadCustomFieldDefs } from '../patient-extra';

/**
 * O que o perfil novo do paciente (spec 2026-11-18, F2) lê além da ficha de
 * sempre: foto, alertas das informações adicionais, convênio, último e próximo
 * atendimento, comparecimento, linha do tempo, observações, planos de
 * tratamento e a conversa do CRM (só o id, para o botão "Chamar no WhatsApp").
 */

export const TIMELINE_PAGE = 20;

export async function loadTimelinePage(tenantId: string, patientId: string, opts: { before?: Date; types?: string[] } = {}) {
  const rows = await getTenantClient(tenantId).patientEvent.findMany({
    where: {
      patientId,
      type: opts.types?.length ? { in: opts.types } : { not: BACKFILL_MARK },
      ...(opts.before ? { at: { lt: opts.before } } : {}),
    },
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    take: TIMELINE_PAGE + 1,
    select: { id: true, type: true, summary: true, actorId: true, actorLabel: true, refType: true, refId: true, at: true },
  });
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const nomes = ids.length ? await prisma.user.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nome = new Map(nomes.map((n) => [n.id, n.name]));
  return {
    items: rows.slice(0, TIMELINE_PAGE).map((r) => ({ ...r, at: r.at.toISOString(), who: r.actorId ? (nome.get(r.actorId) ?? 'Equipe') : (r.actorLabel ?? 'Sistema') })),
    more: rows.length > TIMELINE_PAGE,
  };
}

export type TimelineItem = Awaited<ReturnType<typeof loadTimelinePage>>['items'][number];

export async function loadProfileExtras(tenantId: string, patientId: string) {
  const db = getTenantClient(tenantId);
  const hoje = new Date(`${clinicToday()}T00:00:00.000Z`);
  await backfillPatientTimeline(tenantId, patientId);

  const [p, defs, appts, notes, plans, modules, veProntuario, veFinanceiro] = await Promise.all([
    db.patient.findFirst({
      where: { id: patientId },
      select: { photoPath: true, customFields: true, priority: true, priorityType: true, phoneEncrypted: true, insurances: { where: { tenantId, active: true }, select: { insurerName: true, validUntil: true, cardNumber: true, planName: true } } },
    }),
    loadCustomFieldDefs(tenantId),
    db.appointment.findMany({
      where: { patientId },
      orderBy: { startTime: 'desc' },
      take: 300,
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        type: true,
        cancelledBy: true,
        cancelReason: true,
        notes: true,
        professional: { select: { name: true, color: true } },
        procedure: { select: { name: true } },
        items: { select: { procedure: { select: { name: true } } } },
      },
    }),
    db.patientNote.findMany({
      where: { patientId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, content: true, pinned: true, showInAgenda: true, createdAt: true, userId: true, user: { select: { name: true } } },
    }),
    db.treatmentPlan.findMany({
      where: { patientId },
      orderBy: { number: 'desc' },
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        professionalId: true,
        createdAt: true,
        closedAt: true,
        quoteId: true,
        items: { orderBy: { order: 'asc' }, select: { id: true, description: true, teeth: true, priceCents: true, quantity: true, doneAt: true, findingId: true } },
      },
    }),
    getTenantModules(tenantId),
    hasCapability(tenantId, 'prontuario'),
    hasCapability(tenantId, 'financeiro'),
  ]);

  const respostas = readCustomAnswers(p?.customFields);
  const proximas = appts.filter((a) => a.startTime >= hoje && ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'].includes(a.status)).reverse();
  const ultimo = appts.find((a) => a.status === 'ATTENDED');
  const conversa = modules.crm ? await db.conversation.findFirst({ where: { patientId }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } }) : null;
  const insurance = p?.insurances[0] ?? null;
  const remarcacoes = await db.appointmentReschedule.count({ where: { patientId } });
  const devendo = veFinanceiro
    ? await db.financialTitle
        .count({ where: { patientId, direction: 'RECEIVABLE', status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: hoje } } })
        .catch(() => 0)
    : 0;

  return {
    photoUrl: p?.photoPath && storageEnabled() ? await signObject(p.photoPath, 900) : null,
    highlights: highlightedAnswers(defs, respostas),
    customFields: defs.filter((d) => d.active),
    customAnswers: respostas,
    insurance: insurance ? { name: insurance.insurerName, plan: insurance.planName, expired: Boolean(insurance.validUntil && insurance.validUntil < hoje) } : null,
    overdue: devendo > 0,
    lastAttended: ultimo ? { startTime: ultimo.startTime, professional: ultimo.professional.name } : null,
    next: proximas[0] ? { id: proximas[0].id, startTime: proximas[0].startTime, professional: proximas[0].professional.name } : null,
    attendance: attendanceOf(appts),
    reschedules: remarcacoes,
    appointments: appts.map((a) => ({
      ...a,
      procedures: [...new Set([a.procedure?.name, ...a.items.map((i) => i.procedure?.name)].filter((x): x is string => !!x))],
    })),
    upcoming: proximas.map((a) => a.id),
    notes,
    plans,
    conversationId: conversa?.id ?? null,
    whatsappPhone: (() => {
      try {
        return p?.phoneEncrypted ? decrypt(p.phoneEncrypted, process.env.ENCRYPTION_MASTER_KEY ?? '', tenantId) : '';
      } catch {
        return '';
      }
    })(),
    timeline: await loadTimelinePage(tenantId, patientId),
    canSeeRecord: veProntuario,
  };
}

export type ProfileExtras = Awaited<ReturnType<typeof loadProfileExtras>>;
