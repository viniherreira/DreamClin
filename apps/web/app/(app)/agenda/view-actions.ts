'use server';

import { getTenantClient } from '@clinicaiq/db';
import { currentAccess } from '@/lib/guard';
import { capabilityBlocked } from '@/lib/access';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { displayName } from '@/lib/patient-name';
import { statusLabel } from '@/lib/appointment-status';
import { clinicToday } from '@/lib/tz';

/**
 * Visualizações da agenda (spec 2026-11-18, F5): os dias com agendamento no
 * mini calendário e "achar paciente na agenda". Só leitura.
 */

async function ctx() {
  const a = await currentAccess();
  if (!a) return null;
  if (!(await pacienteAgendaEnabled(a.tenantId))) return null;
  if (await capabilityBlocked(a.tenantId, 'agenda')) return null;
  return a;
}

/** Quantos agendamentos (sem os cancelados) em cada dia do mês "AAAA-MM". */
export async function agendaMonthMarks(month: string): Promise<Record<string, number>> {
  const a = await ctx();
  if (!a || !/^\d{4}-\d{2}$/.test(month)) return {};
  const [y, m] = month.split('-').map(Number);
  const ini = new Date(Date.UTC(y, m - 1, 1));
  const fim = new Date(Date.UTC(y, m, 1));
  const rows = await getTenantClient(a.tenantId).appointment.findMany({
    where: { startTime: { gte: ini, lt: fim }, status: { not: 'CANCELLED' } },
    select: { startTime: true },
    take: 20_000,
  });
  const out: Record<string, number> = {};
  for (const r of rows) {
    const d = r.startTime.toISOString().slice(0, 10);
    out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

/**
 * Os agendamentos de um paciente pelo nome ou número: os próximos primeiro,
 * depois os últimos. Clicar leva ao dia e abre o agendamento.
 */
export async function findPatientInAgenda(query: string) {
  const a = await ctx();
  const q = (query ?? '').trim();
  if (!a || q.length < 2) return [];
  const db = getTenantClient(a.tenantId);
  const numero = /^\d+$/.test(q) ? Number(q) : null;
  const palavras = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const pacientes = await db.patient.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(numero !== null ? [{ controlNumber: numero }] : []),
        { AND: palavras.map((w) => ({ name: { contains: w, mode: 'insensitive' as const } })) },
        { AND: palavras.map((w) => ({ socialName: { contains: w, mode: 'insensitive' as const } })) },
      ],
    },
    select: { id: true },
    take: 20,
  });
  if (!pacientes.length) return [];
  const ids = pacientes.map((p) => p.id);
  const hoje = new Date(`${clinicToday()}T00:00:00.000Z`);
  const sel = { id: true, startTime: true, status: true, confirmationSource: true, cancelledBy: true, professional: { select: { name: true } }, patient: { select: { name: true, socialName: true, controlNumber: true } } } as const;
  const [proximos, ultimos] = await Promise.all([
    db.appointment.findMany({ where: { patientId: { in: ids }, startTime: { gte: hoje } }, orderBy: { startTime: 'asc' }, take: 8, select: sel }),
    db.appointment.findMany({ where: { patientId: { in: ids }, startTime: { lt: hoje } }, orderBy: { startTime: 'desc' }, take: 4, select: sel }),
  ]);
  return [...proximos.map((x) => ({ ...x, future: true })), ...ultimos.map((x) => ({ ...x, future: false }))].map((x) => ({
    id: x.id,
    startTime: x.startTime.toISOString(),
    future: x.future,
    status: statusLabel(x.status, x),
    professional: x.professional.name,
    patient: `${displayName(x.patient)} · nº ${x.patient.controlNumber}`,
  }));
}
