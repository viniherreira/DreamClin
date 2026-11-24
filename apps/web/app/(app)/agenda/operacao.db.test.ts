import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: () => undefined,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers() }));

let logado: string | null = null;
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: logado }) }));

/**
 * Operação da agenda (spec 2026-11-18, F6): lista de espera sugere quem
 * combina com o horário que vagou; alteração em massa mostra a prévia, para
 * tudo se houver conflito, grava a remarcação e a auditoria, e não mexe nos
 * atendidos; só dono e admin fazem em massa; "meu dia" traz os do profissional.
 */
const envFile = resolve(__dirname, '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';
process.env.PACIENTE_AGENDA = 'todos';

describe.skipIf(!process.env.DATABASE_URL)('operação da agenda (banco)', async () => {
  const { prisma, encrypt } = await import('@clinicaiq/db');
  const op = await import('./operacao-actions');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await prisma.tenant.create({ data: { clerkOrgId: `op_${suffix}`, name: 'OP', slug: `op-${suffix}` } });
  await prisma.subscription.create({ data: { tenantId: tenant.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId: `user_opa_${suffix}`, name: 'Admin', email: `opa-${suffix}@teste.local`, role: 'ADMIN' } });
  const recep = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId: `user_opr_${suffix}`, name: 'Recepção', email: `opr-${suffix}@teste.local`, role: 'RECEPTIONIST' } });
  const prof = await prisma.professional.create({ data: { tenantId: tenant.id, name: 'Dra Ana', userId: admin.id } });
  const prof2 = await prisma.professional.create({ data: { tenantId: tenant.id, name: 'Dr Bruno' } });
  const key = process.env.ENCRYPTION_MASTER_KEY!;
  const pac = (n: number) => prisma.patient.create({ data: { tenantId: tenant.id, controlNumber: n, name: `Paciente ${n}`, phoneEncrypted: encrypt('11987650000', key, tenant.id), lgpdConsentAt: new Date() } });
  const [p1, p2, p3, p4] = [await pac(1), await pac(2), await pac(3), await pac(4)];
  const ag = (patientId: string, professionalId: string, iso: string, status: 'SCHEDULED' | 'ATTENDED' | 'CANCELLED' = 'SCHEDULED') =>
    prisma.appointment.create({ data: { tenantId: tenant.id, patientId, professionalId, status, startTime: new Date(`${iso}:00Z`), endTime: new Date(new Date(`${iso}:00Z`).getTime() + 30 * 60_000) } });

  afterAll(async () => {
    const t = { tenantId: tenant.id };
    await prisma.waitlistEntry.deleteMany({ where: t });
    await prisma.appointmentReschedule.deleteMany({ where: t });
    await prisma.patientEvent.deleteMany({ where: t });
    await prisma.auditLog.deleteMany({ where: t });
    await prisma.appointment.deleteMany({ where: t });
    await prisma.clinicUnit.deleteMany({ where: t });
    await prisma.patient.deleteMany({ where: t });
    await prisma.professional.deleteMany({ where: t });
    await prisma.user.deleteMany({ where: t });
    await prisma.subscription.deleteMany({ where: t });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });

  it('lista de espera: não repete o paciente e sugere só quem combina com o horário', async () => {
    logado = recep.clerkUserId;
    // 2027-04-06 é terça (2). Manhã com a Dra Ana.
    expect(await op.addToWaitlist({ patientId: p1.id, professionalId: prof.id, period: 'MORNING', weekdays: [2] })).toEqual({ ok: true });
    expect(await op.addToWaitlist({ patientId: p1.id })).toMatchObject({ ok: false });
    expect(await op.addToWaitlist({ patientId: p2.id, period: 'AFTERNOON' })).toEqual({ ok: true });
    expect(await op.addToWaitlist({ patientId: p3.id, professionalId: prof2.id })).toEqual({ ok: true });
    const vago = await ag(p4.id, prof.id, '2027-04-06T09:00', 'CANCELLED'); // horário de parede, como a agenda grava
    const s = await op.waitlistForSlot(vago.id);
    expect(s?.suggestions.map((x) => x.patientId)).toEqual([p1.id]);
    const lista = await op.listWaitlist();
    expect(lista?.entries).toHaveLength(3);
    const e = lista!.entries.find((x) => x.patientId === p2.id)!;
    expect(await op.setWaitlistStatus(e.id, 'REMOVED', 'conseguiu em outra clínica')).toEqual({ ok: true });
    expect((await op.listWaitlist())?.entries).toHaveLength(2);
    expect((await op.listWaitlist({ history: true }))?.entries).toHaveLength(3);
  });

  it('em massa: recepção não pode', async () => {
    logado = recep.clerkUserId;
    expect(await op.bulkSearch({ from: '2027-05-03', to: '2027-05-03' })).toEqual([]);
    expect(await op.bulkApply(['x'], { shiftDays: 1 })).toMatchObject({ ok: false });
  });

  it('em massa: prévia, conflito para tudo, aplicar grava remarcação e auditoria e deixa o atendido', async () => {
    logado = admin.clerkUserId;
    const a1 = await ag(p1.id, prof.id, '2027-05-03T12:00');
    const a2 = await ag(p2.id, prof.id, '2027-05-03T13:00');
    const feito = await ag(p3.id, prof.id, '2027-05-03T14:00', 'ATTENDED');
    const ocupado = await ag(p4.id, prof2.id, '2027-05-03T13:00');
    const achados = await op.bulkSearch({ from: '2027-05-03', to: '2027-05-03', professionalId: prof.id });
    expect(achados.map((r) => r.id).sort()).toEqual([a1.id, a2.id].sort());

    const ids = [a1.id, a2.id, feito.id];
    const comConflito = await op.bulkApply(ids, { professionalId: prof2.id }, { dryRun: true });
    expect(comConflito).toMatchObject({ ok: true, changed: 2 });
    expect(comConflito.ok && comConflito.conflicts.map((c) => c.id)).toEqual([a2.id]);
    const barrado = await op.bulkApply(ids, { professionalId: prof2.id });
    expect(barrado).toMatchObject({ ok: true, changed: 0 });
    expect((await prisma.appointment.findUnique({ where: { id: a1.id } }))?.professionalId).toBe(prof.id);

    await prisma.appointment.update({ where: { id: ocupado.id }, data: { status: 'CANCELLED' } });
    const r = await op.bulkApply(ids, { professionalId: prof2.id, shiftDays: 1 });
    expect(r).toEqual({ ok: true, changed: 2, conflicts: [] });
    const depois = await prisma.appointment.findMany({ where: { id: { in: ids } }, orderBy: { startTime: 'asc' } });
    const m1 = depois.find((d) => d.id === a1.id)!;
    expect(m1.professionalId).toBe(prof2.id);
    expect(m1.startTime.toISOString()).toBe('2027-05-04T12:00:00.000Z');
    const f = depois.find((d) => d.id === feito.id)!;
    expect(f.professionalId).toBe(prof.id);
    expect(await prisma.appointmentReschedule.count({ where: { tenantId: tenant.id, source: 'BULK' } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, entity: 'Appointment', entityId: a1.id, action: 'APPOINTMENT_UPDATED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'AGENDA_BULK_CHANGE' } })).toBe(1);
  });

  it('meu dia: o profissional ligado ao usuário vê os pacientes de hoje', async () => {
    logado = admin.clerkUserId;
    const { clinicToday } = await import('@/lib/tz');
    const hoje = clinicToday();
    await ag(p1.id, prof.id, `${hoje}T12:00`);
    await ag(p2.id, prof2.id, `${hoje}T12:00`);
    const d = await op.myDay();
    expect(d?.professional?.id).toBe(prof.id);
    expect(d?.items.map((i) => i.patient.name)).toEqual(['Paciente 1']);
    const outro = await op.myDay(prof2.id);
    expect(outro?.items.map((i) => i.patient.name)).toEqual(['Paciente 2']);
  });
});
