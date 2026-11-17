import 'server-only';

import { toCents } from '@/lib/financeiro/money';
import type { Day } from '@/lib/financeiro/dates';
import { addDays } from '@/lib/financeiro/dates';
import { financeSince } from './agenda-bridge';
import { refreshBillingTx } from './billing-sync';
import type { FinContext } from './guard';

/**
 * A tela "A faturar": agendamentos com valor que ainda não viraram conta nem
 * foram recebidos. Só os do financeiro novo (desde que a clínica o ligou);
 * os de antes ficaram no financeiro antigo.
 */

export interface ToBillFilters {
  from: Day;
  to: Day;
  professionalId?: string;
  patient?: string;
  unitId?: string;
  type?: 'PARTICULAR' | 'CONVENIO';
  /** Mostrar também os marcados como "não cobrar". */
  withNoCharge?: boolean;
}

export interface ToBillRow {
  id: string;
  startTime: string;
  patientId: string;
  patientName: string;
  professionalName: string;
  unitName: string | null;
  type: 'PARTICULAR' | 'CONVENIO' | 'CORTESIA';
  status: string;
  procedures: string;
  patientCents: number;
  insuranceCents: number;
  billingStatus: 'TO_RECEIVE' | 'NO_CHARGE';
  noChargeReason: string | null;
  insurerName: string | null;
}

/** Cada agendamento de dia cheio: hora de parede em UTC, o dia vai de 00:00 a 23:59 UTC. */
const inicioDoDia = (d: Day) => new Date(`${d}T00:00:00.000Z`);

export async function listToBill(ctx: FinContext, f: ToBillFilters): Promise<{ rows: ToBillRow[]; truncated: boolean }> {
  const { db, tenantId } = ctx;
  const desde = await financeSince(ctx);
  const inicio = inicioDoDia(f.from);
  const inicioReal = desde && desde > inicio ? desde : inicio;
  const fim = inicioDoDia(addDays(f.to, 1));
  if (inicioReal >= fim) return { rows: [], truncated: false };

  const base = {
    startTime: { gte: inicioReal, lt: fim },
    status: { notIn: ['CANCELLED' as const, 'MISSED' as const] },
    ...(f.professionalId ? { professionalId: f.professionalId } : {}),
    ...(f.unitId ? { unitId: f.unitId } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.patient?.trim() ? { patient: { name: { contains: f.patient.trim(), mode: 'insensitive' as const } } } : {}),
  };

  // Agendamentos do período ainda sem situação gravada (criados pelo site, pelo CRM ou antes dos itens): calcula agora.
  const semSituacao = await db.appointment.findMany({ where: { ...base, billingStatus: null }, select: { id: true }, take: 300 });
  for (const a of semSituacao) await refreshBillingTx(db, tenantId, a.id);

  const LIMITE = 500;
  const lista = await db.appointment.findMany({
    where: { ...base, billingStatus: { in: f.withNoCharge ? ['TO_RECEIVE', 'NO_CHARGE'] : ['TO_RECEIVE'] } },
    orderBy: { startTime: 'asc' },
    take: LIMITE + 1,
    select: {
      id: true,
      startTime: true,
      type: true,
      status: true,
      billingStatus: true,
      noChargeReason: true,
      unitId: true,
      insuranceContactId: true,
      patient: { select: { id: true, name: true } },
      professional: { select: { name: true } },
      items: { orderBy: { order: 'asc' }, select: { name: true, total: true, quoteItemId: true } },
    },
  });
  const [unidades, convenios] = await Promise.all([
    db.clinicUnit.findMany({ select: { id: true, name: true, active: true } }),
    db.finContact.findMany({ where: { id: { in: [...new Set(lista.map((a) => a.insuranceContactId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } }),
  ]);
  const multi = unidades.filter((u) => u.active).length > 1;
  const unidade = new Map(unidades.map((u) => [u.id, u.name]));
  const convenio = new Map(convenios.map((c) => [c.id, c.name]));

  const rows: ToBillRow[] = lista.slice(0, LIMITE).map((a) => {
    const valor = a.type === 'CORTESIA' ? 0 : a.items.reduce((s, i) => s + (i.quoteItemId ? 0 : toCents(i.total)), 0);
    return {
      id: a.id,
      startTime: a.startTime.toISOString(),
      patientId: a.patient.id,
      patientName: a.patient.name,
      professionalName: a.professional.name,
      unitName: multi && a.unitId ? (unidade.get(a.unitId) ?? null) : null,
      type: a.type,
      status: a.status,
      procedures: a.items.map((i) => i.name).join(', '),
      patientCents: a.type === 'CONVENIO' ? 0 : valor,
      insuranceCents: a.type === 'CONVENIO' ? valor : 0,
      billingStatus: a.billingStatus === 'NO_CHARGE' ? 'NO_CHARGE' : 'TO_RECEIVE',
      noChargeReason: a.noChargeReason,
      insurerName: a.insuranceContactId ? (convenio.get(a.insuranceContactId) ?? null) : null,
    };
  });
  return { rows, truncated: lista.length > LIMITE };
}
