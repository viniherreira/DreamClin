'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma, getTenantClient, decrypt } from '@clinicaiq/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO,
} from 'date-fns';
import { PROFESSIONAL_COLORS } from './_components/constants';
import { buildWorkingHoursMap } from '@/lib/working-hours';
import { getUnitContext } from '@/lib/units';
import { unitAppointmentWhere } from '@/lib/unit-rules';
import { readAgendaRules } from '@/lib/agenda-rules';
import { wallClockTime } from '@/lib/tz';

/** Regras da agenda da clínica (Configurações → Agenda → Regras da agenda). */
async function agendaRules(tenantId: string) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return readAgendaRules(t?.settings);
}
import { capabilityBlocked, hasCapability, writeBlocked } from '@/lib/access';
import { applyAction, type FlowAction } from '@/lib/appointment-flow';
import { isLabelColor } from '@/lib/label-colors';
import { formatPhoneBR } from '@/lib/document-content';
import { normalizeBrazilPhone } from '@/lib/phone';
import { getWhatsAppHealth, prepareAppointmentMessage, deliverPrepared } from '@/lib/whatsapp';
import type { Preparation } from '@/lib/whatsapp';
import { refOutsideTenant, refErrorMessage } from '@/lib/owns';
import { appointmentStatusEvent, notifyCrm } from '@/crm/notify';
import { agendaFinance, AgendaAbort } from '@/fin/agenda-bridge';
import { timelineAppointment } from '@/lib/timeline-hooks';
import { appointmentSnapshot, auditAppointment, auditAppointmentDeleted, loadAppointmentAudit } from '@/lib/appointment-audit-server';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { displayName } from '@/lib/patient-name';
import { highlightedAnswers, priorityLabel, readCustomAnswers } from '@/lib/patient-fields';
import { cancelError, cancelReasonText, DEFAULT_CANCEL_REASONS, directStatusChange, isReschedule, statusLabel } from '@/lib/appointment-status';
import { recordPatientEvent } from '@/lib/patient-timeline';

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function requireTenant() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const tenant = await prisma.tenant.findFirst({
    where: { users: { some: { clerkUserId: userId, active: true } } },
    select: { id: true },
  });
  if (!tenant) redirect('/onboarding');

  const user = await prisma.user.findFirst({
    where: { clerkUserId: userId, tenantId: tenant.id, active: true },
    select: { id: true },
  });

  if (!user) redirect('/sign-in');


  return { tenantId: tenant.id, userId: user.id };
}

// ─── Get agenda data ──────────────────────────────────────────────────────────

export async function getAgendaData(dateStr: string, view: 'day' | 'week' | 'month' = 'day') {
  const { tenantId, userId } = await requireTenant();
  const db = getTenantClient(tenantId);
  // A agenda é da unidade escolhida no topo; os bloqueios são do profissional (valem em todas).
  const units = await getUnitContext(tenantId, userId);
  const unit = units.current;

  const date = parseISO(dateStr);
  // O mês mostra as semanas inteiras: começa na segunda antes do dia 1 e vai até o domingo depois do último.
  const from =
    view === 'month'
      ? startOfWeek(startOfMonth(date), { weekStartsOn: 1 })
      : view === 'week'
        ? startOfWeek(date, { weekStartsOn: 1 })
        : startOfDay(date);
  const to =
    view === 'month'
      ? endOfWeek(endOfMonth(date), { weekStartsOn: 1 })
      : view === 'week'
        ? endOfWeek(date, { weekStartsOn: 1 })
        : endOfDay(date);

  const [appointments, blockedSlots, professionals, procedures] = await Promise.all([
    db.appointment.findMany({
      where: { startTime: { gte: from, lte: to }, ...unitAppointmentWhere(unit.id, units.main.id) },
      include: {
        patient: { select: { id: true, name: true, socialName: true } },
        professional: { select: { id: true, name: true, specialty: true } },
        procedure: { select: { id: true, name: true, durationMinutes: true } },
        label: { select: { id: true, name: true, color: true } },
      },
      orderBy: { startTime: 'asc' },
    }),
    db.blockedSlot.findMany({
      where: { startTime: { gte: from, lte: to } },
      include: { professional: { select: { id: true, name: true } } },
    }),
    db.professional.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    }),
    db.procedure.findMany({
      where: { active: true, deletedAt: null },
      orderBy: { name: 'asc' },
    }),
  ]);
  const labels = await db.appointmentLabel.findMany({
    where: { active: true },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, color: true },
  });

  // Each professional keeps its own chosen color; fall back to the palette by
  // index for any created before colors existed.
  const professionalsWithColor = professionals.map((p, i) => ({
    ...p,
    // Decimal não atravessa para o navegador.
    commissionPercent: p.commissionPercent != null ? Number(p.commissionPercent) : null,
    color: p.color ?? PROFESSIONAL_COLORS[i % PROFESSIONAL_COLORS.length],
  }));

  // Serialize every Decimal field — Prisma Decimal is not a plain object and
  // can't cross the Server→Client boundary. Procedure has two: basePrice and
  // maxDiscountPercent (null until a discount cap is set on the procedure).
  const serializedProcedures = procedures.map((p) => ({
    ...p,
    basePrice: Number(p.basePrice),
    maxDiscountPercent: p.maxDiscountPercent != null ? Number(p.maxDiscountPercent) : null,
  }));

  const [workingHours, whatsappHealth, rules] = await Promise.all([
    buildWorkingHoursMap(
      tenantId,
      professionals.map((p) => p.id),
      { unitId: unit.id, mainId: units.main.id, businessHours: unit.businessHours },
    ),
    // Surfaced here because this is where appointments are booked: a silently
    // dead WhatsApp means confirmations stop going out, and the clinic would
    // otherwise only notice by visiting the WhatsApp tab.
    getWhatsAppHealth(tenantId),
    agendaRules(tenantId),
  ]);

  // Com várias unidades, a agenda mostra quem atende nesta (algum dia do
  // expediente aqui) ou já tem horário marcado aqui no período.
  const comHorario = new Set(appointments.map((a) => a.professionalId));
  const atendemAqui = units.multi
    ? professionalsWithColor.filter((p) => comHorario.has(p.id) || (workingHours[p.id] ?? []).some(Boolean))
    : professionalsWithColor;
  // Unidade nova, ninguém com dia marcado nela ainda: mostra todos (dá para
  // agendar) e a tela avisa onde dizer quem atende aqui.
  const noneHere = units.multi && atendemAqui.length === 0 && professionalsWithColor.length > 0;
  const daUnidade = noneHere ? professionalsWithColor : atendemAqui;
  // Nesse caso vale o horário de sempre de cada um (senão a grade ficaria toda fechada).
  const horarios = noneHere ? await buildWorkingHoursMap(tenantId, professionals.map((p) => p.id)) : workingHours;

  // Financeiro completo: o cifrão de cada horário e o que a janela de agendar precisa.
  const fin = await agendaFinance(tenantId);
  const preco = new Map(serializedProcedures.map((p) => [p.id, p.basePrice]));
  const finance = fin
    ? {
        billing: fin.statuses(appointments, (id) => preco.get(id)),
        showPrices: fin.showPrices,
        canReceive: fin.ctx.can('fin_receber'),
        insurers: await fin.insurers(),
      }
    : null;

  // Paciente e agenda novos: o nome social é o nome da agenda.
  const nomeSocial = await pacienteAgendaEnabled(tenantId);
  return {
    appointments: appointments.map(({ patient, ...a }) => ({ ...a, patient: { id: patient.id, name: nomeSocial ? displayName(patient) : patient.name } })),
    blockedSlots,
    finance,
    professionals: daUnidade,
    unit: { id: unit.id, name: unit.name, multi: units.multi, noneHere },
    rules,
    procedures: serializedProcedures,
    workingHours: horarios,
    whatsappHealth,
    labels,
  };
}

