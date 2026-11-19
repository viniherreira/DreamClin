'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma, getTenantClient, encrypt, decrypt, Prisma } from '@clinicaiq/db';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { capabilityBlocked, hasCapability, writeBlocked } from '@/lib/access';
import { activeFilterCount, patientFiltersWhere, type PatientFilters } from '@/lib/patient-filters';
import { clinicToday } from '@/lib/tz';
import { refOutsideTenant } from '@/lib/owns';
import { notifyPatientCreated } from '@/crm/notify';
import { recordPatientEvent } from '@/lib/patient-timeline';
import { ensureDefaultFolders } from '@/lib/patient-docs';
import { cpfHash, cpfTaken, findPatientByCpf } from '@/lib/cpf-hash';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { missingRequired, readPatientSettings, type CustomAnswers } from '@/lib/patient-fields';
import {
  extraData,
  extraRefError,
  loadOrigins,
  extraSchema,
  openExtra,
  parseInsurances,
  readExtraAnswers,
  syncInsurances,
  type ExtraInput,
} from './patient-extra';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMasterKey() {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) throw new Error('ENCRYPTION_MASTER_KEY not set');
  return key;
}

function stripMask(value: string) {
  return value.replace(/\D/g, '');
}

function validateCpf(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  return remainder === parseInt(digits[10]);
}

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

async function nextControlNumber(tenantId: string): Promise<number> {
  const last = await prisma.patient.findFirst({
    where: { tenantId },
    orderBy: { controlNumber: 'desc' },
    select: { controlNumber: true },
  });
  return (last?.controlNumber ?? 0) + 1;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const patientSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres').max(120),
  nickname: z.string().max(60).optional().or(z.literal('')),
  cpf: z
    .string()
    .transform(stripMask)
    .refine((v) => !v || validateCpf(v), { message: 'CPF inválido' })
    .optional()
    .or(z.literal('')),
  phone: z
    .string()
    .transform(stripMask)
    .refine((v) => v.length >= 10 && v.length <= 11, { message: 'Telefone inválido' }),
  phone2: z
    .string()
    .transform(stripMask)
    .refine((v) => !v || (v.length >= 10 && v.length <= 11), { message: 'Telefone inválido' })
    .optional()
    .or(z.literal('')),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  birthDate: z.string().optional().or(z.literal('')),
  gender: z.string().optional().or(z.literal('')),
  maritalStatus: z.string().optional().or(z.literal('')),
  profession: z.string().max(80).optional().or(z.literal('')),
  referredBy: z.string().max(80).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
  zipCode: z.string().max(9).optional().or(z.literal('')),
  street: z.string().max(120).optional().or(z.literal('')),
  addressNumber: z.string().max(20).optional().or(z.literal('')),
  complement: z.string().max(80).optional().or(z.literal('')),
  neighborhood: z.string().max(80).optional().or(z.literal('')),
  city: z.string().max(80).optional().or(z.literal('')),
  state: z.string().max(2).optional().or(z.literal('')),
  lgpdConsent: z.string().optional(),
  marketingConsent: z.string().optional(),
});

// ─── Cadastro completo (bandeira) ───────────────────────────────────────────

/**
 * Com a bandeira ligada, lê e confere os campos novos: referências da mesma
 * clínica, obrigatórios que a clínica escolheu, nascimento (sempre obrigatório
 * no cadastro novo) e as informações adicionais. Devolve os erros no formato do
 * formulário, ou o que gravar.
 */
