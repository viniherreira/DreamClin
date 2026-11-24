import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Relatórios da agenda no banco (spec 2026-11-18, F8): situação por
 * profissional com confirmado pelo paciente, sem agendar, cidade, ocupação,
 * remarcações e a outra clínica nunca aparece.
 */
const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('relatórios da agenda (banco)', async () => {
  const { prisma, encrypt } = await import('@clinicaiq/db');
  const { runReport } = await import('./agenda-reports-server');
  const key = process.env.ENCRYPTION_MASTER_KEY!;
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  async function clinica(tag: string) {
    const tenant = await prisma.tenant.create({ data: { clerkOrgId: `rel${tag}_${suffix}`, name: `REL ${tag}`, slug: `rel-${tag}-${suffix}` } });
    const prof = await prisma.professional.create({ data: { tenantId: tenant.id, name: `Dra ${tag}` } });
    return { tenant, prof };
  }
  const a = await clinica('a');
  const b = await clinica('b');
  const pac = (tenantId: string, n: number, extra: Record<string, unknown> = {}) =>
    prisma.patient.create({ data: { tenantId, controlNumber: n, name: `Paciente ${n}`, phoneEncrypted: encrypt('11987650000', key, tenantId), lgpdConsentAt: new Date(), ...extra } });
  const ag = (tenantId: string, patientId: string, professionalId: string, iso: string, status: string, extra: Record<string, unknown> = {}) =>
    prisma.appointment.create({ data: { tenantId, patientId, professionalId, status: status as 'SCHEDULED', startTime: new Date(`${iso}:00Z`), endTime: new Date(new Date(`${iso}:00Z`).getTime() + 60 * 60_000), ...extra } });

  const p1 = await pac(a.tenant.id, 1, { city: 'Recife', neighborhood: 'Boa Viagem' });
  const p2 = await pac(a.tenant.id, 2, { city: 'Recife', neighborhood: 'Boa Viagem' });
  const p3 = await pac(a.tenant.id, 3, { city: 'Olinda' });
  const pb = await pac(b.tenant.id, 1, { city: 'Outra' });

  // Março de 2027 na clínica A.
  await ag(a.tenant.id, p1.id, a.prof.id, '2027-03-01T09:00', 'ATTENDED');
  await ag(a.tenant.id, p2.id, a.prof.id, '2027-03-02T09:00', 'ATTENDED');
  await ag(a.tenant.id, p3.id, a.prof.id, '2027-03-03T09:00', 'MISSED');
  await ag(a.tenant.id, p3.id, a.prof.id, '2027-03-04T09:00', 'CONFIRMED', { confirmationSource: 'WHATSAPP' });
  await ag(a.tenant.id, p1.id, a.prof.id, '2027-03-05T09:00', 'CONFIRMED', { confirmationSource: 'RECEPTION' });
  await ag(a.tenant.id, p2.id, a.prof.id, '2027-03-08T09:00', 'CANCELLED', { cancelledBy: 'PATIENT' });
  // Clínica B, mesmo período: nunca entra nos números da A.
  await ag(b.tenant.id, pb.id, b.prof.id, '2027-03-01T09:00', 'ATTENDED');
  // Um atendido há muito tempo e sem nada marcado.
  const antigo = await pac(a.tenant.id, 4);
  await ag(a.tenant.id, antigo.id, a.prof.id, '2020-01-10T09:00', 'ATTENDED');

  afterAll(async () => {
    for (const t of [a.tenant.id, b.tenant.id]) {
      await prisma.appointmentReschedule.deleteMany({ where: { tenantId: t } });
      await prisma.appointment.deleteMany({ where: { tenantId: t } });
      await prisma.patient.deleteMany({ where: { tenantId: t } });
      await prisma.professional.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.delete({ where: { id: t } });
    }
  });

  const marco = { from: '2027-03-01', to: '2027-03-31' };

  it('situação por profissional separa o confirmado pelo paciente e calcula a falta', async () => {
    const t = await runReport(a.tenant.id, 'situacao', marco);
    expect(t.rows).toHaveLength(1);
    // Profissional, a confirmar, conf. clínica, conf. paciente, atendido, faltou, canc. paciente, canc. clínica, total, taxa
    expect(t.rows[0]).toEqual(['Dra a', 0, 1, 1, 2, 1, 1, 0, 6, 33.3]);
  });

  it('origem da confirmação', async () => {
    const t = await runReport(a.tenant.id, 'confirmacao', marco);
    const m = Object.fromEntries(t.rows.map((r) => [r[0], r[1]]));
    expect(m['WhatsApp (paciente)']).toBe(1);
    expect(m['Recepção']).toBe(1);
    expect(t.total?.[1]).toBe(4);
  });

  it('cidade conta cada paciente atendido uma vez e não vê a outra clínica', async () => {
    const t = await runReport(a.tenant.id, 'cidade', marco);
    expect(t.rows).toEqual([['Recife', 'Boa Viagem', 2, 100]]);
    expect(JSON.stringify(await runReport(a.tenant.id, 'cadastro', { from: '2000-01-01', to: '2099-12-31' }))).not.toContain('Outra');
  });

  it('sem agendar traz quem não vem há mais de N dias e não tem nada marcado', async () => {
    const t = await runReport(a.tenant.id, 'sem-agendar', { ...marco, days: 365 });
    expect(t.rows.map((r) => r[0])).toEqual(['Paciente 4']);
    expect(t.rows[0][2]).toBe('11987650000');
  });

  it('ocupação: sem horário cadastrado usa o da clínica e conta só os não cancelados', async () => {
    const t = await runReport(a.tenant.id, 'ocupacao', { from: '2027-03-01', to: '2027-03-05' });
    expect(t.rows[0][0]).toBe('Dra a');
    expect(t.rows[0][2]).toBe(5);
  });

  it('remarcações listam de quando para quando', async () => {
    const x = await prisma.appointment.findFirstOrThrow({ where: { tenantId: a.tenant.id, patientId: p1.id, status: 'CONFIRMED' } });
    await prisma.appointmentReschedule.create({
      data: { tenantId: a.tenant.id, appointmentId: x.id, patientId: p1.id, fromStart: new Date('2027-03-04T09:00:00Z'), fromEnd: new Date('2027-03-04T10:00:00Z'), toStart: x.startTime, toEnd: x.endTime, reason: 'viagem', source: 'AGENDA', createdAt: new Date('2027-03-03T15:00:00Z') },
    });
    const t = await runReport(a.tenant.id, 'remarcacoes', marco);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0][1]).toBe('Paciente 1');
    expect(t.rows[0][6]).toBe('viagem');
    expect((await runReport(b.tenant.id, 'remarcacoes', marco)).rows).toHaveLength(0);
  });
});