// ─── Search patients (autocomplete) ──────────────────────────────────────────

export async function searchPatients(query: string) {
  const { tenantId } = await requireTenant();
  // Tokenized match: each word must appear somewhere in the name, so full
  // names, extra middle names, word order and trailing spaces all still hit.
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length === 0) return [];

  const db = getTenantClient(tenantId);
  const patients = await db.patient.findMany({
    where: {
      deletedAt: null,
      active: true,
      AND: words.map((w) => ({ name: { contains: w, mode: 'insensitive' as const } })),
    },
    select: { id: true, name: true, controlNumber: true },
    take: 10,
    orderBy: { name: 'asc' },
  });

  return patients.map((p) => ({
    id: p.id,
    name: p.name,
    controlNumber: p.controlNumber,
  }));
}

/**
 * O paciente que vem na URL (`/agenda?novo=1&paciente=…`, o "Agendar
 * avaliação" do CRM). Só da própria clínica; qualquer outro id vira null e a
 * agenda abre normalmente.
 */
export async function getPrefillPatient(id: string) {
  const { tenantId } = await requireTenant();
  return getTenantClient(tenantId).patient.findFirst({
    where: { id, deletedAt: null, active: true },
    select: { id: true, name: true, controlNumber: true },
  });
}

// ─── Appointment validation schema ───────────────────────────────────────────

const appointmentSchema = z.object({
  patientId: z.string().min(1, 'Paciente obrigatório'),
  professionalId: z.string().min(1, 'Profissional obrigatório'),
  procedureId: z.string().optional().or(z.literal('')),
  date: z.string().min(1, 'Data obrigatória'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
  type: z.enum(['PARTICULAR', 'CONVENIO', 'CORTESIA']).default('PARTICULAR'),
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'ATTENDED', 'MISSED']).default('SCHEDULED'),
  notes: z.string().max(500).optional().or(z.literal('')),
  sendWhatsApp: z.string().optional(),
});

export type AppointmentFormState =
  | { success: true; appointmentId: string }
  | { success: false; errors: Record<string, string[]>; message?: string };

/**
 * Hora de parede em UTC (lib/tz.ts): 14:00 vira 14:00Z. Montado com as partes
 * UTC, e não com `setHours`, que usa o fuso de quem roda: na Vercel (UTC) dava
 * o mesmo, mas num computador no horário de Brasília deslocava 3 horas.
 */
function buildDateTimes(date: string, startTime: string, endTime: string) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, sh, sm, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d, eh, em, 0, 0));
  return { start, end };
}

async function checkConflict(
  tenantId: string,
  professionalId: string,
  start: Date,
  end: Date,
  excludeId?: string,
) {
  const conflict = await prisma.appointment.findFirst({
    where: {
      tenantId,
      professionalId,
      status: { notIn: ['CANCELLED', 'MISSED'] },
      NOT: excludeId ? { id: excludeId } : undefined,
      AND: [
        { startTime: { lt: end } },
        { endTime: { gt: start } },
      ],
    },
    // O profissional não está em duas unidades ao mesmo tempo: confere em todas.
    include: { patient: { select: { name: true } }, unit: { select: { name: true } } },
  });
  return conflict;
}

/** Finds a blocked slot overlapping [start, end) for the professional. */
async function checkBlocked(
  tenantId: string,
  professionalId: string,
  start: Date,
  end: Date,
) {
  return prisma.blockedSlot.findFirst({
    where: {
      tenantId,
      professionalId,
      AND: [{ startTime: { lt: end } }, { endTime: { gt: start } }],
    },
  });
}

/** Itens e convênio que a janela de agendar manda quando o financeiro novo está ligado. */
async function financeFields(fin: NonNullable<Awaited<ReturnType<typeof agendaFinance>>>, formData: FormData, type: string) {
  const lidos = fin.readItems(formData);
  if (!lidos.ok) return { ok: false as const, message: lidos.message };
  const convenio = type === 'CONVENIO' ? String(formData.get('insuranceContactId') ?? '').trim() || null : null;
  if (convenio && !(await fin.insurerOk(convenio))) return { ok: false as const, message: 'Convênio não encontrado.' };
  return { ok: true as const, items: lidos.items, insuranceContactId: convenio };
}

// ─── Create appointment ───────────────────────────────────────────────────────

