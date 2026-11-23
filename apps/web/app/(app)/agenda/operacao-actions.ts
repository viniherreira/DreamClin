'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { decrypt, getTenantClient, prisma } from '@clinicaiq/db';
import { capabilityBlocked, hasCapability, writeBlocked } from '@/lib/access';
import { currentAccess } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { displayName } from '@/lib/patient-name';
import { statusLabel } from '@/lib/appointment-status';
import { suggestForSlot } from '@/lib/waitlist';
import { bulkPlan, type BulkChange } from '@/lib/bulk-change';
import { freeSlots } from '@/lib/availability';
import { buildWorkingHoursMap } from '@/lib/working-hours';
import { holidaysBetween } from '@/lib/holidays';
import { readAgendaRules } from '@/lib/agenda-rules';
import { clinicToday, wallClockMinutes } from '@/lib/tz';
import { appointmentSnapshot, auditAppointment } from '@/lib/appointment-audit-server';
import { recordPatientEvent } from '@/lib/patient-timeline';
import { deliverPrepared, prepareAppointmentMessage } from '@/lib/whatsapp';

/**
 * Telas de operação da agenda (spec 2026-11-18, F6): confirmações, lista de
 * espera, horários livres, alterações em massa e "meu dia" do profissional.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function ctx(write = false, cap: 'agenda' | 'agenda_massa' = 'agenda') {
  const acesso = await currentAccess();
  if (!acesso) return { ok: false as const, message: 'Entre de novo.' };
  if (!(await pacienteAgendaEnabled(acesso.tenantId))) return { ok: false as const, message: 'Função ainda não liberada para esta clínica.' };
  const bloqueio = (write ? await writeBlocked(acesso.tenantId) : null) ?? (await capabilityBlocked(acesso.tenantId, cap));
  if (bloqueio) return { ok: false as const, message: bloqueio };
  return { ok: true as const, tenantId: acesso.tenantId, userId: acesso.userId, role: acesso.role };
}

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const fimDoDia = (iso: string) => new Date(`${iso}T23:59:59.999Z`);
const okDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function abrir(cifra: string | null | undefined, tenantId: string) {
  if (!cifra) return '';
  try {
    return decrypt(cifra, process.env.ENCRYPTION_MASTER_KEY ?? '', tenantId);
  } catch {
    return '';
  }
}

// ─── Confirmações ───────────────────────────────────────────────────────────

export async function listConfirmations(f: { from: string; to: string; professionalId?: string; status?: string }) {
  const c = await ctx();
  if (!c.ok || !okDate(f.from) || !okDate(f.to)) return [];
  const statusIn = f.status === 'todos' ? ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] : f.status === 'CONFIRMED' ? ['CONFIRMED'] : ['SCHEDULED', 'RESCHEDULED'];
  const db = getTenantClient(c.tenantId);
  const ags = await db.appointment.findMany({
    where: { startTime: { gte: dia(f.from), lte: fimDoDia(f.to) }, status: { in: statusIn as ('SCHEDULED' | 'CONFIRMED' | 'RESCHEDULED')[] }, ...(f.professionalId ? { professionalId: f.professionalId } : {}) },
    orderBy: [{ startTime: 'asc' }],
    take: 500,
    select: {
      id: true,
      startTime: true,
      status: true,
      notes: true,
      confirmationSource: true,
      agendaId: true,
      professional: { select: { id: true, name: true } },
      patient: { select: { id: true, name: true, socialName: true, phoneEncrypted: true } },
      label: { select: { name: true, color: true } },
      messages: { where: { direction: 'OUTBOUND' }, orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, readAt: true, deliveredAt: true, createdAt: true } },
    },
  });
  const respostas = await db.whatsAppMessage.findMany({ where: { appointmentId: { in: ags.map((a) => a.id) }, direction: 'INBOUND' }, select: { appointmentId: true } });
  const respondeu = new Set(respostas.map((r) => r.appointmentId));
  return ags.map((a) => {
    const m = a.messages[0];
    return {
      id: a.id,
      startTime: a.startTime.toISOString(),
      status: a.status,
      statusText: statusLabel(a.status, { confirmationSource: a.confirmationSource }),
      notes: a.notes,
      professional: a.professional,
      patient: { id: a.patient.id, name: displayName(a.patient), phone: abrir(a.patient.phoneEncrypted, c.tenantId) },
      label: a.label,
      whatsapp: !m ? 'nenhum' : respondeu.has(a.id) ? 'respondeu' : m.readAt ? 'lido' : m.deliveredAt || m.status === 'DELIVERED' ? 'entregue' : m.status === 'FAILED' ? 'falhou' : 'enviado',
    };
  });
}

/** Reenvia o lembrete pelo WhatsApp (um ou vários). */
export async function resendReminders(ids: string[]): Promise<Result<{ sent: number; failed: number }>> {
  const c = await ctx(true);
  if (!c.ok) return c;
  const meus = await prisma.appointment.findMany({ where: { tenantId: c.tenantId, id: { in: (ids ?? []).slice(0, 200) }, status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] } }, select: { id: true } });
  let sent = 0;
  let failed = 0;
  for (const a of meus) {
    try {
      const p = await prepareAppointmentMessage(a.id, 'reminder');
      if (p.kind === 'send') {
        const r = await deliverPrepared(p.send);
        if (r.success) sent++;
        else failed++;
      } else if (p.result.success) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }
  revalidatePath('/agenda/confirmacoes');
  return { ok: true, sent, failed };
}

