'use server';

import { revalidatePath } from 'next/cache';
import { getTenantClient, prisma } from '@clinicaiq/db';
import { capabilityBlocked, writeBlocked } from '@/lib/access';
import { currentAccess } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { describeRule, ruleConflicts, ruleError, type RepeatKind, type RuleLike } from '@/lib/schedule-rules';

/**
 * Configurações › Agenda › Escalas (spec 2026-11-18, F7). Quem configura a
 * agenda (`agenda_config`): dono, administrador e recepção.
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

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);

export async function listSchedules() {
  const g = await guard(false);
  if (!g.ok) return null;
  const db = getTenantClient(g.tenantId);
  const hoje = new Date(Date.now() - 86_400_000);
  const [profs, regras, excecoes, unidades, tipos] = await Promise.all([
    db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.scheduleRule.findMany({ where: { active: true }, orderBy: [{ startsOn: 'asc' }] }),
    db.scheduleException.findMany({ where: { date: { gte: hoje } }, orderBy: { date: 'asc' }, take: 300 }),
    db.clinicUnit.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.careType.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
  ]);
  return {
    professionals: profs,
    units: unidades,
    careTypes: tipos,
    rules: regras.map((r) => {
      const like = { ...r, startsOn: iso(r.startsOn)!, endsOn: iso(r.endsOn) };
      return {
        id: r.id,
        professionalId: r.professionalId,
        unitId: r.unitId,
        careTypeId: r.careTypeId,
        startsOn: like.startsOn,
        endsOn: like.endsOn,
        repeat: r.repeat,
        weekdays: r.weekdays,
        everyDays: r.everyDays,
        monthDay: r.monthDay,
        start1: r.start1,
        end1: r.end1,
        start2: r.start2,
        end2: r.end2,
        text: describeRule(like),
      };
    }),
    exceptions: excecoes.map((e) => ({ id: e.id, professionalId: e.professionalId, date: iso(e.date)!, kind: e.kind, start: e.start, end: e.end, reason: e.reason })),
  };
}

export interface ScheduleRuleInput {
  id?: string;
  professionalId: string;
  unitId?: string | null;
  careTypeId?: string | null;
  startsOn: string;
  endsOn?: string | null;
  repeat: RepeatKind;
  weekdays: number[];
  everyDays?: number | null;
  monthDay?: number | null;
  start1: string;
  end1: string;
  start2?: string | null;
  end2?: string | null;
}

/**
 * Salva a regra. Se ela se chocar com outra do mesmo profissional, não grava e
 * devolve os choques; a tela pergunta "manter as duas" (`keep`) ou "substituir"
 * (`replace`: a antiga termina na véspera do início da nova).
 */
