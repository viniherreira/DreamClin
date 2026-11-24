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
 * Escalas (spec 2026-11-18, F7): sem escala vale o horário antigo; com escala,
 * só ela; folga fecha o dia; choque pergunta e "substituir" encerra a antiga
 * na véspera; horários livres seguem a escala; profissional não configura;
 * a outra clínica não enxerga.
 */
const envFile = resolve(__dirname, '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';
process.env.PACIENTE_AGENDA = 'todos';

describe.skipIf(!process.env.DATABASE_URL)('escalas (banco)', async () => {
  const { prisma } = await import('@clinicaiq/db');
  const acoes = await import('./schedule-actions');
  const { buildWorkingDaysMap } = await import('@/lib/working-hours');
  const op = await import('../agenda/operacao-actions');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await prisma.tenant.create({ data: { clerkOrgId: `esc_${suffix}`, name: 'ESC', slug: `esc-${suffix}` } });
  const outra = await prisma.tenant.create({ data: { clerkOrgId: `esc2_${suffix}`, name: 'ESC2', slug: `esc2-${suffix}` } });
  await prisma.subscription.create({ data: { tenantId: tenant.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId: `user_esa_${suffix}`, name: 'Admin', email: `esa-${suffix}@teste.local`, role: 'ADMIN' } });
  const dentista = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId: `user_esd_${suffix}`, name: 'Dentista', email: `esd-${suffix}@teste.local`, role: 'PROFESSIONAL' } });
  const prof = await prisma.professional.create({ data: { tenantId: tenant.id, name: 'Dra Escala' } });
  // Horário antigo: segunda 09:00–17:00.
  await prisma.professionalSchedule.create({ data: { professionalId: prof.id, dayOfWeek: 1, startTime: '09:00', endTime: '17:00' } });

  afterAll(async () => {
    for (const t of [tenant.id, outra.id]) {
      await prisma.auditLog.deleteMany({ where: { tenantId: t } });
      await prisma.scheduleException.deleteMany({ where: { tenantId: t } });
      await prisma.scheduleRule.deleteMany({ where: { tenantId: t } });
      await prisma.clinicUnit.deleteMany({ where: { tenantId: t } });
    }
    await prisma.professional.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.user.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.subscription.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, outra.id] } } });
  });

  const regra = { professionalId: prof.id, startsOn: '2030-03-01', repeat: 'WEEKLY' as const, weekdays: [2], start1: '08:00', end1: '10:00' };

  it('sem escala vale o horário antigo', async () => {
    const m = await buildWorkingDaysMap(tenant.id, [prof.id], '2030-03-04', '2030-03-05');
    expect(m[prof.id]['2030-03-04']).toMatchObject({ start: '09:00', end: '17:00' }); // segunda
    expect(m[prof.id]['2030-03-05']).toBeNull(); // terça
  });

  it('profissional não configura escala', async () => {
    logado = dentista.clerkUserId;
    expect(await acoes.saveScheduleRule(regra)).toMatchObject({ ok: false });
  });

  it('com escala vale só ela, e a folga fecha o dia', async () => {
    logado = admin.clerkUserId;
    expect(await acoes.saveScheduleRule(regra)).toEqual({ ok: true });
    const m = await buildWorkingDaysMap(tenant.id, [prof.id], '2030-03-04', '2030-03-12');
    expect(m[prof.id]['2030-03-04']).toBeNull(); // segunda: o antigo não vale mais
    expect(m[prof.id]['2030-03-05']).toEqual({ start: '08:00', end: '10:00' });
    expect(await acoes.saveScheduleException({ professionalId: prof.id, date: '2030-03-12', kind: 'OFF', reason: 'congresso' })).toEqual({ ok: true });
    const m2 = await buildWorkingDaysMap(tenant.id, [prof.id], '2030-03-12', '2030-03-12');
    expect(m2[prof.id]['2030-03-12']).toBeNull();
  });

  it('horários livres seguem a escala', async () => {
    logado = admin.clerkUserId;
    // 05/03/2030 é terça de Carnaval (feriado): a semana do teste é a de 18/03.
    const [l] = await op.findFreeSlots({ from: '2030-03-18', professionalId: prof.id, days: 6 });
    expect([...new Set(l.slots.map((s) => s.date))]).toEqual(['2030-03-19']);
    expect(l.slots.map((s) => s.time)[0]).toBe('08:00');
  });

  it('choque pergunta; substituir encerra a antiga na véspera', async () => {
    logado = admin.clerkUserId;
    const nova = { ...regra, startsOn: '2030-04-01', start1: '09:00', end1: '12:00' };
    const r = await acoes.saveScheduleRule(nova);
    expect(r).toMatchObject({ ok: false });
    expect('conflicts' in r && r.conflicts).toHaveLength(1);
    expect(await acoes.saveScheduleRule(nova, 'replace')).toEqual({ ok: true });
    const regras = await prisma.scheduleRule.findMany({ where: { tenantId: tenant.id, active: true }, orderBy: { startsOn: 'asc' } });
    expect(regras).toHaveLength(2);
    expect(regras[0].endsOn?.toISOString().slice(0, 10)).toBe('2030-03-31');
    const m = await buildWorkingDaysMap(tenant.id, [prof.id], '2030-04-02', '2030-04-02');
    expect(m[prof.id]['2030-04-02']).toEqual({ start: '09:00', end: '12:00' });
  });

  it('a outra clínica não vê as escalas', async () => {
    const m = await buildWorkingDaysMap(outra.id, [prof.id], '2030-03-05', '2030-03-05');
    // Para a outra clínica o profissional não tem regra: cai no horário antigo (terça fechada).
    expect(m[prof.id]['2030-03-05']).toBeNull();
    expect(await prisma.scheduleRule.count({ where: { tenantId: outra.id } })).toBe(0);
  });
});