// ─── Lista de espera ────────────────────────────────────────────────────────

export interface WaitlistInput {
  patientId: string;
  professionalId?: string | null;
  careTypeId?: string | null;
  period?: string;
  weekdays?: number[];
  fromDate?: string | null;
  notes?: string;
  priority?: number;
}

export async function listWaitlist(opts: { history?: boolean } = {}) {
  const c = await ctx();
  if (!c.ok) return null;
  const db = getTenantClient(c.tenantId);
  const rows = await db.waitlistEntry.findMany({ where: opts.history ? {} : { status: 'WAITING' }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], take: 500 });
  const pids = [...new Set(rows.map((r) => r.patientId))];
  const [pacientes, profs, tipos] = await Promise.all([
    db.patient.findMany({ where: { id: { in: pids } }, select: { id: true, name: true, socialName: true, birthDate: true, phoneEncrypted: true } }),
    db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.careType.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const pac = new Map(pacientes.map((p) => [p.id, p]));
  return {
    entries: rows.map((r) => {
      const p = pac.get(r.patientId);
      return {
        ...r,
        createdAt: r.createdAt.toISOString(),
        fromDate: r.fromDate?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
        patientName: p ? displayName(p) : '—',
        birthDate: p?.birthDate?.toISOString() ?? null,
        phone: abrir(p?.phoneEncrypted, c.tenantId),
        professionalName: profs.find((x) => x.id === r.professionalId)?.name ?? null,
        careTypeName: tipos.find((x) => x.id === r.careTypeId)?.name ?? null,
      };
    }),
    professionals: profs,
    careTypes: tipos,
  };
}

export async function addToWaitlist(input: WaitlistInput): Promise<Result> {
  const c = await ctx(true);
  if (!c.ok) return c;
  const p = await prisma.patient.findFirst({ where: { id: input.patientId, tenantId: c.tenantId, deletedAt: null }, select: { id: true } });
  if (!p) return { ok: false, message: 'Escolha o paciente.' };
  if (input.professionalId && !(await prisma.professional.count({ where: { id: input.professionalId, tenantId: c.tenantId } }))) return { ok: false, message: 'Profissional não encontrado.' };
  if (input.careTypeId && !(await prisma.careType.count({ where: { id: input.careTypeId, tenantId: c.tenantId } }))) return { ok: false, message: 'Tipo não encontrado.' };
  const ja = await prisma.waitlistEntry.findFirst({ where: { tenantId: c.tenantId, patientId: p.id, status: 'WAITING' } });
  if (ja) return { ok: false, message: 'Este paciente já está na lista de espera.' };
  await prisma.waitlistEntry.create({
    data: {
      tenantId: c.tenantId,
      patientId: p.id,
      professionalId: input.professionalId || null,
      careTypeId: input.careTypeId || null,
      period: ['MORNING', 'AFTERNOON', 'EVENING'].includes(input.period ?? '') ? input.period! : 'ANY',
      weekdays: (input.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      fromDate: input.fromDate && okDate(input.fromDate) ? dia(input.fromDate) : null,
      notes: (input.notes ?? '').trim().slice(0, 500) || null,
      priority: input.priority ? 1 : 0,
      createdById: c.userId,
    },
  });
  after(() => recordPatientEvent(c.tenantId, p.id, 'waitlist.added', 'Entrou na lista de espera', { actorId: c.userId }));
  revalidatePath('/agenda/lista-de-espera');
  return { ok: true };
}

export async function setWaitlistStatus(id: string, status: 'SCHEDULED' | 'ATTENDED' | 'REMOVED' | 'WAITING', reason?: string): Promise<Result> {
  const c = await ctx(true);
  if (!c.ok) return c;
  if (!['SCHEDULED', 'ATTENDED', 'REMOVED', 'WAITING'].includes(status)) return { ok: false, message: 'Situação inválida.' };
  const r = await prisma.waitlistEntry.updateMany({ where: { id, tenantId: c.tenantId }, data: { status, removedReason: status === 'REMOVED' ? (reason ?? '').trim().slice(0, 200) || null : null } });
  if (!r.count) return { ok: false, message: 'Não encontrado.' };
  revalidatePath('/agenda/lista-de-espera');
  return { ok: true };
}

/** Horário que vagou (um agendamento cancelado): quem da lista combina. */
export async function waitlistForSlot(appointmentId: string) {
  const c = await ctx();
  if (!c.ok) return null;
  const a = await prisma.appointment.findFirst({ where: { id: appointmentId, tenantId: c.tenantId }, select: { startTime: true, endTime: true, professionalId: true, careTypeId: true, professional: { select: { name: true } } } });
  if (!a) return null;
  const lista = await listWaitlist();
  if (!lista) return null;
  return {
    slot: { start: a.startTime.toISOString(), end: a.endTime.toISOString(), professional: a.professional.name, professionalId: a.professionalId },
    suggestions: suggestForSlot(
      lista.entries.map((e) => ({ ...e, fromDate: e.fromDate, createdAt: e.createdAt })),
      { start: a.startTime, professionalId: a.professionalId, careTypeId: a.careTypeId },
    ).slice(0, 15),
  };
}

// ─── Horários livres ────────────────────────────────────────────────────────

/**
 * Os próximos horários livres por profissional a partir de uma data,
 * respeitando expediente, almoço, agendamentos, bloqueios e feriados (os
 * nacionais e os da clínica). A duração vem do tipo de atendimento ou dos 30 min.
 */
export async function findFreeSlots(f: { from: string; professionalId?: string; careTypeId?: string; days?: number; perProfessional?: number }) {
  const c = await ctx();
  if (!c.ok || !okDate(f.from)) return [];
  const db = getTenantClient(c.tenantId);
  const [profs, tipo, t, custom] = await Promise.all([
    db.professional.findMany({ where: { active: true, ...(f.professionalId ? { id: f.professionalId } : {}) }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    f.careTypeId ? db.careType.findFirst({ where: { id: f.careTypeId }, select: { durationMinutes: true } }) : null,
    prisma.tenant.findUnique({ where: { id: c.tenantId }, select: { settings: true } }),
    db.holiday.findMany({ select: { date: true, name: true } }),
  ]);
  const regras = readAgendaRules(t?.settings);
  const dur = tipo?.durationMinutes ?? regras.defaultDurationMinutes;
  const dias = Math.max(1, Math.min(60, f.days ?? 21));
  const ate = new Date(dia(f.from).getTime() + dias * 86_400_000).toISOString().slice(0, 10);
  const feriados = new Set(holidaysBetween(f.from, ate, custom.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name }))).map((h) => h.date));
  const horarios = await buildWorkingHoursMap(c.tenantId, profs.map((p) => p.id));
  const [ags, bloqs] = await Promise.all([
    db.appointment.findMany({ where: { professionalId: { in: profs.map((p) => p.id) }, status: { notIn: ['CANCELLED', 'MISSED'] }, startTime: { gte: dia(f.from), lte: fimDoDia(ate) } }, select: { professionalId: true, startTime: true, endTime: true } }),
    db.blockedSlot.findMany({ where: { startTime: { lte: fimDoDia(ate) }, endTime: { gte: dia(f.from) } }, select: { professionalId: true, startTime: true, endTime: true } }),
  ]);
  const hoje = clinicToday();
  const agoraMin = (() => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const [h, m] = p.split(':').map(Number);
    return h * 60 + m;
  })();
  // Até 8 horários por dia, em até 40 no total: dá para ver vários dias de uma vez.
  const limite = Math.max(1, Math.min(60, f.perProfessional ?? 40));
  const porDia = 8;
  return profs.map((p) => {
    const out: { date: string; time: string }[] = [];
    for (let i = 0; i <= dias && out.length < limite; i++) {
      const d = new Date(dia(f.from).getTime() + i * 86_400_000).toISOString().slice(0, 10);
      if (d < hoje || feriados.has(d)) continue;
      const semana = horarios[p.id] ?? [];
      const expediente = semana[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? null;
      const ocupado: [number, number][] = [
        ...ags.filter((a) => a.professionalId === p.id && a.startTime.toISOString().slice(0, 10) === d).map((a) => [wallClockMinutes(a.startTime), wallClockMinutes(a.endTime)] as [number, number]),
        ...bloqs
          .filter((b) => b.professionalId === p.id && b.startTime.toISOString().slice(0, 10) <= d && b.endTime.toISOString().slice(0, 10) >= d)
          .map((b) => [b.startTime.toISOString().slice(0, 10) < d ? 0 : wallClockMinutes(b.startTime), b.endTime.toISOString().slice(0, 10) > d ? 24 * 60 : wallClockMinutes(b.endTime)] as [number, number]),
      ];
      for (const time of freeSlots({ day: expediente, busy: ocupado, durationMin: dur, stepMin: regras.slotMinutes >= 15 ? regras.slotMinutes : 15, notBeforeMin: d === hoje ? agoraMin + 30 : 0 }).slice(0, porDia)) {
        out.push({ date: d, time });
        if (out.length >= limite) break;
      }
    }
    return { professional: p, duration: dur, slots: out };
  });
}

// ─── Alterações em massa ────────────────────────────────────────────────────

export async function bulkSearch(f: { from: string; to: string; professionalId?: string; agendaId?: string; status?: string; labelId?: string }) {
  const c = await ctx(false, 'agenda_massa');
  if (!c.ok || !okDate(f.from) || !okDate(f.to)) return [];
  const rows = await getTenantClient(c.tenantId).appointment.findMany({
    where: {
      startTime: { gte: dia(f.from), lte: fimDoDia(f.to) },
      status: f.status ? (f.status as 'SCHEDULED') : { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] },
      ...(f.professionalId ? { professionalId: f.professionalId } : {}),
      ...(f.agendaId ? { agendaId: f.agendaId } : {}),
      ...(f.labelId ? { labelId: f.labelId } : {}),
    },
    orderBy: { startTime: 'asc' },
    take: 500,
    select: { id: true, startTime: true, endTime: true, status: true, professional: { select: { name: true } }, patient: { select: { name: true, socialName: true } } },
  });
  return rows.map((r) => ({ id: r.id, startTime: r.startTime.toISOString(), endTime: r.endTime.toISOString(), status: r.status, professional: r.professional.name, patient: displayName(r.patient) }));
}

