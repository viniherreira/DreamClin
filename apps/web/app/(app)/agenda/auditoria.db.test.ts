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
 * Auditoria do agendamento: cada ação grava o que mudou, com quem fez; a
 * resposta do paciente pelo WhatsApp aparece como "Paciente pelo WhatsApp";
 * excluir guarda como estava; e a auditoria não vaza para outra clínica.
 */
const envFile = resolve(__dirname, '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';
// Só a bandeira do paciente e da agenda (a cortesia ligaria também o financeiro novo).
process.env.PACIENTE_AGENDA = 'todos';

describe.skipIf(!process.env.DATABASE_URL)('auditoria do agendamento (banco)', async () => {
  const { prisma, encrypt } = await import('@clinicaiq/db');
  const agenda = await import('./actions');
  const { applyAppointmentResponse } = await import('@/lib/whatsapp');
  const { auditAppointment } = await import('@/lib/appointment-audit-server');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const clinica = async (nome: string) => {
    const tenant = await prisma.tenant.create({ data: { clerkOrgId: `au_${nome}_${suffix}`, name: `AU ${nome}`, slug: `au-${nome}-${suffix}` } });
    await prisma.subscription.create({ data: { tenantId: tenant.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') } });
    const user = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId: `user_au_${nome}_${suffix}`, name: `Recepção ${nome}`, email: `au-${nome}-${suffix}@teste.local`, role: 'RECEPTIONIST' } });
    const prof = await prisma.professional.create({ data: { tenantId: tenant.id, name: `Dra ${nome}` } });
    const patient = await prisma.patient.create({ data: { tenantId: tenant.id, controlNumber: 1, name: `Paciente ${nome}`, phoneEncrypted: encrypt('11987650000', process.env.ENCRYPTION_MASTER_KEY!, tenant.id), lgpdConsentAt: new Date() } });
    const label = await prisma.appointmentLabel.create({ data: { tenantId: tenant.id, name: 'Primeira vez', color: 'blue' } });
    const appt = await prisma.appointment.create({
      data: { tenantId: tenant.id, patientId: patient.id, professionalId: prof.id, startTime: new Date('2026-12-15T14:30:00Z'), endTime: new Date('2026-12-15T15:00:00Z') },
    });
    await auditAppointment(tenant.id, user.id, appt.id, 'APPOINTMENT_CREATED', null);
    return { tenant, user, prof, patient, label, appt };
  };
  const a = await clinica('a');
  const b = await clinica('b');

  afterAll(async () => {
    for (const c of [a, b]) {
      const t = { tenantId: c.tenant.id };
      await prisma.whatsAppMessage.deleteMany({ where: t });
      await prisma.patientEvent.deleteMany({ where: t });
      await prisma.auditLog.deleteMany({ where: t });
      await prisma.appointment.deleteMany({ where: t });
      await prisma.appointmentLabel.deleteMany({ where: t });
      await prisma.patient.deleteMany({ where: t });
      await prisma.professional.deleteMany({ where: t });
      await prisma.user.deleteMany({ where: t });
      await prisma.subscription.deleteMany({ where: t });
      await prisma.tenant.delete({ where: { id: c.tenant.id } });
    }
  });

  it('criou, trocou o rótulo e mudou a situação: cada um com quem fez e o antes e depois', async () => {
    logado = a.user.clerkUserId;
    expect(await agenda.setAppointmentLabel(a.appt.id, a.label.id)).toEqual({ ok: true });
    await agenda.updateAppointmentStatus(a.appt.id, 'CONFIRMED');
    const audit = await agenda.getAppointmentAuditAction(a.appt.id);
    expect(audit?.map((x) => x.action)).toEqual(['APPOINTMENT_CREATED', 'APPOINTMENT_LABEL', 'APPOINTMENT_STATUS']);
    expect(audit?.every((x) => x.who === 'Recepção a')).toBe(true);
    expect(audit?.[1].changes).toEqual([{ field: 'label', label: 'Rótulo', before: '(vazio)', after: 'Primeira vez' }]);
    expect(audit?.[2].changes).toEqual([{ field: 'status', label: 'Situação', before: 'A confirmar', after: 'Confirmado' }]);
  });

  it('mudar para a mesma situação não grava nada novo', async () => {
    logado = a.user.clerkUserId;
    await agenda.updateAppointmentStatus(a.appt.id, 'CONFIRMED');
    expect((await agenda.getAppointmentAuditAction(a.appt.id))?.length).toBe(3);
  });

  it('o paciente cancelando pelo WhatsApp aparece como paciente, com quem cancelou', async () => {
    expect(await applyAppointmentResponse(a.appt.id, { buttonReplyId: 'cancel', tenantId: a.tenant.id, externalId: `wamid.${suffix}` })).toBe(true);
    logado = a.user.clerkUserId;
    const ultimo = (await agenda.getAppointmentAuditAction(a.appt.id))!.at(-1)!;
    expect(ultimo.action).toBe('WHATSAPP_RESPONSE_CANCELLED');
    expect(ultimo.who).toBe('Paciente pelo WhatsApp');
    expect(ultimo.changes.map((c) => c.label)).toEqual(['Situação', 'Motivo do cancelamento', 'Quem cancelou']);
  });

  it('a auditoria de um agendamento não aparece para outra clínica', async () => {
    logado = b.user.clerkUserId;
    expect(await agenda.getAppointmentAuditAction(a.appt.id)).toBeNull();
  });

  it('excluir guarda como o agendamento estava e quem excluiu', async () => {
    logado = b.user.clerkUserId;
    expect(await agenda.deleteAppointment(b.appt.id)).toEqual({ success: true });
    const audit = await agenda.getAppointmentAuditAction(b.appt.id);
    const fim = audit!.at(-1)!;
    expect(fim.action).toBe('APPOINTMENT_DELETED');
    expect(fim.who).toBe('Recepção b');
    expect(fim.changes.find((c) => c.label === 'Profissional')?.after).toBe('Dra b');
  });
});
