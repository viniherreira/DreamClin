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
 * Situação, cancelamento e remarcação (spec 2026-11-18, F4): cancelar pede quem
 * cancelou e o motivo; confirmar pela recepção e pelo WhatsApp grava a origem;
 * remarcar guarda de onde veio e confere conflito; quem pediu para remarcar
 * volta a "a confirmar".
 */
const envFile = resolve(__dirname, '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';
process.env.PACIENTE_AGENDA = 'todos';

describe.skipIf(!process.env.DATABASE_URL)('situação e remarcação (banco)', async () => {
  const { prisma, encrypt } = await import('@clinicaiq/db');
  const agenda = await import('./actions');
  const { applyAppointmentResponse } = await import('@/lib/whatsapp');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await prisma.tenant.create({ data: { clerkOrgId: `st_${suffix}`, name: 'ST', slug: `st-${suffix}` } });
  await prisma.subscription.create({ data: { tenantId: tenant.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId: `user_st_${suffix}`, name: 'Recepção', email: `st-${suffix}@teste.local`, role: 'RECEPTIONIST' } });
  const prof = await prisma.professional.create({ data: { tenantId: tenant.id, name: 'Dra Ana' } });
  const prof2 = await prisma.professional.create({ data: { tenantId: tenant.id, name: 'Dr Bruno' } });
  const patient = await prisma.patient.create({ data: { tenantId: tenant.id, controlNumber: 1, name: 'Carla', phoneEncrypted: encrypt('11987650000', process.env.ENCRYPTION_MASTER_KEY!, tenant.id), lgpdConsentAt: new Date() } });
  const marcar = (h: number, status: 'SCHEDULED' | 'RESCHEDULED' = 'SCHEDULED') =>
    prisma.appointment.create({ data: { tenantId: tenant.id, patientId: patient.id, professionalId: prof.id, status, startTime: new Date(Date.UTC(2027, 0, 10, h, 0)), endTime: new Date(Date.UTC(2027, 0, 10, h, 30)) } });

  afterAll(async () => {
    const t = { tenantId: tenant.id };
    await prisma.whatsAppMessage.deleteMany({ where: t });
    await prisma.appointmentReschedule.deleteMany({ where: t });
    await prisma.patientEvent.deleteMany({ where: t });
    await prisma.auditLog.deleteMany({ where: t });
    await prisma.appointment.deleteMany({ where: t });
    await prisma.cancelReason.deleteMany({ where: t });
    await prisma.patient.deleteMany({ where: t });
    await prisma.professional.deleteMany({ where: t });
    await prisma.user.deleteMany({ where: t });
    await prisma.subscription.deleteMany({ where: t });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });

  it('cancelar pede quem cancelou e o motivo (obrigatório por padrão), e grava os dois', async () => {
    logado = user.clerkUserId;
    const ap = await marcar(9);
    const op = await agenda.cancelOptionsAction();
    expect(op?.required).toBe(true);
    expect(op?.reasons.map((r) => r.name)).toContain('Paciente doente');
    expect(await agenda.cancelAppointmentFull(ap.id, { cancelledBy: '' })).toMatchObject({ ok: false });
    expect(await agenda.cancelAppointmentFull(ap.id, { cancelledBy: 'PATIENT' })).toMatchObject({ ok: false });
    const doente = op!.reasons.find((r) => r.name === 'Paciente doente')!;
    expect(await agenda.cancelAppointmentFull(ap.id, { cancelledBy: 'PATIENT', reasonId: doente.id, reasonText: 'gripe' })).toEqual({ ok: true });
    const c = await prisma.appointment.findUniqueOrThrow({ where: { id: ap.id } });
    expect(c).toMatchObject({ status: 'CANCELLED', cancelledBy: 'PATIENT', cancelReasonId: doente.id, cancelReason: 'Paciente doente: gripe' });
  });

  it('confirmar pela lista grava "recepção"; pelo WhatsApp grava "WhatsApp" (confirmado pelo paciente)', async () => {
    logado = user.clerkUserId;
    const a1 = await marcar(10);
    expect(await agenda.setStatusDirectAction(a1.id, 'CONFIRMED')).toMatchObject({ ok: true });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a1.id } })).confirmationSource).toBe('RECEPTION');
    const a2 = await marcar(11);
    expect(await applyAppointmentResponse(a2.id, { buttonReplyId: 'confirm', tenantId: tenant.id, externalId: `wamid.c.${suffix}` })).toBe(true);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a2.id } })).confirmationSource).toBe('WHATSAPP');
    const d = await agenda.getAppointmentDetail(a2.id);
    expect(d?.statusText).toBe('Confirmado pelo paciente');
  });

  it('remarcar guarda de onde veio, confere conflito, e quem pediu volta a "a confirmar"', async () => {
    logado = user.clerkUserId;
    const ocupado = await marcar(14);
    const pediu = await marcar(15, 'RESCHEDULED');
    expect(await agenda.rescheduleAppointmentAction(pediu.id, { date: '2027-01-10', startTime: '14:00', endTime: '14:30', professionalId: prof.id })).toMatchObject({ ok: false });
    expect(await agenda.rescheduleAppointmentAction(pediu.id, { date: '2027-01-12', startTime: '09:00', endTime: '09:30', professionalId: prof2.id, reason: 'Paciente viaja' })).toEqual({ ok: true });
    const r = await prisma.appointmentReschedule.findFirstOrThrow({ where: { tenantId: tenant.id, appointmentId: pediu.id } });
    expect(r).toMatchObject({ fromProfessionalId: prof.id, toProfessionalId: prof2.id, reason: 'Paciente viaja', patientAsked: true, source: 'AGENDA' });
    const depois = await prisma.appointment.findUniqueOrThrow({ where: { id: pediu.id } });
    expect(depois.status).toBe('SCHEDULED');
    expect(depois.startTime.toISOString()).toBe('2027-01-12T09:00:00.000Z');
    const det = await agenda.getAppointmentDetail(pediu.id);
    expect(det?.reschedules).toHaveLength(1);
    expect(ocupado.id).toBeTruthy();
  });

  it('arrastar para outro dia também conta como remarcação', async () => {
    logado = user.clerkUserId;
    const ap = await marcar(16);
    expect(await agenda.moveAppointment(ap.id, '2027-01-11T16:00:00.000Z', '2027-01-11T16:30:00.000Z', prof.id)).toMatchObject({ success: true });
    expect(await prisma.appointmentReschedule.count({ where: { tenantId: tenant.id, appointmentId: ap.id, source: 'DRAG' } })).toBe(1);
  });
});
