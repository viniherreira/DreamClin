'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type Prisma } from '@clinicaiq/db';
import { capabilityBlocked, writeBlocked } from '@/lib/access';
import { currentAccess } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { readAgendaRules } from '@/lib/agenda-rules';
import { DEFAULT_CANCEL_REASONS } from '@/lib/appointment-status';

/**
 * Configurações › Agenda (spec 2026-11-18, F4): motivos de cancelamento e a
 * regra "motivo obrigatório". Quem configura a agenda: dono, administrador e
 * recepção (`agenda_config`).
 */

type Result = { ok: true } | { ok: false; message: string };

async function guard(write = true) {
  const acesso = await currentAccess();
  if (!acesso) return { ok: false as const, message: 'Entre de novo.' };
  if (!(await pacienteAgendaEnabled(acesso.tenantId))) return { ok: false as const, message: 'Função ainda não liberada para esta clínica.' };
  const bloqueio = (write ? await writeBlocked(acesso.tenantId) : null) ?? (await capabilityBlocked(acesso.tenantId, 'agenda_config'));
  if (bloqueio) return { ok: false as const, message: bloqueio };
  return { ok: true as const, tenantId: acesso.tenantId, userId: acesso.userId };
}

export async function listCancelReasonsConfig(): Promise<{ reasons: { id: string; name: string; active: boolean; uses: number }[]; required: boolean } | null> {
  const g = await guard(false);
  if (!g.ok) return null;
  if (!(await prisma.cancelReason.count({ where: { tenantId: g.tenantId } }))) {
    await prisma.cancelReason.createMany({ data: DEFAULT_CANCEL_REASONS.map((name, order) => ({ tenantId: g.tenantId, name, order })), skipDuplicates: true });
  }
  const [rows, usos, t] = await Promise.all([
    prisma.cancelReason.findMany({ where: { tenantId: g.tenantId, active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true, active: true } }),
    prisma.appointment.groupBy({ by: ['cancelReasonId'], where: { tenantId: g.tenantId, cancelReasonId: { not: null } }, _count: true }),
    prisma.tenant.findUnique({ where: { id: g.tenantId }, select: { settings: true } }),
  ]);
  const uso = new Map(usos.map((u) => [u.cancelReasonId, u._count]));
  return { reasons: rows.map((r) => ({ ...r, uses: uso.get(r.id) ?? 0 })), required: readAgendaRules(t?.settings).cancelReasonRequired };
}

