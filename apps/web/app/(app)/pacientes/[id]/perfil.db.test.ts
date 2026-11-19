import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
const depois: (() => Promise<unknown> | unknown)[] = [];
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (fn: () => unknown) => depois.push(fn),
}));

let logado: string | null = null;
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: logado }) }));

/**
 * Perfil do paciente (spec 2026-11-18, F2): linha do tempo gravada nas ações e
 * preenchida do passado sem repetir, isolada por clínica; observações; planos
 * de tratamento a partir do odontograma.
 */
const envFile = resolve(__dirname, '..', '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

async function rodarDepois() {
  while (depois.length) await depois.shift()!();
}

describe.skipIf(!process.env.DATABASE_URL)('perfil do paciente (banco)', async () => {
  const { prisma, encrypt } = await import('@clinicaiq/db');
  const { backfillPatientTimeline, recordPatientEvent } = await import('@/lib/patient-timeline');
  const { loadTimelinePage, loadProfileExtras } = await import('./profile-data');
  const { createPlanFromOdontogram, togglePlanItem, setNoteFlags, editNote, addNoteAction } = await import('./profile-actions');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const clinica = async (nome: string) => {
    const tenant = await prisma.tenant.create({ data: { clerkOrgId: `pf_${nome}_${suffix}`, name: `PF ${nome}`, slug: `pf-${nome}-${suffix}` } });
    await prisma.subscription.create({ data: { tenantId: tenant.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01'), complimentary: true } });
    const clerkUserId = `user_pf_${nome}_${suffix}`;
    const user = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId, name: `Recepção ${nome}`, email: `pf-${nome}-${suffix}@teste.local`, role: 'RECEPTIONIST' } });
    const prof = await prisma.professional.create({ data: { tenantId: tenant.id, name: `Dra ${nome}` } });
    const patient = await prisma.patient.create({
      data: { tenantId: tenant.id, controlNumber: 1, name: `Paciente ${nome}`, phoneEncrypted: encrypt('11987650000', process.env.ENCRYPTION_MASTER_KEY!, tenant.id), lgpdConsentAt: new Date(), createdAt: new Date('2026-01-10T12:00:00Z') },
    });
    return { tenant, clerkUserId, user, prof, patient };
  };
  const a = await clinica('a');
  const b = await clinica('b');

  afterAll(async () => {
    for (const c of [a, b]) {
      const t = { tenantId: c.tenant.id };
      await prisma.treatmentPlanItem.deleteMany({ where: t });
      await prisma.treatmentPlan.deleteMany({ where: t });
      await prisma.toothFinding.deleteMany({ where: t });
      await prisma.patientEvent.deleteMany({ where: t });
      await prisma.patientNote.deleteMany({ where: t });
      await prisma.appointment.deleteMany({ where: t });
      await prisma.auditLog.deleteMany({ where: t });
      await prisma.patient.deleteMany({ where: t });
      await prisma.professional.deleteMany({ where: t });
      await prisma.user.deleteMany({ where: t });
      await prisma.subscription.deleteMany({ where: t });
      await prisma.tenant.delete({ where: { id: c.tenant.id } });
    }
  });

  it('preenche o passado uma vez só, sem repetir o que já foi gravado ao vivo', async () => {
    const ap = await prisma.appointment.create({
      data: { tenantId: a.tenant.id, patientId: a.patient.id, professionalId: a.prof.id, startTime: new Date('2026-02-01T14:00:00Z'), endTime: new Date('2026-02-01T15:00:00Z'), status: 'ATTENDED', cancelledBy: null },
    });
    // Gravado ao vivo antes da primeira visita.
    await recordPatientEvent(a.tenant.id, a.patient.id, 'appointment.created', 'ao vivo', { refType: 'appointment', refId: ap.id });
    await backfillPatientTimeline(a.tenant.id, a.patient.id);
    await backfillPatientTimeline(a.tenant.id, a.patient.id);
    const page = await loadTimelinePage(a.tenant.id, a.patient.id);
    const tipos = page.items.map((i) => i.type).sort();
    expect(tipos).toEqual(['appointment.attended', 'appointment.created', 'patient.created']);
    // Do mais novo para o mais antigo.
    const datas = page.items.map((i) => i.at);
    expect([...datas].sort().reverse()).toEqual(datas);
  });

  it('a linha do tempo não mistura clínicas, nem grava para paciente de fora', async () => {
    await recordPatientEvent(b.tenant.id, a.patient.id, 'patient.updated', 'de fora');
    expect(await prisma.patientEvent.count({ where: { tenantId: b.tenant.id } })).toBe(0);
    const deB = await loadTimelinePage(b.tenant.id, a.patient.id);
    expect(deB.items).toEqual([]);
  });

  it('pagina de 20 em 20', async () => {
    for (let i = 0; i < 25; i++) await recordPatientEvent(a.tenant.id, a.patient.id, 'whatsapp.sent', `msg ${i}`, { at: new Date(Date.UTC(2026, 5, 1, 10, i)) });
    const p1 = await loadTimelinePage(a.tenant.id, a.patient.id);
    expect(p1.items).toHaveLength(20);
    expect(p1.more).toBe(true);
    const p2 = await loadTimelinePage(a.tenant.id, a.patient.id, { before: new Date(p1.items[19].at) });
    expect(p2.items.length).toBeGreaterThan(0);
    expect(p2.items.some((i) => p1.items.find((x) => x.id === i.id))).toBe(false);
  });

  it('observação: fixar e "na agenda"; editar só a própria', async () => {
    logado = a.clerkUserId;
    expect(await addNoteAction(a.patient.id, 'Prefere manhã', { showInAgenda: true })).toEqual({ ok: true });
    const nota = await prisma.patientNote.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    expect(nota.showInAgenda).toBe(true);
    expect(await setNoteFlags(nota.id, { pinned: true })).toEqual({ ok: true });
    const outra = await prisma.user.create({ data: { tenantId: a.tenant.id, clerkUserId: `user_pf_c_${suffix}`, name: 'Outra', email: `pf-c-${suffix}@teste.local`, role: 'RECEPTIONIST' } });
    const deOutra = await prisma.patientNote.create({ data: { tenantId: a.tenant.id, patientId: a.patient.id, userId: outra.id, content: 'da outra' } });
    expect(await editNote(deOutra.id, 'mexi')).toMatchObject({ ok: false });
    expect(await editNote(nota.id, 'Prefere manhã cedo')).toEqual({ ok: true });
    logado = b.clerkUserId;
    expect(await setNoteFlags(nota.id, { pinned: false })).toMatchObject({ ok: false });
  });

  it('plano do odontograma pega o que está a fazer, sem repetir em outro plano aberto', async () => {
    logado = a.clerkUserId;
    await prisma.toothFinding.createMany({
      data: [
        { tenantId: a.tenant.id, patientId: a.patient.id, toothNumber: 11, kind: 'CARIES', status: 'PLANNED' },
        { tenantId: a.tenant.id, patientId: a.patient.id, toothNumber: 21, kind: 'CARIES', status: 'PLANNED' },
        { tenantId: a.tenant.id, patientId: a.patient.id, toothNumber: 36, kind: 'RESTORATION', status: 'DONE' },
      ],
    });
    expect(await createPlanFromOdontogram(a.patient.id)).toEqual({ ok: true });
    await rodarDepois();
    expect(await createPlanFromOdontogram(a.patient.id)).toMatchObject({ ok: false });
    const extras = await loadProfileExtras(a.tenant.id, a.patient.id);
    expect(extras.plans).toHaveLength(1);
    expect(extras.plans[0].items).toHaveLength(2);
    expect(extras.plans[0].number).toBe(1);
    expect(await togglePlanItem(extras.plans[0].items[0].id, true)).toEqual({ ok: true });
    const plano = await prisma.treatmentPlan.findFirstOrThrow({ where: { tenantId: a.tenant.id }, include: { items: true } });
    expect(plano.items.filter((i) => i.doneAt)).toHaveLength(1);
    expect(extras.attendance.attended).toBe(1);
  });
});
