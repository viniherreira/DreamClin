import 'server-only';

import { decrypt, encrypt, getTenantClient, prisma, type Prisma } from '@clinicaiq/db';
import { z } from 'zod';
import {
  BLOOD_TYPES,
  CONTACT_KINDS,
  cleanCustomAnswers,
  DEFAULT_ORIGINS,
  EDUCATION_OPTIONS,
  PRIORITY_TYPES,
  readCustomAnswers,
  type CustomAnswers,
  type CustomFieldDef,
} from '@/lib/patient-fields';

/**
 * Os campos do cadastro completo (spec 2026-11-18, F1): ler do formulário,
 * gravar cifrado o que é documento ou telefone, e devolver aberto para a tela.
 * Só é usado com a bandeira `pacienteAgendaEnabled` ligada, para o formulário
 * antigo (que não manda estes campos) nunca apagar o que já foi preenchido.
 */

function masterKey(): string {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) throw new Error('ENCRYPTION_MASTER_KEY not set');
  return key;
}

const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));
const flag = z.string().optional();

export const extraSchema = z.object({
  socialName: opt(120),
  genderIdentity: opt(60),
  rg: opt(30),
  rgIssuer: opt(30),
  foreigner: flag,
  nationality: opt(60),
  foreignDoc: opt(40),
  landline: opt(20),
  landlineExt: opt(10),
  otherContacts: opt(4000),
  cns: opt(20),
  bloodType: opt(3),
  spouseName: opt(120),
  motherName: opt(120),
  fatherName: opt(120),
  legalGuardian: opt(120),
  financialResponsibleId: opt(40),
  financialResponsibleText: opt(120),
  priority: flag,
  priorityType: opt(20),
  education: opt(40),
  hobby: opt(120),
  referredById: opt(40),
  originId: opt(40),
  birthdayMessages: flag,
  customFields: opt(20000),
  insurances: opt(20000),
  controlNumber: opt(9),
  cpfLater: flag,
});

export type ExtraInput = z.infer<typeof extraSchema>;

export interface OtherContact {
  kind: string;
  number: string;
}

export interface InsuranceInput {
  id?: string;
  insurerId?: string | null;
  insurerName: string;
  planName?: string | null;
  cardNumber?: string | null;
  validUntil?: string | null;
  active?: boolean;
}

function parseJson<T>(text: string | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function parseOtherContacts(text: string | undefined): OtherContact[] {
  const raw = parseJson<unknown>(text, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({
      kind: typeof c?.kind === 'string' && (CONTACT_KINDS as readonly string[]).includes(c.kind) ? c.kind : 'Outro',
      number: typeof c?.number === 'string' ? c.number.replace(/[^\d+()\s-]/g, '').trim().slice(0, 20) : '',
    }))
    .filter((c) => c.number.replace(/\D/g, '').length >= 8)
    .slice(0, 10);
}

export function parseInsurances(text: string | undefined): InsuranceInput[] {
  const raw = parseJson<unknown>(text, []);
  if (!Array.isArray(raw)) return [];
  const dia = /^\d{4}-\d{2}-\d{2}$/;
  return raw
    .map((i) => ({
      id: typeof i?.id === 'string' ? i.id.slice(0, 40) : undefined,
      insurerId: typeof i?.insurerId === 'string' && i.insurerId ? i.insurerId.slice(0, 40) : null,
      insurerName: typeof i?.insurerName === 'string' ? i.insurerName.trim().slice(0, 80) : '',
      planName: typeof i?.planName === 'string' ? i.planName.trim().slice(0, 80) || null : null,
      cardNumber: typeof i?.cardNumber === 'string' ? i.cardNumber.trim().slice(0, 40) || null : null,
      validUntil: typeof i?.validUntil === 'string' && dia.test(i.validUntil) ? i.validUntil : null,
      active: i?.active !== false,
    }))
    .filter((i) => i.insurerName)
    .slice(0, 10);
}

/** Os campos ativos de informação adicional da clínica. */
export async function loadCustomFieldDefs(tenantId: string): Promise<CustomFieldDef[]> {
  const rows = await getTenantClient(tenantId).patientCustomField.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
  return rows.map((r) => ({ id: r.id, label: r.label, type: r.type, options: r.options, required: r.required, hasNote: r.hasNote, highlight: r.highlight, active: r.active }));
}

/** As origens da clínica; na primeira vez, cria as padrão. */
export async function loadOrigins(tenantId: string) {
  const db = getTenantClient(tenantId);
  let rows = await db.patientOrigin.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true, active: true } });
  if (rows.length === 0) {
    await prisma.patientOrigin.createMany({
      data: DEFAULT_ORIGINS.map((name, order) => ({ tenantId, name, order })),
      skipDuplicates: true,
    });
    rows = await db.patientOrigin.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true, active: true } });
  }
  return rows;
}

/**
 * Confere as referências a outras linhas (paciente responsável, quem indicou,
 * origem): precisam ser desta clínica. Devolve o campo com problema, ou null.
 */
export async function extraRefError(tenantId: string, x: ExtraInput, selfId?: string): Promise<string | null> {
  const pacientes = [x.financialResponsibleId, x.referredById].filter((v): v is string => !!v);
  if (selfId && pacientes.includes(selfId)) return 'O paciente não pode ser responsável nem indicação de si mesmo.';
  if (pacientes.length) {
    const n = await prisma.patient.count({ where: { tenantId, id: { in: [...new Set(pacientes)] } } });
    if (n !== new Set(pacientes).size) return 'Paciente escolhido não encontrado.';
  }
  if (x.originId && !(await prisma.patientOrigin.count({ where: { tenantId, id: x.originId } }))) return 'Origem não encontrada.';
  return null;
}

