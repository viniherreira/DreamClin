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