export async function saveScheduleRule(
  input: ScheduleRuleInput,
  onConflict?: 'keep' | 'replace',
): Promise<Result | { ok: false; conflicts: { id: string; text: string }[]; message: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const db = getTenantClient(g.tenantId);
  const r: RuleLike = {
    startsOn: input.startsOn,
    endsOn: input.endsOn || null,
    repeat: input.repeat,
    weekdays: [...new Set((input.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
    everyDays: input.repeat === 'EVERY_N_DAYS' ? Number(input.everyDays) || null : null,
    monthDay: input.repeat === 'MONTH_DAY' ? Number(input.monthDay) || null : null,
    start1: input.start1,
    end1: input.end1,
    start2: input.start2 || null,
    end2: input.end2 || null,
    careTypeId: input.careTypeId || null,
    unitId: input.unitId || null,
  };
  if (input.repeat !== 'WEEKLY' && input.repeat !== 'BIWEEKLY') r.weekdays = [];
  const erro = ruleError(r);
  if (erro) return { ok: false, message: erro };
  if (!(await db.professional.count({ where: { id: input.professionalId } }))) return { ok: false, message: 'Profissional não encontrado.' };
  if (r.unitId && !(await db.clinicUnit.count({ where: { id: r.unitId } }))) return { ok: false, message: 'Unidade não encontrada.' };
  if (r.careTypeId && !(await db.careType.count({ where: { id: r.careTypeId } }))) return { ok: false, message: 'Tipo de atendimento não encontrado.' };

  const outras = (await db.scheduleRule.findMany({ where: { professionalId: input.professionalId, active: true, ...(input.id ? { NOT: { id: input.id } } : {}) } })).map((x) => ({
    ...x,
    startsOn: iso(x.startsOn)!,
    endsOn: iso(x.endsOn),
  }));
  const choques = ruleConflicts(r, outras);
  if (choques.length && !onConflict) {
    return { ok: false, message: 'Essa escala se choca com outra deste profissional.', conflicts: choques.map((c) => ({ id: c.id, text: describeRule(c) })) };
  }

  const dados = {
    professionalId: input.professionalId,
    unitId: r.unitId ?? null,
    careTypeId: r.careTypeId ?? null,
    startsOn: dia(r.startsOn),
    endsOn: r.endsOn ? dia(r.endsOn) : null,
    repeat: r.repeat,
    weekdays: r.weekdays,
    everyDays: r.everyDays ?? null,
    monthDay: r.monthDay ?? null,
    start1: r.start1,
    end1: r.end1,
    start2: r.start2 ?? null,
    end2: r.end2 ?? null,
  };
  const vespera = new Date(dia(r.startsOn).getTime() - 86_400_000);
  try {
    await prisma.$transaction(async (tx) => {
    if (choques.length && onConflict === 'replace') {
      for (const c of choques) {
        // Começou no mesmo dia ou depois: some (nunca valeu de fato). Senão, termina na véspera.
        if (c.startsOn >= r.startsOn) await tx.scheduleRule.updateMany({ where: { id: c.id, tenantId: g.tenantId }, data: { active: false } });
        else await tx.scheduleRule.updateMany({ where: { id: c.id, tenantId: g.tenantId }, data: { endsOn: vespera } });
      }
    }
    if (input.id) {
      const u = await tx.scheduleRule.updateMany({ where: { id: input.id, tenantId: g.tenantId }, data: dados });
      if (!u.count) throw new Error('nao-encontrada');
    } else {
      await tx.scheduleRule.create({ data: { ...dados, tenantId: g.tenantId, createdById: g.userId } });
    }
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'nao-encontrada') return { ok: false, message: 'Escala não encontrada.' };
    throw e;
  }
  await prisma.auditLog.create({ data: { tenantId: g.tenantId, userId: g.userId, action: input.id ? 'SCHEDULE_RULE_UPDATED' : 'SCHEDULE_RULE_CREATED', entity: 'ScheduleRule', entityId: input.id ?? input.professionalId, metadata: { regra: describeRule(r), choques: choques.length, escolha: onConflict ?? null } } });
  revalidatePath('/configuracoes');
  revalidatePath('/agenda');
  return { ok: true };
}

/** Tira a regra (guarda o histórico: só desliga). */
export async function archiveScheduleRule(id: string): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await getTenantClient(g.tenantId).scheduleRule.updateMany({ where: { id }, data: { active: false } });
  if (!r.count) return { ok: false, message: 'Escala não encontrada.' };
  await prisma.auditLog.create({ data: { tenantId: g.tenantId, userId: g.userId, action: 'SCHEDULE_RULE_REMOVED', entity: 'ScheduleRule', entityId: id } });
  revalidatePath('/configuracoes');
  revalidatePath('/agenda');
  return { ok: true };
}

/** Folga (o dia todo) ou plantão (com horário) num dia. */
export async function saveScheduleException(input: { professionalId: string; date: string; kind: 'OFF' | 'EXTRA'; start?: string | null; end?: string | null; reason?: string }): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const db = getTenantClient(g.tenantId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '')) return { ok: false, message: 'Escolha o dia.' };
  if (input.kind !== 'OFF' && input.kind !== 'EXTRA') return { ok: false, message: 'Escolha folga ou plantão.' };
  const h = (x?: string | null) => !!x && /^\d{2}:\d{2}$/.test(x);
  if (input.kind === 'EXTRA' && (!h(input.start) || !h(input.end) || input.end! <= input.start!)) return { ok: false, message: 'O plantão precisa de início e fim, nessa ordem.' };
  if (!(await db.professional.count({ where: { id: input.professionalId } }))) return { ok: false, message: 'Profissional não encontrado.' };
  await db.scheduleException.create({
    data: {
      tenantId: g.tenantId,
      professionalId: input.professionalId,
      date: dia(input.date),
      kind: input.kind,
      start: input.kind === 'EXTRA' ? input.start! : null,
      end: input.kind === 'EXTRA' ? input.end! : null,
      reason: (input.reason ?? '').trim().slice(0, 120) || null,
      createdById: g.userId,
    },
  });
  revalidatePath('/configuracoes');
  revalidatePath('/agenda');
  return { ok: true };
}

export async function removeScheduleException(id: string): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await getTenantClient(g.tenantId).scheduleException.deleteMany({ where: { id } });
  if (!r.count) return { ok: false, message: 'Não encontrada.' };
  revalidatePath('/configuracoes');
  revalidatePath('/agenda');
  return { ok: true };
}