/**
 * Aplica a mudança nos agendamentos escolhidos, numa transação só. Com
 * conflito em algum (o profissional ou a sala já ocupados), nada é gravado e
 * a resposta diz quais. Cada agendamento ganha a sua linha de auditoria.
 */
export async function bulkApply(ids: string[], change: BulkChange, opts: { dryRun?: boolean } = {}): Promise<Result<{ changed: number; conflicts: { id: string; reason: string }[] }>> {
  const c = await ctx(true, 'agenda_massa');
  if (!c.ok) return c;
  if (change.professionalId && !(await prisma.professional.count({ where: { id: change.professionalId, tenantId: c.tenantId } }))) return { ok: false, message: 'Profissional não encontrado.' };
  if (change.agendaId && !(await prisma.agendaResource.count({ where: { id: change.agendaId, tenantId: c.tenantId } }))) return { ok: false, message: 'Sala não encontrada.' };
  if (change.labelId && !(await prisma.appointmentLabel.count({ where: { id: change.labelId, tenantId: c.tenantId } }))) return { ok: false, message: 'Rótulo não encontrado.' };
  const alvo = await prisma.appointment.findMany({
    where: { tenantId: c.tenantId, id: { in: (ids ?? []).slice(0, 500) } },
    select: { id: true, startTime: true, endTime: true, professionalId: true, agendaId: true, status: true, labelId: true, patientId: true },
  });
  const plano = bulkPlan(alvo, change);
  const idsPlano = new Set(plano.map((p) => p.id));
  const conflicts: { id: string; reason: string }[] = [];
  for (const p of plano) {
    if (!p.moved && p.data.agendaId === undefined) continue;
    const a = alvo.find((x) => x.id === p.id)!;
    const start = p.data.startTime ?? a.startTime;
    const end = p.data.endTime ?? a.endTime;
    const prof = p.data.professionalId ?? a.professionalId;
    const outro = await prisma.appointment.findFirst({
      where: { tenantId: c.tenantId, professionalId: prof, id: { notIn: [...idsPlano] }, status: { notIn: ['CANCELLED', 'MISSED'] }, AND: [{ startTime: { lt: end } }, { endTime: { gt: start } }] },
      select: { patient: { select: { name: true } } },
    });
    if (outro) conflicts.push({ id: p.id, reason: `conflito com ${outro.patient.name}` });
  }
  if (opts.dryRun || conflicts.length) return { ok: true, changed: opts.dryRun ? plano.length : 0, conflicts };
  const antes = new Map<string, Awaited<ReturnType<typeof appointmentSnapshot>>>();
  for (const p of plano) antes.set(p.id, await appointmentSnapshot(c.tenantId, p.id));
  await prisma.$transaction(async (tx) => {
    for (const p of plano) {
      const a = alvo.find((x) => x.id === p.id)!;
      await tx.appointment.update({ where: { id: p.id, tenantId: c.tenantId }, data: { ...p.data, updatedById: c.userId } as never });
      if (p.moved) {
        await tx.appointmentReschedule.create({
          data: {
            tenantId: c.tenantId,
            appointmentId: p.id,
            patientId: a.patientId,
            fromStart: a.startTime,
            fromEnd: a.endTime,
            fromProfessionalId: a.professionalId,
            toStart: p.data.startTime ?? a.startTime,
            toEnd: p.data.endTime ?? a.endTime,
            toProfessionalId: p.data.professionalId ?? a.professionalId,
            source: 'BULK',
            byUserId: c.userId,
          },
        });
      }
    }
  });
  for (const p of plano) await auditAppointment(c.tenantId, c.userId, p.id, 'APPOINTMENT_UPDATED', antes.get(p.id) ?? null, { note: 'alteração em massa' });
  await prisma.auditLog.create({ data: { tenantId: c.tenantId, userId: c.userId, action: 'AGENDA_BULK_CHANGE', entity: 'Appointment', entityId: 'lote', metadata: { total: plano.length } } });
  revalidatePath('/agenda');
  return { ok: true, changed: plano.length, conflicts: [] };
}

