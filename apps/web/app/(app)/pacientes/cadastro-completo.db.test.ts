import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: () => undefined,
}));

let logado: string | null = null;
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: logado }) }));

/**
 * Cadastro completo do paciente (spec 2026-11-18, F1), com a bandeira ligada
 * pela conta em cortesia: CPF primeiro, "preencher depois", obrigatórios da
 * clínica, documentos cifrados, convênios e informações adicionais, e o
 * isolamento entre clínicas das tabelas novas.
 */
const envFile = resolve(__dirname, '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('cadastro completo do paciente (banco)', async () => {
  const { prisma } = await import('@clinicaiq/db');
  const { createPatient, updatePatient, checkCpfAction, getPatient, quickSearchPatientsAction, listPatientsFull } = await import('./actions');
  const { readPatientFilters } = await import('@/lib/patient-filters');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const clinica = async (nome: string, cortesia: boolean) => {
    const tenant = await prisma.tenant.create({
      data: { clerkOrgId: `cc_${nome}_${suffix}`, name: `CC ${nome}`, slug: `cc-${nome}-${suffix}`, settings: { patients: { required: ['cpf', 'motherName'] } } },
    });
    await prisma.subscription.create({
      data: { tenantId: tenant.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01'), complimentary: cortesia },
    });
    const clerkUserId = `user_cc_${nome}_${suffix}`;
    await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId, name: `Equipe ${nome}`, email: `cc-${nome}-${suffix}@teste.local`, role: 'OWNER' } });
    return { tenant, clerkUserId };
  };
  const a = await clinica('a', true);
  const b = await clinica('b', true);

  afterAll(async () => {
    for (const c of [a, b]) {
      const t = { tenantId: c.tenant.id };
      await prisma.auditLog.deleteMany({ where: t });
      await prisma.patientInsurance.deleteMany({ where: t });
      await prisma.patient.deleteMany({ where: t });
      await prisma.patientCustomField.deleteMany({ where: t });
      await prisma.patientOrigin.deleteMany({ where: t });
      await prisma.user.deleteMany({ where: t });
      await prisma.subscription.deleteMany({ where: t });
      await prisma.tenant.delete({ where: { id: c.tenant.id } });
    }
  });

  const form = (campos: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ name: 'Paciente', phone: '11987650000', birthDate: '1990-05-10', lgpdConsent: 'on', ...campos })) fd.set(k, v);
    return fd;
  };

  it('obrigatórios da clínica e nascimento barram o cadastro; "preencher depois" libera o CPF', async () => {
    logado = a.clerkUserId;
    const sem = await createPatient(null, form({ name: 'Sem nada', birthDate: '' }));
    expect(sem.success).toBe(false);
    if (sem.success) return;
    expect(Object.keys(sem.errors).sort()).toEqual(['birthDate', 'cpf', 'motherName']);

    const depois = await createPatient(null, form({ name: 'CPF depois', cpfLater: '1', motherName: 'Maria' }));
    expect(depois.success).toBe(true);
  });

  it('grava documentos cifrados, nome social, convênio e informação adicional', async () => {
    logado = a.clerkUserId;
    const campo = await prisma.patientCustomField.create({ data: { tenantId: a.tenant.id, label: 'Usa aparelho', type: 'SINGLE', options: ['Sim', 'Não'], highlight: true } });
    const r = await createPatient(
      null,
      form({
        name: 'José da Silva',
        socialName: 'Maria da Silva',
        cpf: '529.982.247-25',
        rg: '12.345.678-9',
        motherName: 'Ana',
        insurances: JSON.stringify([{ insurerName: 'Uniodonto', cardNumber: '123', validUntil: '2027-01-31' }]),
        customFields: JSON.stringify({ [campo.id]: { v: 'Sim' }, inexistente: { v: 'x' } }),
        otherContacts: JSON.stringify([{ kind: 'Recado', number: '(11) 3333-4444' }]),
      }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    const cru = await prisma.patient.findUniqueOrThrow({ where: { id: r.patientId } });
    expect(cru.rgEncrypted).not.toContain('12.345');
    expect(cru.customFields).toEqual({ [campo.id]: { v: 'Sim' } });

    const p = await getPatient(r.patientId);
    expect(p?.rg).toBe('12.345.678-9');
    expect(p?.socialName).toBe('Maria da Silva');
    expect(p?.insurances).toHaveLength(1);
    expect(p?.otherContacts).toEqual([{ kind: 'Recado', number: '(11) 3333-4444' }]);
  });

  it('CPF primeiro: o repetido aponta o cadastro que já existe, só na mesma clínica', async () => {
    logado = a.clerkUserId;
    const achou = await checkCpfAction('52998224725');
    expect(achou).toMatchObject({ ok: true, found: { name: 'Maria da Silva' } });
    expect(await checkCpfAction('123')).toMatchObject({ ok: false });
    logado = b.clerkUserId;
    expect(await checkCpfAction('52998224725')).toEqual({ ok: true, found: null });
  });

  it('número de controle escolhido à mão não pode repetir', async () => {
    logado = a.clerkUserId;
    const um = await createPatient(null, form({ name: 'Número 500', cpfLater: '1', motherName: 'X', controlNumber: '500' }));
    expect(um.success).toBe(true);
    const dois = await createPatient(null, form({ name: 'Número 500 de novo', cpfLater: '1', motherName: 'X', controlNumber: '500' }));
    expect(dois).toMatchObject({ success: false, errors: { controlNumber: ['Este número já é de outro paciente'] } });
  });

  it('responsável financeiro de outra clínica é recusado; o da mesma acha o dependente na busca', async () => {
    logado = b.clerkUserId;
    const deB = await createPatient(null, form({ name: 'Responsável B', cpfLater: '1', motherName: 'X' }));
    expect(deB.success).toBe(true);
    if (!deB.success) return;

    logado = a.clerkUserId;
    const fora = await createPatient(null, form({ name: 'Filho', cpfLater: '1', motherName: 'X', financialResponsibleId: deB.patientId }));
    expect(fora).toMatchObject({ success: false, message: 'Paciente escolhido não encontrado.' });

    const mae = await createPatient(null, form({ name: 'Joana Responsável', cpfLater: '1', motherName: 'X' }));
    if (!mae.success) throw new Error('mae');
    const filho = await createPatient(null, form({ name: 'Pedrinho', cpfLater: '1', motherName: 'Joana', financialResponsibleId: mae.patientId }));
    expect(filho.success).toBe(true);
    const achados = await quickSearchPatientsAction('Joana Respons');
    expect(achados.map((x) => x.name)).toEqual(expect.arrayContaining(['Joana Responsável', 'Pedrinho']));
  });

  it('editar sem mandar convênio inativa o que saiu (não apaga)', async () => {
    logado = a.clerkUserId;
    const p = await prisma.patient.findFirstOrThrow({ where: { tenantId: a.tenant.id, socialName: 'Maria da Silva' } });
    const r = await updatePatient(p.id, null, form({ name: 'José da Silva', socialName: 'Maria da Silva', cpf: '52998224725', motherName: 'Ana', insurances: '[]' }));
    expect(r.success).toBe(true);
    const conv = await prisma.patientInsurance.findMany({ where: { tenantId: a.tenant.id, patientId: p.id } });
    expect(conv).toHaveLength(1);
    expect(conv[0].active).toBe(false);
  });

  it('a lista com filtros fica na clínica', async () => {
    logado = a.clerkUserId;
    const r = await listPatientsFull(readPatientFilters({ situacao: 'todos' }));
    expect(r.patients.length).toBeGreaterThan(0);
    expect(r.patients.every((p) => p.name !== 'Responsável B')).toBe(true);
    const busca = await listPatientsFull(readPatientFilters({ q: 'Maria da' }));
    expect(busca.patients.map((p) => p.socialName)).toContain('Maria da Silva');
  });
});