export async function saveCancelReason(input: { id?: string; name: string }): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const name = (input.name ?? '').trim().slice(0, 60);
  if (!name) return { ok: false, message: 'Escreva o motivo.' };
  const igual = await prisma.cancelReason.findFirst({ where: { tenantId: g.tenantId, name: { equals: name, mode: 'insensitive' }, ...(input.id ? { NOT: { id: input.id } } : {}) } });
  if (igual) {
    if (!igual.active) {
      await prisma.cancelReason.update({ where: { id: igual.id }, data: { active: true } });
      revalidatePath('/configuracoes');
      return { ok: true };
    }
    return { ok: false, message: 'Esse motivo já existe.' };
  }
  if (input.id) {
    const r = await prisma.cancelReason.updateMany({ where: { id: input.id, tenantId: g.tenantId }, data: { name } });
    if (!r.count) return { ok: false, message: 'Motivo não encontrado.' };
  } else {
    const ultimo = await prisma.cancelReason.findFirst({ where: { tenantId: g.tenantId }, orderBy: { order: 'desc' }, select: { order: true } });
    await prisma.cancelReason.create({ data: { tenantId: g.tenantId, name, order: (ultimo?.order ?? 0) + 1 } });
  }
  await prisma.auditLog.create({ data: { tenantId: g.tenantId, userId: g.userId, action: 'SAVE_CANCEL_REASON', entity: 'CancelReason', entityId: input.id ?? name } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

/** Motivo usado em algum cancelamento não é apagado: só sai da lista. */
export async function removeCancelReason(id: string): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const usos = await prisma.appointment.count({ where: { tenantId: g.tenantId, cancelReasonId: id } });
  if (usos) await prisma.cancelReason.updateMany({ where: { id, tenantId: g.tenantId }, data: { active: false } });
  else await prisma.cancelReason.deleteMany({ where: { id, tenantId: g.tenantId } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

export async function setCancelReasonRequired(required: boolean): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const t = await prisma.tenant.findUnique({ where: { id: g.tenantId }, select: { settings: true } });
  const atual = (t?.settings ?? {}) as Record<string, unknown>;
  const agenda = { ...((atual.agenda as Record<string, unknown>) ?? {}), cancelReasonRequired: required === true };
  await prisma.tenant.update({ where: { id: g.tenantId }, data: { settings: JSON.parse(JSON.stringify({ ...atual, agenda })) as Prisma.InputJsonValue } });
  await prisma.auditLog.create({ data: { tenantId: g.tenantId, userId: g.userId, action: 'UPDATE_AGENDA_RULES', entity: 'Tenant', entityId: g.tenantId, metadata: { cancelReasonRequired: required } } });
  revalidatePath('/configuracoes');
  revalidatePath('/agenda');
  return { ok: true };
}

// ─── Tipos de atendimento, salas e equipamentos, feriados ───────────────────

export interface CareTypeInput {
  id?: string;
  name: string;
  color: string;
  durationMinutes: number;
  allowOverlap: boolean;
  chargeable: boolean;
}

export async function listAgendaConfig() {
  const g = await guard(false);
  if (!g.ok) return null;
  const hoje = new Date();
  const [careTypes, resources, holidays, t] = await Promise.all([
    prisma.careType.findMany({ where: { tenantId: g.tenantId, active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    prisma.agendaResource.findMany({ where: { tenantId: g.tenantId, active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    prisma.holiday.findMany({ where: { tenantId: g.tenantId, date: { gte: new Date(Date.UTC(hoje.getUTCFullYear() - 1, 0, 1)) } }, orderBy: { date: 'asc' } }),
    prisma.tenant.findUnique({ where: { id: g.tenantId }, select: { settings: true } }),
  ]);
  return {
    careTypes: careTypes.map((c) => ({ id: c.id, name: c.name, color: c.color, durationMinutes: c.durationMinutes, allowOverlap: c.allowOverlap, chargeable: c.chargeable })),
    resources: resources.map((r) => ({ id: r.id, name: r.name, color: r.color, allowOverlap: r.allowOverlap })),
    holidays: holidays.map((h) => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name })),
    blockHolidays: readAgendaRules(t?.settings).blockHolidays,
  };
}

export async function saveCareType(input: CareTypeInput): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const name = (input.name ?? '').trim().slice(0, 60);
  if (!name) return { ok: false, message: 'Dê um nome ao tipo.' };
  const data = {
    name,
    color: /^[a-z]{3,10}$/.test(input.color) ? input.color : 'blue',
    durationMinutes: Math.max(5, Math.min(480, Math.round(Number(input.durationMinutes) || 30))),
    allowOverlap: !!input.allowOverlap,
    chargeable: input.chargeable !== false,
  };
  const igual = await prisma.careType.findFirst({ where: { tenantId: g.tenantId, name: { equals: name, mode: 'insensitive' }, ...(input.id ? { NOT: { id: input.id } } : {}) } });
  if (igual) return { ok: false, message: 'Já existe um tipo com esse nome.' };
  if (input.id) {
    const r = await prisma.careType.updateMany({ where: { id: input.id, tenantId: g.tenantId }, data });
    if (!r.count) return { ok: false, message: 'Tipo não encontrado.' };
  } else {
    const ultimo = await prisma.careType.findFirst({ where: { tenantId: g.tenantId }, orderBy: { order: 'desc' }, select: { order: true } });
    await prisma.careType.create({ data: { ...data, tenantId: g.tenantId, order: (ultimo?.order ?? 0) + 1 } });
  }
  revalidatePath('/configuracoes');
  revalidatePath('/agenda');
  return { ok: true };
}

/** Tipo e sala nunca são apagados: saem da lista (os agendamentos antigos continuam com eles). */
export async function archiveCareType(id: string): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  await prisma.careType.updateMany({ where: { id, tenantId: g.tenantId }, data: { active: false } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

export async function saveResource(input: { id?: string; name: string; color: string; allowOverlap: boolean }): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const name = (input.name ?? '').trim().slice(0, 60);
  if (!name) return { ok: false, message: 'Dê um nome à sala ou ao equipamento.' };
  const data = { name, color: /^[a-z]{3,10}$/.test(input.color) ? input.color : 'teal', allowOverlap: !!input.allowOverlap };
  const igual = await prisma.agendaResource.findFirst({ where: { tenantId: g.tenantId, name: { equals: name, mode: 'insensitive' }, ...(input.id ? { NOT: { id: input.id } } : {}) } });
  if (igual) return { ok: false, message: 'Já existe com esse nome.' };
  if (input.id) {
    const r = await prisma.agendaResource.updateMany({ where: { id: input.id, tenantId: g.tenantId }, data });
    if (!r.count) return { ok: false, message: 'Não encontrado.' };
  } else {
    const ultimo = await prisma.agendaResource.findFirst({ where: { tenantId: g.tenantId }, orderBy: { order: 'desc' }, select: { order: true } });
    await prisma.agendaResource.create({ data: { ...data, tenantId: g.tenantId, order: (ultimo?.order ?? 0) + 1 } });
  }
  revalidatePath('/configuracoes');
  revalidatePath('/agenda');
  return { ok: true };
}

export async function archiveResource(id: string): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  await prisma.agendaResource.updateMany({ where: { id, tenantId: g.tenantId }, data: { active: false } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

export async function saveHoliday(input: { date: string; name: string }): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, message: 'Escolha a data.' };
  const name = (input.name ?? '').trim().slice(0, 80);
  if (!name) return { ok: false, message: 'Dê um nome ao feriado.' };
  const date = new Date(`${input.date}T00:00:00Z`);
  await prisma.holiday.upsert({ where: { tenantId_date: { tenantId: g.tenantId, date } }, update: { name }, create: { tenantId: g.tenantId, date, name } });
  revalidatePath('/configuracoes');
  revalidatePath('/agenda');
  return { ok: true };
}

export async function removeHoliday(id: string): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  await prisma.holiday.deleteMany({ where: { id, tenantId: g.tenantId } });
  revalidatePath('/configuracoes');
  revalidatePath('/agenda');
  return { ok: true };
}

export async function setBlockHolidays(block: boolean): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const t = await prisma.tenant.findUnique({ where: { id: g.tenantId }, select: { settings: true } });
  const atual = (t?.settings ?? {}) as Record<string, unknown>;
  const agenda = { ...((atual.agenda as Record<string, unknown>) ?? {}), blockHolidays: block === true };
  await prisma.tenant.update({ where: { id: g.tenantId }, data: { settings: JSON.parse(JSON.stringify({ ...atual, agenda })) as Prisma.InputJsonValue } });
  revalidatePath('/configuracoes');
  revalidatePath('/agenda');
  return { ok: true };
}