/** As colunas novas prontas para gravar, já cifradas. */
export function extraData(x: ExtraInput, tenantId: string, answers: CustomAnswers): Prisma.PatientUncheckedUpdateInput {
  const key = masterKey();
  const enc = (v: string | undefined) => (v ? encrypt(v, key, tenantId) : null);
  const contatos = parseOtherContacts(x.otherContacts).map((c) => ({ kind: c.kind, number: encrypt(c.number, key, tenantId) }));
  const foreigner = x.foreigner === '1';
  const priority = x.priority === '1';
  return {
    socialName: x.socialName || null,
    genderIdentity: x.genderIdentity || null,
    rgEncrypted: enc(x.rg),
    rgIssuer: x.rgIssuer || null,
    foreigner,
    nationality: x.nationality || null,
    foreignDocEncrypted: foreigner ? enc(x.foreignDoc) : null,
    landlineEncrypted: enc(x.landline?.replace(/\D/g, '')),
    landlineExt: x.landlineExt || null,
    otherContacts: contatos.length ? contatos : undefined,
    cnsEncrypted: enc(x.cns?.replace(/\D/g, '')),
    bloodType: x.bloodType && (BLOOD_TYPES as readonly string[]).includes(x.bloodType) ? x.bloodType : null,
    spouseName: x.spouseName || null,
    motherName: x.motherName || null,
    fatherName: x.fatherName || null,
    legalGuardian: x.legalGuardian || null,
    financialResponsibleId: x.financialResponsibleId || null,
    financialResponsibleText: x.financialResponsibleId ? null : x.financialResponsibleText || null,
    priority,
    priorityType: priority && x.priorityType && PRIORITY_TYPES.some((p) => p.value === x.priorityType) ? x.priorityType : null,
    education: x.education && (EDUCATION_OPTIONS as readonly string[]).includes(x.education) ? x.education : null,
    hobby: x.hobby || null,
    referredById: x.referredById || null,
    originId: x.originId || null,
    birthdayMessages: x.birthdayMessages !== '0',
    customFields: Object.keys(answers).length ? (answers as unknown as Prisma.InputJsonValue) : undefined,
  };
}

/** Respostas das informações adicionais: limpas contra os campos da clínica. */
export async function readExtraAnswers(tenantId: string, x: ExtraInput) {
  const defs = await loadCustomFieldDefs(tenantId);
  return cleanCustomAnswers(defs, readCustomAnswers(parseJson<unknown>(x.customFields, {})));
}

/**
 * Grava os convênios do formulário: atualiza os que vieram com id (só os deste
 * paciente), cria os novos e inativa os que saíram da lista. Nada é apagado.
 */
export async function syncInsurances(tenantId: string, patientId: string, userId: string, list: InsuranceInput[]) {
  const db = getTenantClient(tenantId);
  const atuais = await db.patientInsurance.findMany({ where: { patientId }, select: { id: true } });
  const ids = new Set(atuais.map((a) => a.id));
  const vistos = new Set<string>();
  for (const i of list) {
    const data = {
      insurerId: i.insurerId ?? null,
      insurerName: i.insurerName,
      planName: i.planName ?? null,
      cardNumber: i.cardNumber ?? null,
      validUntil: i.validUntil ? new Date(`${i.validUntil}T00:00:00.000Z`) : null,
      active: i.active !== false,
    };
    if (i.id && ids.has(i.id)) {
      vistos.add(i.id);
      await prisma.patientInsurance.update({ where: { id: i.id, tenantId }, data });
    } else {
      await prisma.patientInsurance.create({ data: { ...data, tenantId, patientId, createdById: userId } });
    }
  }
  const sairam = [...ids].filter((id) => !vistos.has(id));
  if (sairam.length) await prisma.patientInsurance.updateMany({ where: { tenantId, patientId, id: { in: sairam } }, data: { active: false } });
}

const abrir = (cifra: string | null | undefined, tenantId: string): string => {
  if (!cifra) return '';
  try {
    return decrypt(cifra, masterKey(), tenantId);
  } catch {
    return '';
  }
};

/** As colunas novas abertas para a tela (documentos e telefones decifrados). */
export function openExtra(
  p: {
    rgEncrypted: string | null;
    foreignDocEncrypted: string | null;
    landlineEncrypted: string | null;
    cnsEncrypted: string | null;
    otherContacts: Prisma.JsonValue | null;
  },
  tenantId: string,
) {
  const contatos = Array.isArray(p.otherContacts)
    ? (p.otherContacts as { kind?: unknown; number?: unknown }[]).map((c) => ({
        kind: typeof c?.kind === 'string' ? c.kind : 'Outro',
        number: typeof c?.number === 'string' ? abrir(c.number, tenantId) : '',
      }))
    : [];
  return {
    rg: abrir(p.rgEncrypted, tenantId),
    foreignDoc: abrir(p.foreignDocEncrypted, tenantId),
    landline: abrir(p.landlineEncrypted, tenantId),
    cns: abrir(p.cnsEncrypted, tenantId),
    otherContacts: contatos.filter((c) => c.number),
  };
}

/** O que o formulário completo precisa: origens, informações adicionais, obrigatórios e convênios cadastrados. */
export async function patientFormContext(tenantId: string) {
  const { financeEnabled } = await import('@/fin/flag');
  const { readPatientSettings } = await import('@/lib/patient-fields');
  const [origins, fields, tenant, fin] = await Promise.all([
    loadOrigins(tenantId),
    loadCustomFieldDefs(tenantId),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
    financeEnabled(tenantId),
  ]);
  const insurers = fin
    ? await getTenantClient(tenantId).finContact.findMany({ where: { kind: 'INSURANCE', active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
    : [];
  return {
    origins: origins.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name })),
    fields,
    required: readPatientSettings(tenant?.settings).required,
    insurers,
  };
}