export async function createAppointment(
  _prev: AppointmentFormState | null,
  formData: FormData,
): Promise<AppointmentFormState> {
  const { tenantId, userId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return { success: false, errors: {}, message: bloqueio };

  const raw = Object.fromEntries(formData.entries());
  const parsed = appointmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, errors: parsed.error.flatten().fieldErrors };
  }

  const { patientId, professionalId, procedureId, date, startTime, endTime, type, status, notes, sendWhatsApp } = parsed.data;
  const { start, end } = buildDateTimes(date, startTime, endTime);

  if (end <= start) {
    return { success: false, errors: { endTime: ['Horário de término deve ser após o início'] } };
  }

  const foreign = await refOutsideTenant(tenantId, { patientId, professionalId, procedureId });
  if (foreign) {
    return { success: false, errors: {}, message: refErrorMessage(foreign) };
  }

  const conflict = (await agendaRules(tenantId)).allowOverlap ? null : await checkConflict(tenantId, professionalId, start, end);
  if (conflict) {
    return {
      success: false,
      errors: {},
      message: `Conflito com agendamento de ${conflict.patient.name} às ${wallClockTime(start)}${conflict.unit ? ` (${conflict.unit.name})` : ''}`,
    };
  }

  const blocked = await checkBlocked(tenantId, professionalId, start, end);
  if (blocked) {
    return {
      success: false,
      errors: {},
      message: `Horário bloqueado${blocked.reason ? ` (${blocked.reason})` : ''}. Escolha outro horário.`,
    };
  }

  const { current: unit } = await getUnitContext(tenantId, userId);
  const fin = await agendaFinance(tenantId);
  const extra = fin ? await financeFields(fin, formData, type) : { ok: true as const, items: null, insuranceContactId: null };
  if (!extra.ok) return { success: false, errors: {}, message: extra.message };
  const dados = {
    tenantId,
    unitId: unit.id,
    patientId,
    professionalId,
    procedureId: procedureId || null,
    startTime: start,
    endTime: end,
    status,
    type,
    notes: notes || null,
    createdById: userId,
    updatedById: userId,
    ...(fin ? { insuranceContactId: extra.insuranceContactId } : {}),
  };
  let appointment;
  try {
    // Com o financeiro novo, os itens (procedimentos e valores) entram junto, na mesma transação.
    appointment = fin
      ? await fin.ctx.db.$transaction(async (tx) => {
          const criado = await tx.appointment.create({ data: dados });
          await fin.save(tx, criado.id, extra.items);
          return criado;
        })
      : await prisma.appointment.create({ data: dados });
  } catch (e) {
    if (e instanceof AgendaAbort) return { success: false, errors: {}, message: e.message };
    throw e;
  }

  // Avisa o CRM depois da resposta; ele nunca falha nem atrasa o agendamento.
  after(() => notifyCrm(tenantId, { type: 'appointment.created', patientId, appointmentId: appointment.id }));
  after(() => timelineAppointment(tenantId, appointment.id, 'created', userId));
  await auditAppointment(tenantId, userId, appointment.id, 'APPOINTMENT_CREATED', null);

  if (sendWhatsApp) {
    // Record the message *before* returning, while we still control the request.
    // `after()` is an optimisation, not a guarantee — if the platform never runs
    // the callback, a booking recorded here still left a row in the history.
    // Recorded inside `after()`, the same booking would leave no trace.
    let prepared: Preparation | null = null;
    try {
      prepared = await prepareAppointmentMessage(appointment.id, 'created');
    } catch (error) {
      console.error('[agenda] falha ao registrar WhatsApp de criacao', appointment.id, error);
    }

    after(async () => {
      // The network call runs after the response is flushed, so a slow WhatsApp
      // never delays saving the appointment.
      try {
        if (prepared?.kind === 'send') await deliverPrepared(prepared.send);
      } catch (error) {
        // The row is already in the history, with the failure.
        console.error('[agenda] falha ao enviar WhatsApp de criacao', appointment.id, error);
      }

    });
  }

  revalidatePath('/agenda');
  return { success: true, appointmentId: appointment.id };
}

// ─── Update appointment ───────────────────────────────────────────────────────

export async function updateAppointment(
  id: string,
  _prev: AppointmentFormState | null,
  formData: FormData,
): Promise<AppointmentFormState> {
  const { tenantId, userId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return { success: false, errors: {}, message: bloqueio };

  const raw = Object.fromEntries(formData.entries());
  const parsed = appointmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, errors: parsed.error.flatten().fieldErrors };
  }

  const { patientId, professionalId, procedureId, date, startTime, endTime, type, status, notes } = parsed.data;
  const { start, end } = buildDateTimes(date, startTime, endTime);

  if (end <= start) {
    return { success: false, errors: { endTime: ['Horário de término deve ser após o início'] } };
  }

  const foreign = await refOutsideTenant(tenantId, { patientId, professionalId, procedureId });
  if (foreign) {
    return { success: false, errors: {}, message: refErrorMessage(foreign) };
  }

  const conflict = (await agendaRules(tenantId)).allowOverlap ? null : await checkConflict(tenantId, professionalId, start, end, id);
  if (conflict) {
    return {
      success: false,
      errors: {},
      message: `Conflito com agendamento de ${conflict.patient.name}${conflict.unit ? ` (${conflict.unit.name})` : ''}`,
    };
  }

  const blocked = await checkBlocked(tenantId, professionalId, start, end);
  if (blocked) {
    return {
      success: false,
      errors: {},
      message: `Horário bloqueado${blocked.reason ? ` (${blocked.reason})` : ''}. Escolha outro horário.`,
    };
  }

  const fin = await agendaFinance(tenantId);
  const extra = fin ? await financeFields(fin, formData, type) : { ok: true as const, items: null, insuranceContactId: null };
  if (!extra.ok) return { success: false, errors: {}, message: extra.message };
  // Auditoria: a foto de antes, para gravar o que mudou.
  const antes = await appointmentSnapshot(tenantId, id);
  const antesRemarcar = await prisma.appointment.findFirst({ where: { id, tenantId }, select: { startTime: true, endTime: true, professionalId: true, patientId: true, status: true } });
  const dados = {
    patientId,
    professionalId,
    procedureId: procedureId || null,
    startTime: start,
    endTime: end,
    status,
    type,
    notes: notes || null,
    updatedById: userId,
    ...(fin ? { insuranceContactId: extra.insuranceContactId } : {}),
  };
  try {
    if (fin) {
      await fin.ctx.db.$transaction(async (tx) => {
        const r = await tx.appointment.updateMany({ where: { id, tenantId }, data: dados });
        if (!r.count) throw new AgendaAbort('Agendamento não encontrado.');
        await fin.save(tx, id, extra.items);
      });
    } else {
      await prisma.appointment.update({ where: { id, tenantId }, data: dados });
    }
  } catch (e) {
    if (e instanceof AgendaAbort) return { success: false, errors: {}, message: e.message };
    throw e;
  }
  if (fin && status === 'ATTENDED') await fin.attended(id);

  after(() => notifyCrm(tenantId, { type: appointmentStatusEvent(status), patientId, appointmentId: id }));
  // Linha do tempo só quando a situação mudou de verdade (editar a observação não é "confirmou" de novo).
  if (!antes || antes.status !== status) after(() => timelineAppointment(tenantId, id, 'status', userId));
  if (antesRemarcar && isReschedule(antesRemarcar, { startTime: start, endTime: end, professionalId })) {
    await recordReschedule(tenantId, userId, id, antesRemarcar, { startTime: start, endTime: end, professionalId }, 'AGENDA', String(formData.get('rescheduleReason') ?? ''));
  }
  await auditAppointment(tenantId, userId, id, 'APPOINTMENT_UPDATED', antes);

  revalidatePath('/agenda');
  return { success: true, appointmentId: id };
}

