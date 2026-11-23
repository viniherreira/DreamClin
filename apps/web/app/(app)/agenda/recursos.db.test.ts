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
 * Tipos de atendimento, salas, feriados e repetição (spec 2026-11-18, F4):
 * semanal por 10 vezes com 2 conflitos pula os 2; a sala ocupada barra;
 * encaixe passa; feriado bloqueado barra; cancelar "este e os próximos" não
 * mexe nos atendidos.
 */
const envFile = resolve(__dirname, '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';
process.env.PACIENTE_AGENDA = 'todos';

describe.skipIf(!process.env.DATABASE_URL)('tipos, salas, feriados e repetição (banco)', async () => {
  const { prisma, encrypt } = await import('@clinicaiq/db');
  const agenda = await import('./actions');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await prisma.tenant.create({ data: { clerkOrgId: `rc_${suffix}`, name: 'RC', slug: `rc-${suffix}` } });
  await prisma.subscription.create({ data: { tenantId: tenant.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId: `user_rc_${suffix}`, name: 'Recepção', email: `rc-${suffix}@teste.local`, role: 'RECEPTIONIST' } });
  const prof = await prisma.professional.create({ data: { tenantId: tenant.id, name: 'Dra Ana' } });
  const prof2 = await prisma.professional.create({ data: { tenantId: tenant.id, name: 'Dr Bruno' } });
  const key = process.env.ENCRYPTION_MASTER_KEY!;
  const pac = (n: number) => prisma.patient.create({ data: { tenantId: tenant.id, controlNumber: n, name: `Paciente ${n}`, phoneEncrypted: encrypt('11987650000', key, tenant.id), lgpdConsentAt: new Date() } });
  const p1 = await pac(1);
  const p2 = await pac(2);
  const sala = await prisma.agendaResource.create({ data: { tenantId: tenant.id, name: 'Sala Laser' } });
  const encaixe = await prisma.careType.create({ data: { tenantId: tenant.id, name: 'Encaixe', allowOverlap: true, durationMinutes: 15 } });

  const form = (o: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ professionalId: prof.id, startTime: '09:00', endTime: '09:30', type: 'PARTICULAR', status: 'SCHEDULED', ...o })) fd.set(k, v);
    return fd;
  };

  afterAll(async () => {
    const t = { tenantId: tenant.id };
    await prisma.patientEvent.deleteMany({ where: t });
    await prisma.auditLog.deleteMany({ where: t });
    await prisma.appointment.deleteMany({ where: t });
    await prisma.cancelReason.deleteMany({ where: t });
    await prisma.careType.deleteMany({ where: t });
    await prisma.agendaResource.deleteMany({ where: t });
    await prisma.holiday.deleteMany({ where: t });
    await prisma.clinicUnit.deleteMany({ where: t });
    await prisma.patient.deleteMany({ where: t });
    await prisma.professional.deleteMany({ where: t });
    await prisma.user.deleteMany({ where: t });
    await prisma.subscription.deleteMany({ where: t });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });

  it('semanal 10 vezes com 2 conflitos: mostra antes e cria 8', async () => {
    logado = user.clerkUserId;
    // Duas semanas já ocupadas.
    for (const d of ['2027-03-08', '2027-03-22']) {
      await prisma.appointment.create({ data: { tenantId: tenant.id, patientId: p2.id, professionalId: prof.id, startTime: new Date(`${d}T09:00:00Z`), endTime: new Date(`${d}T09:30:00Z`) } });
    }
    const prev = await agenda.previewSeriesAction({ date: '2027-03-01', startTime: '09:00', endTime: '09:30', professionalId: prof.id, repeat: 'weekly', repeatCount: 10 });
    expect(prev).toHaveLength(10);
    expect(prev.filter((p) => p.problem).map((p) => p.date)).toEqual(['2027-03-08', '2027-03-22']);
    const r = await agenda.createAppointment(null, form({ patientId: p1.id, date: '2027-03-01', repeat: 'weekly', repeatCount: '10' }));
    expect(r.success).toBe(true);
    const serie = await prisma.appointment.findMany({ where: { tenantId: tenant.id, patientId: p1.id }, orderBy: { startTime: 'asc' } });
    expect(serie).toHaveLength(8);
    expect(new Set(serie.map((s) => s.seriesId)).size).toBe(1);
  });

  it('cancelar "este e os próximos" não mexe nos atendidos nem nos anteriores', async () => {
    logado = user.clerkUserId;
    const serie = await prisma.appointment.findMany({ where: { tenantId: tenant.id, patientId: p1.id }, orderBy: { startTime: 'asc' } });
    await prisma.appointment.update({ where: { id: serie[5].id }, data: { status: 'ATTENDED' } });
    const op = await agenda.cancelOptionsAction();
    const motivo = op!.reasons[0];
    expect(await agenda.cancelAppointmentFull(serie[3].id, { cancelledBy: 'CLINIC', reasonId: motivo.id, scope: 'next' })).toEqual({ ok: true });
    const depois = await prisma.appointment.findMany({ where: { tenantId: tenant.id, patientId: p1.id }, orderBy: { startTime: 'asc' } });
    expect(depois.map((d) => d.status)).toEqual(['SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'CANCELLED', 'CANCELLED', 'ATTENDED', 'CANCELLED', 'CANCELLED']);
  });

  it('sala ocupada barra mesmo com outro profissional; encaixe passa', async () => {
    logado = user.clerkUserId;
    expect((await agenda.createAppointment(null, form({ patientId: p2.id, date: '2027-04-05', agendaId: sala.id }))).success).toBe(true);
    const ocupada = await agenda.createAppointment(null, form({ patientId: p1.id, date: '2027-04-05', agendaId: sala.id, professionalId: prof2.id }));
    expect(ocupada).toMatchObject({ success: false });
    if (!ocupada.success) expect(ocupada.message).toContain('Sala Laser');
    const comEncaixe = await agenda.createAppointment(null, form({ patientId: p1.id, date: '2027-04-05', careTypeId: encaixe.id }));
    expect(comEncaixe.success).toBe(true);
  });

  it('feriado bloqueado barra; sem a regra, deixa marcar', async () => {
    logado = user.clerkUserId;
    expect((await agenda.createAppointment(null, form({ patientId: p1.id, date: '2027-12-25', startTime: '10:00', endTime: '10:30' }))).success).toBe(true);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { settings: { agenda: { blockHolidays: true } } } });
    await prisma.holiday.create({ data: { tenantId: tenant.id, date: new Date('2027-01-25T00:00:00Z'), name: 'Aniversário da cidade' } });
    const r = await agenda.createAppointment(null, form({ patientId: p1.id, date: '2027-01-25' }));
    expect(r).toMatchObject({ success: false });
    if (!r.success) expect(r.message).toContain('Aniversário da cidade');
  });
});