async function readExtra(
  tenantId: string,
  raw: Record<string, FormDataEntryValue>,
  base: { cpf?: string; email?: string; gender?: string; zipCode?: string; street?: string; addressNumber?: string; birthDate?: string },
  selfId?: string,
): Promise<{ ok: true; extra: ExtraInput; answers: CustomAnswers } | { ok: false; state: PatientFormState }> {
  const parsed = extraSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, state: { success: false, errors: parsed.error.flatten().fieldErrors } };
  const extra = parsed.data;
  const refErr = await extraRefError(tenantId, extra, selfId);
  if (refErr) return { ok: false, state: { success: false, errors: {}, message: refErr } };
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const { required } = readPatientSettings(t?.settings);
  const faltam = missingRequired(
    required,
    {
      cpf: base.cpf,
      foreigner: extra.foreigner === '1',
      foreignDoc: extra.foreignDoc,
      email: base.email,
      sex: base.gender,
      zipCode: base.zipCode,
      street: base.street,
      addressNumber: base.addressNumber,
      originId: extra.originId,
      rg: extra.rg,
      motherName: extra.motherName,
    },
    { cpfLater: extra.cpfLater === '1' },
  );
  const { answers, errors: cfErrors } = await readExtraAnswers(tenantId, extra);
  const errors: Record<string, string[]> = {};
  for (const [k, m] of Object.entries(faltam)) errors[k] = [m];
  for (const [k, m] of Object.entries(cfErrors)) errors[`cf_${k}`] = [m];
  if (!base.birthDate) errors.birthDate = ['Informe a data de nascimento'];
  if (extra.controlNumber && !/^\d{1,9}$/.test(extra.controlNumber)) errors.controlNumber = ['Use só números'];
  if (Object.keys(errors).length) {
    return { ok: false, state: { success: false, errors, message: 'Confira os campos marcados.' } };
  }
  return { ok: true, extra, answers };
}

/** Número de controle escolhido à mão já é de outro paciente? */
async function controlNumberTaken(tenantId: string, n: number, exceptId?: string) {
  return Boolean(await prisma.patient.findFirst({ where: { tenantId, controlNumber: n, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } }));
}

/**
 * "CPF primeiro": antes do formulário, a tela pergunta o CPF. Se a clínica já
 * tem alguém com ele, a tela oferece abrir esse cadastro em vez de duplicar.
 */
export async function checkCpfAction(cpf: string): Promise<{ ok: true; found: { id: string; name: string } | null } | { ok: false; message: string }> {
  const { tenantId } = await requireTenant();
  if (await capabilityBlocked(tenantId, 'pacientes')) return { ok: false, message: 'Sem acesso ao cadastro de pacientes.' };
  const digits = stripMask(typeof cpf === 'string' ? cpf : '');
  if (!validateCpf(digits)) return { ok: false, message: 'CPF inválido. Confira os números.' };
  const p = await findPatientByCpf(tenantId, digits);
  return { ok: true, found: p ? { id: p.id, name: p.socialName || p.name } : null };
}

/** Busca curta de paciente (nome ou nº de controle) para escolher responsável financeiro e indicação. */
export async function pickPatientsAction(query: string): Promise<{ id: string; name: string; controlNumber: number }[]> {
  const { tenantId } = await requireTenant();
  if (await capabilityBlocked(tenantId, 'pacientes')) return [];
  const term = (typeof query === 'string' ? query : '').trim().slice(0, 80);
  if (term.length < 2) return [];
  const words = term.split(/\s+/).slice(0, 5);
  const rows = await getTenantClient(tenantId).patient.findMany({
    where: {
      deletedAt: null,
      OR: [
        { AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: 'insensitive' as const } }, { socialName: { contains: w, mode: 'insensitive' as const } }] })) },
        ...(/^\d+$/.test(term) ? [{ controlNumber: Number(term) }] : []),
      ],
    },
    select: { id: true, name: true, socialName: true, controlNumber: true },
    orderBy: { name: 'asc' },
    take: 8,
  });
  return rows.map((r) => ({ id: r.id, name: r.socialName || r.name, controlNumber: r.controlNumber }));
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type PatientFormState =
  | { success: true; patientId: string }
  | { success: false; errors: Record<string, string[]>; message?: string };

// ─── List ────────────────────────────────────────────────────────────────────

/**
 * Ids whose phone, second phone or CPF contain `digits`.
 *
 * Encrypted columns can only be searched by decrypting them, so this reads the
 * tenant's rows and compares in memory. Two things keep it honest: it runs only
 * when the term looks numeric, and it selects nothing but the ciphertext it has
 * to open — never names or records.
 *
 * This is linear in the clinic's patient count. At a few thousand it is
 * imperceptible; if a tenant ever reaches tens of thousands, the fix is a blind
 * index (a keyed HMAC of the normalised digits, stored beside the ciphertext),
 * which trades partial matching for an indexed lookup.
 */