// ─── Move appointment (drag-and-drop) ────────────────────────────────────────

export async function moveAppointment(
  id: string,
  newStartISO: string,
  newEndISO: string,
  professionalId: string,
) {
  const { tenantId, userId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return { success: false, message: bloqueio };

  const start = new Date(newStartISO);
  const end = new Date(newEndISO);

  const foreign = await refOutsideTenant(tenantId, { professionalId });
  if (foreign) {
    return { success: false, message: refErrorMessage(foreign) };
  }

  const conflict = (await agendaRules(tenantId)).allowOverlap ? null : await checkConflict(tenantId, professionalId, start, end, id);
  if (conflict) {
    return { success: false, message: `Conflito com ${conflict.patient.name}` };
  }

  const blocked = await checkBlocked(tenantId, professionalId, start, end);
  if (blocked) {
    return { success: false, message: `Horário bloqueado${blocked.reason ? ` (${blocked.reason})` : ''}` };
  }

  const antesMover = await appointmentSnapshot(tenantId, id);
  const antesArrastar = await prisma.appointment.findFirst({ where: { id, tenantId }, select: { startTime: true, endTime: true, professionalId: true, patientId: true, status: true } });
  const movido = await prisma.appointment.update({
    where: { id, tenantId },
    data: { startTime: start, endTime: end, professionalId, updatedById: userId },
  });
  await auditAppointment(tenantId, userId, id, 'APPOINTMENT_MOVED', antesMover);
  if (antesArrastar && isReschedule(antesArrastar, { startTime: start, endTime: end, professionalId })) {
    await recordReschedule(tenantId, userId, id, antesArrastar, { startTime: start, endTime: end, professionalId }, 'DRAG');
  }
  after(() => notifyCrm(tenantId, { type: 'appointment.rescheduled', patientId: movido.patientId, appointmentId: id }));
  after(() => timelineAppointment(tenantId, id, 'rescheduled', userId));

  revalidatePath('/agenda');
  return { success: true };
}

// ─── Blocked slots ───────────────────────────────────────────────────────────

const blockSchema = z.object({
  professionalId: z.string().min(1, 'Selecione um profissional'),
  date: z.string().min(1, 'Data obrigatória'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
  reason: z.string().max(120).optional().or(z.literal('')),
});

export interface BlockedSlotDTO {
  id: string;
  startTime: Date;
  endTime: Date;
  reason: string | null;
  professional: { id: string; name: string };
}

export type BlockFormState =
  | { success: true; slot: BlockedSlotDTO }
  | { success: false; message: string };

export async function createBlockedSlot(
  _prev: BlockFormState | null,
  formData: FormData,
): Promise<BlockFormState> {
  const { tenantId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return { success: false, message: bloqueio };

  const parsed = blockSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { success: false, message: first ?? 'Dados inválidos.' };
  }
  const { professionalId, date, startTime, endTime, reason } = parsed.data;

  const prof = await prisma.professional.findFirst({
    where: { id: professionalId, tenantId },
    select: { id: true },
  });
  if (!prof) return { success: false, message: 'Profissional inválido.' };

  const { start, end } = buildDateTimes(date, startTime, endTime);
  if (end <= start) return { success: false, message: 'O fim deve ser após o início.' };

  const appt = await checkConflict(tenantId, professionalId, start, end);
  if (appt) {
    return {
      success: false,
      message: `Há um agendamento nesse horário (${appt.patient.name}). Cancele-o antes de bloquear.`,
    };
  }

  const slot = await prisma.blockedSlot.create({
    data: { tenantId, professionalId, startTime: start, endTime: end, reason: reason || null },
    include: { professional: { select: { id: true, name: true } } },
  });

  revalidatePath('/agenda');
  // Return the created slot so the client can add it to the grid instantly
  // (optimistic UI) instead of refetching the whole agenda.
  return {
    success: true,
    slot: {
      id: slot.id,
      startTime: slot.startTime,
      endTime: slot.endTime,
      reason: slot.reason,
      professional: slot.professional,
    },
  };
}

export async function deleteBlockedSlot(id: string) {
  const { tenantId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return;
  await prisma.blockedSlot.deleteMany({ where: { id, tenantId } });
  revalidatePath('/agenda');
}

// ─── Update status ────────────────────────────────────────────────────────────

export async function updateAppointmentStatus(
  id: string,
  status: 'SCHEDULED' | 'CONFIRMED' | 'RESCHEDULED' | 'CANCELLED' | 'ATTENDED' | 'MISSED',
  cancelReason?: string,
) {
  const { tenantId, userId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return;

  const antesSituacao = await appointmentSnapshot(tenantId, id);
  const atualizado = await prisma.appointment.update({
    where: { id, tenantId },
    data: {
      status,
      cancelReason: status === 'CANCELLED' ? (cancelReason ?? null) : null,
      ...(status === 'CONFIRMED' ? { confirmationSource: 'RECEPTION' } : {}),
      updatedById: userId,
    },
  });
  await auditAppointment(tenantId, userId, id, 'APPOINTMENT_STATUS', antesSituacao);
  if (status === 'ATTENDED') await (await agendaFinance(tenantId))?.attended(id);
  after(() => notifyCrm(tenantId, { type: appointmentStatusEvent(status), patientId: atualizado.patientId, appointmentId: id }));
  after(() => timelineAppointment(tenantId, id, 'status', userId));

  revalidatePath('/agenda');
}

// ─── Cancel appointment (keeps it on the agenda, greyed) ──────────────────────

export async function cancelAppointment(id: string, cancelReason?: string) {
  return updateAppointmentStatus(id, 'CANCELLED', cancelReason);
}

// ─── Delete appointment (removes it entirely) ─────────────────────────────────

/**
 * Hard-deletes an appointment. Any WhatsApp messages sent for it are kept as
 * history but detached (appointmentId → null) so the delete isn't blocked by the
 * foreign key. Tenant-scoped: only the owner's row can be removed.
 */
export async function deleteAppointment(id: string) {
  const { tenantId, userId } = await requireTenant();
  // Paciente e agenda novos: excluir (lançado por engano) é do dono e do administrador; os outros cancelam.
  if ((await pacienteAgendaEnabled(tenantId)) && !(await hasCapability(tenantId, 'agenda_excluir'))) {
    return { success: false as const, error: 'forbidden' as const, message: 'Só o dono ou o administrador exclui agendamento. Para tirar da agenda, use Cancelar.' };
  }

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return { success: false as const, error: 'blocked' as const };

  const appt = await prisma.appointment.findFirst({
    where: { id, tenantId },
    select: { id: true, patientId: true },
  });
  if (!appt) return { success: false as const, error: 'not-found' };

  // Financeiro completo: com pagamento não exclui; sem pagamento, as contas em aberto são canceladas.
  const fin = await agendaFinance(tenantId);
  const recusa = fin ? await fin.deleting(id) : null;
  if (recusa) return { success: false as const, error: 'has-payment' as const, message: recusa };

  const antesExcluir = await appointmentSnapshot(tenantId, id);
  await prisma.$transaction([
    prisma.whatsAppMessage.updateMany({
      where: { appointmentId: id, tenantId },
      data: { appointmentId: null },
    }),
    prisma.appointment.delete({ where: { id, tenantId } }),
  ]);

  // O agendamento some; a foto de antes fica no registro, com quem excluiu.
  await auditAppointmentDeleted(tenantId, userId, id, antesExcluir);
  after(() => notifyCrm(tenantId, { type: 'appointment.cancelled', patientId: appt.patientId, appointmentId: id }));
  after(() => recordPatientEvent(tenantId, appt.patientId, 'appointment.deleted', 'Agendamento excluído da agenda', { refType: 'appointment', refId: id }));

  revalidatePath('/agenda');
  revalidatePath('/dashboard');
  return { success: true as const };
}

// ─── Get single appointment ───────────────────────────────────────────────────

export async function getAppointment(id: string) {
  const { tenantId } = await requireTenant();
  const db = getTenantClient(tenantId);

  return db.appointment.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, name: true, controlNumber: true } },
      professional: { select: { id: true, name: true } },
      procedure: { select: { id: true, name: true, durationMinutes: true, basePrice: true } },
    },
  });
}