// ─── Meu dia ────────────────────────────────────────────────────────────────

/** Os pacientes do dia do profissional logado (dono e admin escolhem o profissional). */
export async function myDay(professionalId?: string) {
  const c = await ctx();
  if (!c.ok) return null;
  const db = getTenantClient(c.tenantId);
  const meu = await db.professional.findFirst({ where: { userId: c.userId, active: true }, select: { id: true, name: true } });
  const podeEscolher = c.role === 'OWNER' || c.role === 'ADMIN' || c.role === 'RECEPTIONIST';
  const profs = podeEscolher ? await db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }) : meu ? [meu] : [];
  const alvo = (podeEscolher && professionalId ? profs.find((p) => p.id === professionalId) : null) ?? meu ?? profs[0] ?? null;
  if (!alvo) return { professional: null, professionals: profs, items: [], canRecord: false };
  const hoje = clinicToday();
  const ags = await db.appointment.findMany({
    where: { professionalId: alvo.id, startTime: { gte: dia(hoje), lte: fimDoDia(hoje) }, status: { notIn: ['CANCELLED'] } },
    orderBy: { startTime: 'asc' },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      arrivedAt: true,
      startedAt: true,
      finishedAt: true,
      type: true,
      careTypeId: true,
      agendaId: true,
      patient: { select: { id: true, name: true, socialName: true, birthDate: true } },
      procedure: { select: { name: true } },
      items: { select: { procedure: { select: { name: true } } } },
    },
  });
  const [tipos, salas] = await Promise.all([
    db.careType.findMany({ select: { id: true, name: true } }),
    db.agendaResource.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    professional: alvo,
    professionals: profs,
    canRecord: await hasCapability(c.tenantId, 'prontuario'),
    items: ags.map((a) => ({
      id: a.id,
      startTime: a.startTime.toISOString(),
      status: a.status,
      arrivedAt: a.arrivedAt?.toISOString() ?? null,
      startedAt: a.startedAt?.toISOString() ?? null,
      finishedAt: a.finishedAt?.toISOString() ?? null,
      type: a.type,
      careType: tipos.find((t) => t.id === a.careTypeId)?.name ?? null,
      room: salas.find((s) => s.id === a.agendaId)?.name ?? null,
      patient: { id: a.patient.id, name: displayName(a.patient), birthDate: a.patient.birthDate?.toISOString() ?? null },
      procedures: [...new Set([a.procedure?.name, ...a.items.map((i) => i.procedure?.name)].filter((x): x is string => !!x))],
    })),
  };
}
