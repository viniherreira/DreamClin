'use server';

import { revalidatePath } from 'next/cache';
import { getTenantClient, prisma, type Prisma } from '@clinicaiq/db';
import { capabilityBlocked, writeBlocked } from '@/lib/access';
import { currentAccess } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import {
  isCustomFieldType,
  parseOptions,
  readPatientSettings,
  OPTIONAL_REQUIRABLE,
  type CustomFieldDef,
  type PatientSettings,
} from '@/lib/patient-fields';
import { loadCustomFieldDefs, loadOrigins } from '../pacientes/patient-extra';

/**
 * Configurações › Pacientes (spec 2026-11-18, F1): campos obrigatórios,
 * exportação pela recepção, origens e informações adicionais.
 */

type Result = { ok: true } | { ok: false; message: string };

async function guard(): Promise<{ ok: true; tenantId: string; userId: string } | { ok: false; message: string }> {
  const acesso = await currentAccess();
  if (!acesso) return { ok: false, message: 'Entre de novo.' };
  if (!(await pacienteAgendaEnabled(acesso.tenantId))) return { ok: false, message: 'Função ainda não liberada para esta clínica.' };
  const bloqueio = (await writeBlocked(acesso.tenantId)) ?? (await capabilityBlocked(acesso.tenantId, 'configuracoes'));
  if (bloqueio) return { ok: false, message: bloqueio };
  return { ok: true, tenantId: acesso.tenantId, userId: acesso.userId };
}

async function audit(tenantId: string, userId: string, action: string, entityId: string) {
  await prisma.auditLog.create({ data: { tenantId, userId, action, entity: 'PatientSettings', entityId } });
}

export interface PatientSettingsData {
  settings: PatientSettings;
  origins: { id: string; name: string; active: boolean }[];
  fields: CustomFieldDef[];
}

export async function getPatientSettings(): Promise<PatientSettingsData | null> {
  const acesso = await currentAccess();
  if (!acesso || !(await pacienteAgendaEnabled(acesso.tenantId))) return null;
  const t = await prisma.tenant.findUnique({ where: { id: acesso.tenantId }, select: { settings: true } });
  const [origins, fields] = await Promise.all([loadOrigins(acesso.tenantId), loadCustomFieldDefs(acesso.tenantId)]);
  return { settings: readPatientSettings(t?.settings), origins, fields };
}

export async function savePatientRules(input: { required: string[]; receptionCanExport: boolean }): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const validas = new Set<string>(OPTIONAL_REQUIRABLE.map((o) => o.key));
  const t = await prisma.tenant.findUnique({ where: { id: g.tenantId }, select: { settings: true } });
  const atual = (t?.settings ?? {}) as Record<string, unknown>;
  const patients = {
    ...((atual.patients as Record<string, unknown>) ?? {}),
    required: [...new Set((input.required ?? []).filter((k) => validas.has(k)))],
    receptionCanExport: input.receptionCanExport === true,
  };
  await prisma.tenant.update({
    where: { id: g.tenantId },
    data: { settings: JSON.parse(JSON.stringify({ ...atual, patients })) as Prisma.InputJsonValue },
  });
  await audit(g.tenantId, g.userId, 'UPDATE_PATIENT_RULES', g.tenantId);
  revalidatePath('/configuracoes');
  return { ok: true };
}

// ─── Origens ────────────────────────────────────────────────────────────────

export async function saveOrigin(input: { id?: string; name: string; active?: boolean }): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const name = (input.name ?? '').trim().slice(0, 60);
  if (!name) return { ok: false, message: 'Dê um nome à origem.' };
  const db = getTenantClient(g.tenantId);
  const igual = await db.patientOrigin.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(input.id ? { NOT: { id: input.id } } : {}) } });
  if (igual) return { ok: false, message: 'Já existe uma origem com esse nome.' };
  if (input.id) {
    const r = await prisma.patientOrigin.updateMany({ where: { id: input.id, tenantId: g.tenantId }, data: { name, active: input.active !== false } });
    if (!r.count) return { ok: false, message: 'Origem não encontrada.' };
  } else {
    const ultima = await db.patientOrigin.findFirst({ orderBy: { order: 'desc' }, select: { order: true } });
    await prisma.patientOrigin.create({ data: { tenantId: g.tenantId, name, order: (ultima?.order ?? 0) + 1 } });
  }
  await audit(g.tenantId, g.userId, 'SAVE_PATIENT_ORIGIN', input.id ?? name);
  revalidatePath('/configuracoes');
  return { ok: true };
}