// ─── O dia do atendimento: chegou, em atendimento, atendido ──────────────────

/**
 * Avança o paciente no dia (ver `lib/appointment-flow.ts`). Chegada e início são
 * horas gravadas no agendamento; a situação só muda quando confirma, termina,
 * falta, cancela ou volta para agendado — e aí o CRM é avisado, como sempre.
 */
export async function advanceAppointment(
  id: string,
  action: FlowAction,
  cancelReason?: string,
): Promise<{ ok: true; openCents?: number } | { ok: false; message: string }> {
  const { tenantId, userId } = await requireTenant();
  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return { ok: false, message: bloqueio };
  const fin = await agendaFinance(tenantId);
  if (fin && action === 'start') {
    const travado = await fin.startBlock(id);
    if (travado) return { ok: false, message: travado };
  }

  const appt = await prisma.appointment.findFirst({
    where: { id, tenantId },
    select: { id: true, patientId: true, status: true, arrivedAt: true, startedAt: true },
  });
  if (!appt) return { ok: false, message: 'Agendamento não encontrado.' };

  const mudanca = applyAction(appt, action, new Date());
  if (!mudanca) return { ok: false, message: 'Essa ação não cabe agora. Atualize a agenda.' };
  const antesPasso = await appointmentSnapshot(tenantId, id);

  await prisma.appointment.update({
    where: { id, tenantId },
    data: {
      ...mudanca,
      ...(mudanca.status === 'CANCELLED' ? { cancelReason: cancelReason?.trim() || null } : {}),
      ...(mudanca.status && mudanca.status !== 'CANCELLED' ? { cancelReason: null, cancelReasonId: null, cancelledBy: null } : {}),
      ...(mudanca.status === 'CONFIRMED' ? { confirmationSource: 'RECEPTION' } : {}),
      ...(mudanca.status === 'SCHEDULED' ? { confirmationSource: null } : {}),
      updatedById: userId,
    },
  });
  if (mudanca.status && mudanca.status !== appt.status) {
    const status = mudanca.status;
    after(() => notifyCrm(tenantId, { type: appointmentStatusEvent(status), patientId: appt.patientId, appointmentId: id }));
    after(() => timelineAppointment(tenantId, id, 'status', userId));
  }
  await auditAppointment(tenantId, userId, id, 'APPOINTMENT_STATUS', antesPasso);
  // Terminou: fatura sozinho (se a clínica ligou) e devolve o que falta receber, para a tela sugerir "Receber agora".
  const openCents = fin && mudanca.status === 'ATTENDED' ? await fin.attended(id) : undefined;
  revalidatePath('/agenda');
  revalidatePath('/dashboard');
  return { ok: true, openCents };
}

/** Põe ou tira o rótulo de um horário. */
export async function setAppointmentLabel(id: string, labelId: string | null): Promise<{ ok: true } | { ok: false; message: string }> {
  const { tenantId, userId } = await requireTenant();
  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return { ok: false, message: bloqueio };
  if (labelId) {
    const existe = await prisma.appointmentLabel.findFirst({ where: { id: labelId, tenantId }, select: { id: true } });
    if (!existe) return { ok: false, message: 'Rótulo não encontrado.' };
  }
  const antesRotulo = await appointmentSnapshot(tenantId, id);
  const r = await prisma.appointment.updateMany({ where: { id, tenantId }, data: { labelId, updatedById: userId } });
  if (!r.count) return { ok: false, message: 'Agendamento não encontrado.' };
  await auditAppointment(tenantId, userId, id, 'APPOINTMENT_LABEL', antesRotulo);
  revalidatePath('/agenda');
  return { ok: true };
}

/**
 * A auditoria do agendamento (aba Auditoria da janela): quem criou e cada
 * alteração, com antes e depois. Com o paciente e a agenda novos ligados.
 */