async function findByEncrypted(
  tenantId: string,
  db: ReturnType<typeof getTenantClient>,
  digits: string,
): Promise<string[]> {
  const rows = await db.patient.findMany({
    where: { deletedAt: null },
    select: { id: true, phoneEncrypted: true, phone2Encrypted: true, cpfEncrypted: true },
  });

  const masterKey = getMasterKey();
  const open = (value: string | null): string => {
    if (!value) return '';
    try {
      return decrypt(value, masterKey, tenantId).replace(/\D/g, '');
    } catch {
      // A row we cannot decrypt must not break the whole search.
      return '';
    }
  };

  return rows
    .filter((r) =>
      [r.phoneEncrypted, r.phone2Encrypted, r.cpfEncrypted].some((v) => open(v).includes(digits)),
    )
    .map((r) => r.id);
}

export async function listPatients({
  search = '',
  page = 1,
  active,
}: {
  search?: string;
  page?: number;
  active?: boolean;
}) {
  const { tenantId } = await requireTenant();
  const db = getTenantClient(tenantId);
  const PAGE_SIZE = 20;

  const term = search.trim();
  const digits = term.replace(/\D/g, '');

  // CPF and phone are encrypted with a random IV, so the same number produces
  // different ciphertext every time — there is nothing for SQL to match on. The
  // only way to search them is to decrypt and compare, which means reading the
  // tenant's rows. Done only when the term actually looks like a number, so the
  // usual search-by-name stays a plain indexed query.
  const encryptedMatches =
    digits.length >= 3 ? await findByEncrypted(tenantId, db, digits) : null;

  const where = {
    deletedAt: null,
    ...(active !== undefined ? { active } : {}),
    ...(term
      ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' as const } },
            { nickname: { contains: term, mode: 'insensitive' as const } },
            { email: { contains: term, mode: 'insensitive' as const } },
            ...(/^\d+$/.test(term) ? [{ controlNumber: Number(term) }] : []),
            ...(encryptedMatches?.length ? [{ id: { in: encryptedMatches } }] : []),
          ],
        }
      : {}),
  };

  const [patients, total, recent] = await Promise.all([
    db.patient.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        controlNumber: true,
        name: true,
        nickname: true,
        phoneEncrypted: true,
        email: true,
        birthDate: true,
        active: true,
        createdAt: true,
      },
    }),
    db.patient.count({ where }),
    db.patient.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, name: true, active: true, createdAt: true },
    }),
  ]);

  const masterKey = getMasterKey();

  const decryptedPatients = patients.map((p) => ({
    ...p,
    phone: p.phoneEncrypted ? decrypt(p.phoneEncrypted, masterKey, tenantId) : '',
  }));

  return {
    patients: decryptedPatients,
    total,
    pages: Math.ceil(total / PAGE_SIZE),
    recent,
  };
}

// ─── Get single ──────────────────────────────────────────────────────────────