/** Origem em uso não é apagada: fica inativa (some das listas, continua nos cadastros). */
export async function deleteOrigin(id: string): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const emUso = await prisma.patient.count({ where: { tenantId: g.tenantId, originId: id } });
  if (emUso) {
    await prisma.patientOrigin.updateMany({ where: { id, tenantId: g.tenantId }, data: { active: false } });
  } else {
    await prisma.patientOrigin.deleteMany({ where: { id, tenantId: g.tenantId } });
  }
  await audit(g.tenantId, g.userId, 'DELETE_PATIENT_ORIGIN', id);
  revalidatePath('/configuracoes');
  return { ok: true };
}

// ─── Informações adicionais ─────────────────────────────────────────────────

export interface CustomFieldInput {
  id?: string;
  label: string;
  type: string;
  options: string;
  required: boolean;
  hasNote: boolean;
  highlight: boolean;
  active: boolean;
}

export async function saveCustomField(input: CustomFieldInput): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const label = (input.label ?? '').trim().slice(0, 80);
  if (!label) return { ok: false, message: 'Dê um nome ao campo.' };
  if (!isCustomFieldType(input.type)) return { ok: false, message: 'Tipo de campo inválido.' };
  const options = input.type === 'SINGLE' || input.type === 'MULTI' ? parseOptions(input.options ?? '') : [];
  if ((input.type === 'SINGLE' || input.type === 'MULTI') && options.length < 2) return { ok: false, message: 'Escreva pelo menos duas opções, uma por linha.' };
  const db = getTenantClient(g.tenantId);
  const data = { label, options, required: !!input.required, hasNote: !!input.hasNote, highlight: !!input.highlight, active: input.active !== false };
  if (input.id) {
    const atual = await db.patientCustomField.findFirst({ where: { id: input.id }, select: { type: true } });
    if (!atual) return { ok: false, message: 'Campo não encontrado.' };
    // O tipo não muda depois de criado: as respostas já gravadas deixariam de fazer sentido.
    await prisma.patientCustomField.update({ where: { id: input.id, tenantId: g.tenantId }, data });
  } else {
    const total = await db.patientCustomField.count({ where: { active: true } });
    if (total >= 40) return { ok: false, message: 'Limite de 40 informações adicionais ativas.' };
    const ultima = await db.patientCustomField.findFirst({ orderBy: { order: 'desc' }, select: { order: true } });
    await prisma.patientCustomField.create({ data: { ...data, type: input.type, tenantId: g.tenantId, order: (ultima?.order ?? 0) + 1 } });
  }
  await audit(g.tenantId, g.userId, 'SAVE_PATIENT_FIELD', input.id ?? label);
  revalidatePath('/configuracoes');
  return { ok: true };
}

export async function reorderCustomFields(ids: string[]): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const lista = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string').slice(0, 100);
  await prisma.$transaction(lista.map((id, order) => prisma.patientCustomField.updateMany({ where: { id, tenantId: g.tenantId }, data: { order } })));
  revalidatePath('/configuracoes');
  return { ok: true };
}

/** Campo não é apagado (as respostas ficam nos cadastros): é desligado. */
export async function archiveCustomField(id: string): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  await prisma.patientCustomField.updateMany({ where: { id, tenantId: g.tenantId }, data: { active: false } });
  await audit(g.tenantId, g.userId, 'ARCHIVE_PATIENT_FIELD', id);
  revalidatePath('/configuracoes');
  return { ok: true };
}