export async function getAppointmentAuditAction(id: string) {
  const { tenantId } = await requireTenant();
  if (!(await pacienteAgendaEnabled(tenantId))) return null;
  if (await capabilityBlocked(tenantId, 'agenda')) return null;
  const existe = await prisma.appointment.findFirst({ where: { id, tenantId }, select: { id: true } });
  const historico = await loadAppointmentAudit(tenantId, id);
  if (!existe && !historico.length) return null;
  return historico;
}

/**
 * Tudo o que a janela de detalhes mostra, como a do Clínica nas Nuvens: o
 * agendamento, a ficha resumida do paciente, o histórico dele na clínica e,
 * para quem tem o financeiro, quanto está em aberto.
 */
export async function getAppointmentDetail(id: string) {
  const { tenantId } = await requireTenant();
  const db = getTenantClient(tenantId);
  const appointment = await db.appointment.findFirst({
    where: { id },
    include: {
      patient: { select: { id: true, name: true, socialName: true, controlNumber: true, birthDate: true, phoneEncrypted: true, email: true, priority: true, priorityType: true, customFields: true } },
      professional: { select: { id: true, name: true } },
      procedure: { select: { id: true, name: true, durationMinutes: true, basePrice: true } },
      label: { select: { id: true, name: true, color: true } },
    },
  });
  if (!appointment) return null;

  const key = process.env.ENCRYPTION_MASTER_KEY ?? '';
  let phone = '';
  try {
    phone = decrypt(appointment.patient.phoneEncrypted, key, tenantId);
  } catch {
    phone = '';
  }

  const patientId = appointment.patient.id;
  const [historico, ultimo, veFinanceiro, quem] = await Promise.all([
    db.appointment.findMany({
      where: { patientId, id: { not: id } },
      orderBy: { startTime: 'desc' },
      take: 8,
      select: {
        id: true,
        startTime: true,
        status: true,
        arrivedAt: true,
        startedAt: true,
        professional: { select: { name: true } },
        procedure: { select: { name: true } },
      },
    }),
    db.appointment.findFirst({
      where: { patientId, status: 'ATTENDED', id: { not: id } },
      orderBy: { startTime: 'desc' },
      select: { startTime: true, professional: { select: { name: true } } },
    }),
    hasCapability(tenantId, 'financeiro'),
    db.user.findMany({
      where: { id: { in: [appointment.createdById, appointment.updatedById].filter((x): x is string => Boolean(x)) } },
      select: { id: true, name: true },
    }),
  ]);

  let financeiro: { contracted: number; paid: number; balance: number; lastPayment: { amount: number; paidAt: Date } | null } | null = null;
  if (veFinanceiro) {
    const [aceitos, pagos] = await Promise.all([
      db.quote.findMany({ where: { patientId, status: 'ACCEPTED' }, select: { total: true } }),
      db.payment.findMany({ where: { patientId }, orderBy: { paidAt: 'desc' }, select: { amount: true, paidAt: true } }),
    ]);
    const contracted = aceitos.reduce((s, q) => s + Number(q.total), 0);
    const paid = pagos.reduce((s, p) => s + Number(p.amount), 0);
    financeiro = {
      contracted,
      paid,
      balance: Math.max(0, contracted - paid),
      lastPayment: pagos[0] ? { amount: Number(pagos[0].amount), paidAt: pagos[0].paidAt } : null,
    };
  }

  const nomeDe = (uid: string | null) => quem.find((u) => u.id === uid)?.name ?? null;
  const p = appointment.patient;
  // Paciente e agenda novos: nome social, observações marcadas "aparece na agenda" e respostas destacadas.
  const novo = await pacienteAgendaEnabled(tenantId);
  const [notasAgenda, campos] = novo
    ? await Promise.all([
        db.patientNote.findMany({ where: { patientId, showInAgenda: true }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 5, select: { id: true, content: true } }),
        db.patientCustomField.findMany({ where: { active: true, highlight: true }, select: { id: true, label: true, type: true, options: true, required: true, hasNote: true, highlight: true, active: true } }),
      ])
    : [[], []];
  const paciente = { id: p.id, name: novo ? displayName(p) : p.name, controlNumber: p.controlNumber, birthDate: p.birthDate, email: p.email };
  return {
    appointment: {
      ...appointment,
      patient: { id: paciente.id, name: paciente.name, controlNumber: paciente.controlNumber },
      procedure: appointment.procedure ? { ...appointment.procedure, basePrice: Number(appointment.procedure.basePrice) } : null,
    },
    patient: {
      ...paciente,
      phone: formatPhoneBR(phone) ?? '',
      whatsapp: phone ? normalizeBrazilPhone(phone) : '',
    },
    lastVisit: ultimo ? { at: ultimo.startTime, professional: ultimo.professional.name } : null,
    agendaNotes: notasAgenda,
    alerts: novo ? highlightedAnswers(campos, readCustomAnswers(p.customFields)).map((h) => `${h.label}: ${h.text}`) : [],
    priority: novo && p.priority ? priorityLabel(p.priorityType) : null,
    /** Paciente e agenda novos: a aba Auditoria. */
    audit: novo,
    /** Rótulo da situação ("Confirmado pelo paciente", "Cancelado pela clínica"). */
    statusText: statusLabel(appointment.status, { confirmationSource: appointment.confirmationSource, cancelledBy: appointment.cancelledBy }),
    reschedules: novo ? await loadReschedules(tenantId, id) : [],
    professionals: novo ? await db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }) : [],
    history: historico,
    financial: financeiro,
    /** Financeiro completo ligado: a aba Financeiro carrega os itens e as contas deste agendamento. */
    newFinance: Boolean(await agendaFinance(tenantId)),
    createdBy: nomeDe(appointment.createdById),
    updatedBy: nomeDe(appointment.updatedById),
  };
}

// ─── Rótulos da agenda (Configurações) ───────────────────────────────────────

const labelSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Dê um nome ao rótulo.').max(40, 'Nome de até 40 caracteres.'),
  color: z.string().refine(isLabelColor, 'Cor inválida.'),
});