export async function getPatient(id: string) {
  const { tenantId } = await requireTenant();
  const db = getTenantClient(tenantId);

  const patient = await db.patient.findUnique({
    where: { id },
    include: {
      origin: { select: { id: true, name: true } },
      insurances: { where: { tenantId }, orderBy: [{ active: 'desc' }, { createdAt: 'asc' }] },
      patientNotes: {
        // O include segue a FK sem filtro de clínica (a extensão só filtra o
        // nível de cima): nota gravada por outra clínica não aparece.
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true } } },
      },
    },
  });

  if (!patient || patient.deletedAt) return null;

  const masterKey = getMasterKey();
  const ligados = [patient.financialResponsibleId, patient.referredById].filter((v): v is string => !!v);
  const nomes = ligados.length
    ? await db.patient.findMany({ where: { id: { in: ligados } }, select: { id: true, name: true, socialName: true, controlNumber: true } })
    : [];
  const nomeDe = (pid: string | null) => {
    const n = nomes.find((x) => x.id === pid);
    return n ? { id: n.id, name: n.socialName || n.name, controlNumber: n.controlNumber } : null;
  };

  return {
    ...patient,
    ...openExtra(patient, tenantId),
    financialResponsible: nomeDe(patient.financialResponsibleId),
    referredByPatient: nomeDe(patient.referredById),
    cpf: patient.cpfEncrypted ? decrypt(patient.cpfEncrypted, masterKey, tenantId) : '',
    phone: patient.phoneEncrypted ? decrypt(patient.phoneEncrypted, masterKey, tenantId) : '',
    phone2: patient.phone2Encrypted ? decrypt(patient.phone2Encrypted, masterKey, tenantId) : '',
  };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createPatient(
  _prev: PatientFormState | null,
  formData: FormData,
): Promise<PatientFormState> {
  const { tenantId, userId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return { success: false, errors: {}, message: bloqueio };

  const raw = Object.fromEntries(formData.entries());
  const parsed = patientSchema.safeParse(raw);

  if (!parsed.success) {
    return { success: false, errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;

  if (!data.lgpdConsent) {
    return { success: false, errors: { lgpdConsent: ['Consentimento LGPD obrigatório'] } };
  }

  // Cadastro completo (bandeira): campos novos, obrigatórios da clínica e informações adicionais.
  const completo = (await pacienteAgendaEnabled(tenantId)) ? await readExtra(tenantId, raw, data) : null;
  if (completo && !completo.ok) return completo.state;
  const extra = completo?.ok ? completo : null;

  const masterKey = getMasterKey();

  if (data.cpf && (await cpfTaken(tenantId, data.cpf))) {
    return { success: false, errors: { cpf: ['CPF já cadastrado nesta clínica'] } };
  }
  const numeroEscolhido = extra?.extra.controlNumber ? Number(extra.extra.controlNumber) : null;
  if (numeroEscolhido && (await controlNumberTaken(tenantId, numeroEscolhido))) {
    return { success: false, errors: { controlNumber: ['Este número já é de outro paciente'] } };
  }

  // Dois cadastros no mesmo instante pegariam o mesmo número de ficha: quem
  // chegou depois tenta de novo com o número seguinte.
  const criar = async (controlNumber: number) =>
    prisma.patient.create({
      data: {
        tenantId,
        controlNumber,
        name: data.name,
        nickname: data.nickname || null,
        cpfEncrypted: data.cpf ? encrypt(data.cpf, masterKey, tenantId) : null,
        cpfHash: data.cpf ? cpfHash(data.cpf, tenantId) : null,
        phoneEncrypted: encrypt(data.phone, masterKey, tenantId),
        phone2Encrypted: data.phone2 ? encrypt(data.phone2, masterKey, tenantId) : null,
        email: data.email || null,
        birthDate: data.birthDate ? new Date(data.birthDate) : null,
        gender: data.gender || null,
        maritalStatus: data.maritalStatus || null,
        profession: data.profession || null,
        referredBy: data.referredBy || null,
        notes: data.notes || null,
        zipCode: data.zipCode || null,
        street: data.street || null,
        addressNumber: data.addressNumber || null,
        complement: data.complement || null,
        neighborhood: data.neighborhood || null,
        city: data.city || null,
        state: data.state || null,
        lgpdConsentAt: new Date(),
        // Só carimba quando a caixa foi marcada. Nulo aqui é a resposta honesta:
        // "não autorizou", e não "ainda não perguntamos".
        marketingConsentAt: data.marketingConsent ? new Date() : null,
        ...(extra ? (extraData(extra.extra, tenantId, extra.answers) as Record<string, never>) : {}),
        createdById: userId,
        updatedById: userId,
      },
    });
  let patient: Awaited<ReturnType<typeof criar>> | null = null;
  for (let tentativa = 0; !patient; tentativa++) {
    try {
      patient = await criar(numeroEscolhido && tentativa === 0 ? numeroEscolhido : await nextControlNumber(tenantId));
    } catch (e) {
      const repetido = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target ?? '').includes('controlNumber');
      if (!repetido || tentativa >= 4) throw e;
    }
  }

  if (extra) await syncInsurances(tenantId, patient.id, userId, parseInsurances(extra.extra.insurances));

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action: 'CREATE',
      entity: 'Patient',
      entityId: patient.id,
    },
  });
  // Já conversava pelo WhatsApp? O lead e a conversa do CRM passam a ser deste paciente.
  after(() => notifyPatientCreated(tenantId, patient.id));
  after(() => recordPatientEvent(tenantId, patient.id, 'patient.created', 'Paciente cadastrado', { actorId: userId }));
  if (extra) after(() => ensureDefaultFolders(tenantId, patient.id).catch(() => 0));

  revalidatePath('/pacientes');
  return { success: true, patientId: patient.id };
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updatePatient(
  id: string,
  _prev: PatientFormState | null,
  formData: FormData,
): Promise<PatientFormState> {
  const { tenantId, userId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return { success: false, errors: {}, message: bloqueio };

  const raw = Object.fromEntries(formData.entries());
  const parsed = patientSchema.safeParse(raw);

  if (!parsed.success) {
    return { success: false, errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const masterKey = getMasterKey();

  const completo = (await pacienteAgendaEnabled(tenantId)) ? await readExtra(tenantId, raw, data, id) : null;
  if (completo && !completo.ok) return completo.state;
  const extra = completo?.ok ? completo : null;

  if (data.cpf && (await cpfTaken(tenantId, data.cpf, id))) {
    return { success: false, errors: { cpf: ['CPF já cadastrado nesta clínica'] } };
  }
  const novoNumero = extra?.extra.controlNumber ? Number(extra.extra.controlNumber) : null;
  if (novoNumero && (await controlNumberTaken(tenantId, novoNumero, id))) {
    return { success: false, errors: { controlNumber: ['Este número já é de outro paciente'] } };
  }

  // Preserva a data do primeiro aceite. Recarimbar a cada edição do cadastro
  // apagaria justamente a prova de quando o paciente autorizou — que é a única
  // coisa que esse campo existe para guardar.
  const aceiteAtual = await prisma.patient.findFirst({
    where: { id, tenantId },
    select: { marketingConsentAt: true },
  });

  await prisma.patient.update({
    where: { id, tenantId },
    data: {
      marketingConsentAt: data.marketingConsent
        ? (aceiteAtual?.marketingConsentAt ?? new Date())
        : null,
      name: data.name,
      nickname: data.nickname || null,
      cpfEncrypted: data.cpf ? encrypt(data.cpf, masterKey, tenantId) : null,
      cpfHash: data.cpf ? cpfHash(data.cpf, tenantId) : null,
      phoneEncrypted: encrypt(data.phone, masterKey, tenantId),
      phone2Encrypted: data.phone2 ? encrypt(data.phone2, masterKey, tenantId) : null,
      email: data.email || null,
      birthDate: data.birthDate ? new Date(data.birthDate) : null,
      gender: data.gender || null,
      maritalStatus: data.maritalStatus || null,
      profession: data.profession || null,
      referredBy: data.referredBy || null,
      notes: data.notes || null,
      zipCode: data.zipCode || null,
      street: data.street || null,
      addressNumber: data.addressNumber || null,
      complement: data.complement || null,
      neighborhood: data.neighborhood || null,
      city: data.city || null,
      state: data.state || null,
      ...(extra ? extraData(extra.extra, tenantId, extra.answers) : {}),
      ...(extra && !Object.keys(extra.answers).length ? { customFields: Prisma.DbNull } : {}),
      ...(novoNumero ? { controlNumber: novoNumero } : {}),
      updatedById: userId,
    },
  });
  if (extra) await syncInsurances(tenantId, id, userId, parseInsurances(extra.extra.insurances));

  await prisma.auditLog.create({
    data: { tenantId, userId, action: 'UPDATE', entity: 'Patient', entityId: id },
  });
  after(() => recordPatientEvent(tenantId, id, 'patient.updated', 'Cadastro alterado', { actorId: userId }));

  revalidatePath('/pacientes');
  revalidatePath(`/pacientes/${id}`);
  return { success: true, patientId: id };
}

// ─── Toggle active ────────────────────────────────────────────────────────────

export async function togglePatientActive(id: string) {
  const { tenantId, userId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return;

  const patient = await prisma.patient.findFirst({ where: { id, tenantId } });
  if (!patient) return;

  await prisma.patient.update({
    where: { id, tenantId },
    data: { active: !patient.active, updatedById: userId },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action: patient.active ? 'DEACTIVATE' : 'ACTIVATE',
      entity: 'Patient',
      entityId: id,
    },
  });
  after(() => recordPatientEvent(tenantId, id, patient.active ? 'patient.deactivated' : 'patient.activated', patient.active ? 'Paciente inativado' : 'Paciente reativado', { actorId: userId }));

  revalidatePath('/pacientes');
  revalidatePath(`/pacientes/${id}`);
}

// ─── Soft delete ──────────────────────────────────────────────────────────────

export async function deletePatient(id: string) {
  const { tenantId, userId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return;

  await prisma.patient.update({
    where: { id, tenantId },
    data: { deletedAt: new Date(), updatedById: userId },
  });

  await prisma.auditLog.create({
    data: { tenantId, userId, action: 'DELETE', entity: 'Patient', entityId: id },
  });

  revalidatePath('/pacientes');
}

// ─── Add note ─────────────────────────────────────────────────────────────────

export async function addPatientNote(patientId: string, content: string) {
  const { tenantId, userId } = await requireTenant();

  const bloqueio = await writeBlocked(tenantId);
  if (bloqueio) return;
  if (await capabilityBlocked(tenantId, 'pacientes')) return;

  const texto = typeof content === 'string' ? content.trim().slice(0, 2000) : '';
  if (!texto) return;

  // A FK só exige que o paciente exista em alguma clínica: sem isto, a nota
  // entrava na ficha de outra clínica, assinada por alguém de fora.
  if (await refOutsideTenant(tenantId, { patientId })) return;

  await prisma.patientNote.create({
    data: { tenantId, patientId, userId, content: texto },
  });

  revalidatePath(`/pacientes/${patientId}`);
}

// ─── Lista completa (bandeira) ───────────────────────────────────────────────

/**
 * A lista com filtros (spec 2026-11-18, F1). A busca rápida acha por nome,
 * nome social, e-mail, número de controle, CPF ou telefone (estes dois abrindo
 * a cifra, como a busca antiga). Os filtros vêm de `lib/patient-filters.ts`.
 */
export async function listPatientsFull(filters: PatientFilters, page = 1) {
  const { tenantId } = await requireTenant();
  const db = getTenantClient(tenantId);
  const PAGE_SIZE = 25;
  const term = filters.q.trim();
  const digits = term.replace(/\D/g, '');
  const encryptedMatches = digits.length >= 3 ? await findByEncrypted(tenantId, db, digits) : null;
  const responsaveis = term.length >= 3 && !/^\d+$/.test(term)
    ? await db.patient.findMany({ where: { deletedAt: null, name: { contains: term, mode: 'insensitive' } }, select: { id: true }, take: 50 })
    : [];

  const busca = term
    ? {
        OR: [
          { name: { contains: term, mode: 'insensitive' as const } },
          { socialName: { contains: term, mode: 'insensitive' as const } },
          { nickname: { contains: term, mode: 'insensitive' as const } },
          { email: { contains: term, mode: 'insensitive' as const } },
          ...(/^\d+$/.test(term) ? [{ controlNumber: Number(term) }] : []),
          ...(encryptedMatches?.length ? [{ id: { in: encryptedMatches } }] : []),
          // Achar pelo responsável financeiro: digitar o nome da mãe acha o filho.
          ...(responsaveis.length ? [{ financialResponsibleId: { in: responsaveis.map((r) => r.id) } }] : []),
        ],
      }
    : {};
  const hoje = new Date(`${clinicToday()}T00:00:00.000Z`);
  const where = { deletedAt: null, AND: [busca, patientFiltersWhere(filters, hoje)] };

  const [rows, total, recent] = await Promise.all([
    db.patient.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (Math.max(1, page) - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        controlNumber: true,
        name: true,
        socialName: true,
        phoneEncrypted: true,
        email: true,
        birthDate: true,
        active: true,
        priority: true,
        priorityType: true,
        photoPath: true,
      },
    }),
    db.patient.count({ where }),
    term || activeFilterCount(filters)
      ? Promise.resolve([])
      : db.patient.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, name: true, socialName: true, active: true, createdAt: true },
        }),
  ]);
  const masterKey = getMasterKey();
  return {
    patients: rows.map(({ phoneEncrypted, ...p }) => {
      let phone = '';
      try {
        phone = phoneEncrypted ? decrypt(phoneEncrypted, masterKey, tenantId) : '';
      } catch {}
      return { ...p, phone };
    }),
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    recent: recent.map((r) => ({ ...r, name: r.socialName || r.name })),
  };
}