export async function listAppointmentLabels() {
  const { tenantId } = await requireTenant();
  return getTenantClient(tenantId).appointmentLabel.findMany({
    orderBy: [{ active: 'desc' }, { order: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, color: true, active: true, _count: { select: { appointments: true } } },
  });
}

export async function saveAppointmentLabel(input: z.input<typeof labelSchema>): Promise<{ ok: true } | { ok: false; message: string }> {
  const { tenantId } = await requireTenant();
  const bloqueio = (await writeBlocked(tenantId)) ?? (await capabilityBlocked(tenantId, 'configuracoes'));
  if (bloqueio) return { ok: false, message: bloqueio };
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  const { id, name, color } = parsed.data;
  const igual = await prisma.appointmentLabel.findFirst({ where: { tenantId, name: { equals: name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
  if (igual) return { ok: false, message: 'Já existe um rótulo com esse nome.' };
  if (id) {
    const r = await prisma.appointmentLabel.updateMany({ where: { id, tenantId }, data: { name, color, active: true } });
    if (!r.count) return { ok: false, message: 'Rótulo não encontrado.' };
  } else {
    const ultimo = await prisma.appointmentLabel.findFirst({ where: { tenantId }, orderBy: { order: 'desc' }, select: { order: true } });
    await prisma.appointmentLabel.create({ data: { tenantId, name, color, order: (ultimo?.order ?? 0) + 1 } });
  }
  revalidatePath('/agenda');
  revalidatePath('/configuracoes');
  return { ok: true };
}

/** Rótulo em uso só é desligado (os horários antigos guardam a cor); sem uso, some. */
export async function deleteAppointmentLabel(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { tenantId } = await requireTenant();
  const bloqueio = (await writeBlocked(tenantId)) ?? (await capabilityBlocked(tenantId, 'configuracoes'));
  if (bloqueio) return { ok: false, message: bloqueio };
  const usos = await prisma.appointment.count({ where: { tenantId, labelId: id } });
  if (usos) await prisma.appointmentLabel.updateMany({ where: { id, tenantId }, data: { active: false } });
  else await prisma.appointmentLabel.deleteMany({ where: { id, tenantId } });
  revalidatePath('/agenda');
  revalidatePath('/configuracoes');
  return { ok: true };
}


// ─── Situação, cancelamento e remarcação (spec 2026-11-18, F4) ──────────────

type Ok = { ok: true } | { ok: false; message: string };

async function novoLigado(tenantId: string) {
  return pacienteAgendaEnabled(tenantId);
}

/** Grava a remarcação: de onde veio e para onde foi. Pediu pelo WhatsApp (situação "remarcado") fica marcado. */
async function recordReschedule(
  tenantId: string,
  userId: string | null,
  appointmentId: string,
  before: { startTime: Date; endTime: Date; professionalId: string; patientId: string; status: string },
  after: { startTime: Date; endTime: Date; professionalId: string },
  source: 'AGENDA' | 'DRAG' | 'BULK',
  reason?: string,
) {
  if (!(await novoLigado(tenantId))) return;
  await prisma.appointmentReschedule.create({
    data: {
      tenantId,
      appointmentId,
      patientId: before.patientId,
      fromStart: before.startTime,
      fromEnd: before.endTime,
      fromProfessionalId: before.professionalId,
      toStart: after.startTime,
      toEnd: after.endTime,
      toProfessionalId: after.professionalId,
      reason: reason?.trim().slice(0, 200) || null,
      source,
      patientAsked: before.status === 'RESCHEDULED',
      byUserId: userId,
    },
  });
  // Quem pediu para remarcar e ganhou horário novo volta a "a confirmar".
  if (before.status === 'RESCHEDULED') {
    await prisma.appointment.updateMany({ where: { id: appointmentId, tenantId, status: 'RESCHEDULED' }, data: { status: 'SCHEDULED', confirmationSource: null } });
  }
}

async function loadReschedules(tenantId: string, appointmentId: string) {
  const rows = await prisma.appointmentReschedule.findMany({ where: { tenantId, appointmentId }, orderBy: { createdAt: 'desc' }, take: 50 });
  const ids = [...new Set(rows.flatMap((r) => [r.fromProfessionalId, r.toProfessionalId, r.byUserId]).filter((x): x is string => !!x))];
  const [profs, users] = await Promise.all([
    prisma.professional.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } }),
  ]);
  const nome = (id: string | null, l: { id: string; name: string }[]) => l.find((x) => x.id === id)?.name ?? null;
  return rows.map((r) => ({
    id: r.id,
    fromStart: r.fromStart,
    toStart: r.toStart,
    fromProfessional: nome(r.fromProfessionalId, profs),
    toProfessional: nome(r.toProfessionalId, profs),
    reason: r.reason,
    source: r.source,
    patientAsked: r.patientAsked,
    by: nome(r.byUserId, users) ?? 'Sistema',
    at: r.createdAt,
  }));
}

/** Os motivos de cancelamento da clínica (na primeira vez, cria os padrão) e se o motivo é obrigatório. */
export async function cancelOptionsAction(): Promise<{ reasons: { id: string; name: string }[]; required: boolean } | null> {
  const { tenantId } = await requireTenant();
  if (!(await novoLigado(tenantId))) return null;
  let rows = await prisma.cancelReason.findMany({ where: { tenantId, active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true } });
  if (!rows.length && !(await prisma.cancelReason.count({ where: { tenantId } }))) {
    await prisma.cancelReason.createMany({ data: DEFAULT_CANCEL_REASONS.map((name, order) => ({ tenantId, name, order })), skipDuplicates: true });
    rows = await prisma.cancelReason.findMany({ where: { tenantId, active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true } });
  }
  return { reasons: rows, required: (await agendaRules(tenantId)).cancelReasonRequired };
}

/**
 * Cancelar com quem cancelou (paciente ou clínica) e o motivo da lista. O
 * horário fica livre e o agendamento continua no histórico.
 */
export async function cancelAppointmentFull(id: string, input: { cancelledBy: string; reasonId?: string | null; reasonText?: string | null }): Promise<Ok> {
  const { tenantId, userId } = await requireTenant();
  const bloqueio = (await writeBlocked(tenantId)) ?? (await capabilityBlocked(tenantId, 'agenda'));
  if (bloqueio) return { ok: false, message: bloqueio };
  const appt = await prisma.appointment.findFirst({ where: { id, tenantId }, select: { id: true, patientId: true, status: true, arrivedAt: true, startedAt: true } });
  if (!appt) return { ok: false, message: 'Agendamento não encontrado.' };
  if (appt.status === 'CANCELLED') return { ok: false, message: 'Este agendamento já está cancelado.' };
  if (appt.status === 'ATTENDED') return { ok: false, message: 'Atendimento já finalizado não se cancela. Reabra antes, se precisar.' };
  const motivo = input.reasonId ? await prisma.cancelReason.findFirst({ where: { id: input.reasonId, tenantId }, select: { name: true } }) : null;
  if (input.reasonId && !motivo) return { ok: false, message: 'Motivo não encontrado.' };
  const outro = motivo?.name === 'Outro';
  const erro = cancelError(input, { required: (await agendaRules(tenantId)).cancelReasonRequired, otherSelected: outro });
  if (erro) return { ok: false, message: erro };
  const antes = await appointmentSnapshot(tenantId, id);
  await prisma.appointment.update({
    where: { id, tenantId },
    data: {
      status: 'CANCELLED',
      cancelledBy: input.cancelledBy,
      cancelReasonId: input.reasonId || null,
      cancelReason: cancelReasonText(motivo?.name, input.reasonText, outro),
      arrivedAt: null,
      startedAt: null,
      finishedAt: null,
      updatedById: userId,
    },
  });
  await auditAppointment(tenantId, userId, id, 'APPOINTMENT_STATUS', antes);
  after(() => notifyCrm(tenantId, { type: 'appointment.cancelled', patientId: appt.patientId, appointmentId: id }));
  after(() => timelineAppointment(tenantId, id, 'status', userId));
  revalidatePath('/agenda');
  revalidatePath('/dashboard');
  return { ok: true };
}

/** Trocar a situação direto pela lista da janela (cancelar usa `cancelAppointmentFull`). */
export async function setStatusDirectAction(id: string, target: 'SCHEDULED' | 'CONFIRMED' | 'ATTENDED' | 'MISSED'): Promise<Ok & { openCents?: number }> {
  const { tenantId, userId } = await requireTenant();
  const bloqueio = (await writeBlocked(tenantId)) ?? (await capabilityBlocked(tenantId, 'agenda'));
  if (bloqueio) return { ok: false, message: bloqueio };
  if (!['SCHEDULED', 'CONFIRMED', 'ATTENDED', 'MISSED'].includes(target)) return { ok: false, message: 'Situação inválida.' };
  const appt = await prisma.appointment.findFirst({ where: { id, tenantId }, select: { id: true, patientId: true, status: true, arrivedAt: true, startedAt: true, finishedAt: true } });
  if (!appt) return { ok: false, message: 'Agendamento não encontrado.' };
  const mudanca = directStatusChange(appt, target, new Date());
  if (!mudanca) return { ok: true };
  const antes = await appointmentSnapshot(tenantId, id);
  await prisma.appointment.update({
    where: { id, tenantId },
    data: {
      ...mudanca,
      cancelReason: null,
      cancelReasonId: null,
      cancelledBy: null,
      ...(target === 'CONFIRMED' ? { confirmationSource: 'RECEPTION' } : target === 'SCHEDULED' ? { confirmationSource: null } : {}),
      updatedById: userId,
    },
  });
  await auditAppointment(tenantId, userId, id, 'APPOINTMENT_STATUS', antes);
  after(() => notifyCrm(tenantId, { type: appointmentStatusEvent(target), patientId: appt.patientId, appointmentId: id }));
  after(() => timelineAppointment(tenantId, id, 'status', userId));
  const fin = await agendaFinance(tenantId);
  const openCents = fin && target === 'ATTENDED' ? await fin.attended(id) : undefined;
  revalidatePath('/agenda');
  revalidatePath('/dashboard');
  return { ok: true, openCents };
}

/**
 * Remarcar: o mesmo agendamento vai para outro dia, hora ou profissional
 * (itens, cobrança e conversa continuam presos nele) e fica o registro de
 * onde veio, para onde foi, quem remarcou e o motivo.
 */
export async function rescheduleAppointmentAction(
  id: string,
  input: { date: string; startTime: string; endTime: string; professionalId: string; reason?: string },
): Promise<Ok> {
  const { tenantId, userId } = await requireTenant();
  const bloqueio = (await writeBlocked(tenantId)) ?? (await capabilityBlocked(tenantId, 'agenda'));
  if (bloqueio) return { ok: false, message: bloqueio };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.startTime) || !/^\d{2}:\d{2}$/.test(input.endTime)) return { ok: false, message: 'Data ou horário inválido.' };
  const { start, end } = buildDateTimes(input.date, input.startTime, input.endTime);
  if (end <= start) return { ok: false, message: 'O fim precisa ser depois do início.' };
  const foreign = await refOutsideTenant(tenantId, { professionalId: input.professionalId });
  if (foreign) return { ok: false, message: refErrorMessage(foreign) };
  const antes = await prisma.appointment.findFirst({ where: { id, tenantId }, select: { startTime: true, endTime: true, professionalId: true, patientId: true, status: true } });
  if (!antes) return { ok: false, message: 'Agendamento não encontrado.' };
  if (['CANCELLED', 'ATTENDED', 'MISSED'].includes(antes.status)) return { ok: false, message: 'Só dá para remarcar o que ainda vai acontecer.' };
  if (!isReschedule(antes, { startTime: start, endTime: end, professionalId: input.professionalId })) return { ok: false, message: 'Escolha outro dia, horário ou profissional.' };
  const conflict = (await agendaRules(tenantId)).allowOverlap ? null : await checkConflict(tenantId, input.professionalId, start, end, id);
  if (conflict) return { ok: false, message: `Conflito com o agendamento de ${conflict.patient.name} às ${wallClockTime(conflict.startTime)}.` };
  const blocked = await checkBlocked(tenantId, input.professionalId, start, end);
  if (blocked) return { ok: false, message: `Horário bloqueado${blocked.reason ? ` (${blocked.reason})` : ''}.` };
  const foto = await appointmentSnapshot(tenantId, id);
  await prisma.appointment.update({ where: { id, tenantId }, data: { startTime: start, endTime: end, professionalId: input.professionalId, arrivedAt: null, startedAt: null, updatedById: userId } });
  await recordReschedule(tenantId, userId, id, antes, { startTime: start, endTime: end, professionalId: input.professionalId }, 'AGENDA', input.reason);
  await auditAppointment(tenantId, userId, id, 'APPOINTMENT_MOVED', foto, { note: input.reason?.trim() || undefined });
  after(() => notifyCrm(tenantId, { type: 'appointment.rescheduled', patientId: antes.patientId, appointmentId: id }));
  after(() => timelineAppointment(tenantId, id, 'rescheduled', userId, { from: antes.startTime }));
  revalidatePath('/agenda');
  return { ok: true };
}