/** O que os filtros da lista precisam: profissionais, origens, unidades, convênios já usados. */
export async function patientFilterOptions() {
  const { tenantId } = await requireTenant();
  const db = getTenantClient(tenantId);
  const [professionals, origins, units, insurers, canExport] = await Promise.all([
    db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    loadOrigins(tenantId),
    db.clinicUnit.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    db.patientInsurance.findMany({ where: { active: true }, distinct: ['insurerName'], select: { insurerName: true }, orderBy: { insurerName: 'asc' }, take: 100 }),
    hasCapability(tenantId, 'pacientes_exportar'),
  ]);
  return {
    professionals,
    origins: origins.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name })),
    units: units.length > 1 ? units : [],
    insurers: insurers.map((i) => i.insurerName),
    canExport,
  };
}


/**
 * Busca do Ctrl+K: nome, nome social, nº de controle, CPF ou telefone, e
 * também o responsável financeiro (digitar o nome da mãe acha o filho).
 */
export async function quickSearchPatientsAction(query: string): Promise<{ id: string; name: string; controlNumber: number; via?: string }[]> {
  const { tenantId } = await requireTenant();
  if (await capabilityBlocked(tenantId, 'pacientes')) return [];
  if (!(await pacienteAgendaEnabled(tenantId))) return [];
  const term = (typeof query === 'string' ? query : '').trim().slice(0, 80);
  if (term.length < 2) return [];
  const db = getTenantClient(tenantId);
  const digits = term.replace(/\D/g, '');
  const soNumero = digits.length >= 4 && digits.length === term.replace(/[\s().-]/g, '').length;
  const cifrados = soNumero ? await findByEncrypted(tenantId, db, digits) : [];
  const words = term.split(/\s+/).slice(0, 5);
  const porNome = { AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: 'insensitive' as const } }, { socialName: { contains: w, mode: 'insensitive' as const } }] })) };
  const diretos = await db.patient.findMany({
    where: { deletedAt: null, OR: [porNome, ...(/^\d+$/.test(term) ? [{ controlNumber: Number(term) }] : []), ...(cifrados.length ? [{ id: { in: cifrados } }] : [])] },
    select: { id: true, name: true, socialName: true, controlNumber: true },
    orderBy: { name: 'asc' },
    take: 8,
  });
  const dependentes =
    diretos.length && diretos.length < 8 && !soNumero
      ? await db.patient.findMany({
          where: { deletedAt: null, financialResponsibleId: { in: diretos.map((d) => d.id) } },
          select: { id: true, name: true, socialName: true, controlNumber: true, financialResponsibleId: true },
          take: 8 - diretos.length,
        })
      : [];
  const nomeResp = new Map(diretos.map((d) => [d.id, d.socialName || d.name]));
  const vistos = new Set(diretos.map((d) => d.id));
  return [
    ...diretos.map((d) => ({ id: d.id, name: d.socialName || d.name, controlNumber: d.controlNumber })),
    ...dependentes
      .filter((r) => !vistos.has(r.id))
      .map((r) => ({ id: r.id, name: r.socialName || r.name, controlNumber: r.controlNumber, via: `responsável: ${nomeResp.get(r.financialResponsibleId ?? '') ?? ''}` })),
  ];
}
