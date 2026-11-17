import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

let logado: string | null = null;
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: logado }) }));

const envFile = resolve(__dirname, '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';
process.env.FINANCEIRO_COMPLETO = 'todos';

describe.skipIf(!process.env.DATABASE_URL)('agenda com o financeiro completo: itens, finalizar, receber e excluir (banco)', async () => {
  const { prisma, encrypt } = await import('@clinicaiq/db');
  const agenda = await import('./actions');
  const fin = await import('./finance-actions');
  const { settleAction } = await import('../financeiro/fin-actions');
  const { methodId } = await import('@/fin/setup');
  const { clinicToday } = await import('@/lib/tz');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const hoje = clinicToday();
  const t = await prisma.tenant.create({ data: { clerkOrgId: `agf_${suffix}`, name: 'Agenda financeiro', slug: `agf-${suffix}` } });
  await prisma.subscription.create({ data: { tenantId: t.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') } });
  const pessoa = (nome: string, role: 'OWNER' | 'RECEPTIONIST' | 'PROFESSIONAL') =>
    prisma.user.create({ data: { tenantId: t.id, clerkUserId: `agf_${nome}_${suffix}`, name: nome, email: `agf-${nome}-${suffix}@teste.local`, role } });
  const dono = await pessoa('dono', 'OWNER');
  const rec = await pessoa('rec', 'RECEPTIONIST');
  const prof = await prisma.professional.create({ data: { tenantId: t.id, name: 'Dra. Fin' } });
  const limpeza = await prisma.procedure.create({ data: { tenantId: t.id, name: 'Limpeza', basePrice: 200, durationMinutes: 30 } });
  const consulta = await prisma.procedure.create({ data: { tenantId: t.id, name: 'Consulta', basePrice: 150, durationMinutes: 30 } });
  const paciente = await prisma.patient.create({ data: { tenantId: t.id, controlNumber: 1, name: 'Paciente da Agenda', phoneEncrypted: encrypt('11999990002', process.env.ENCRYPTION_MASTER_KEY!, t.id) } });
  const como = (u: { clerkUserId: string | null }) => {
    logado = u.clerkUserId;
  };
  let minuto = 8 * 60;
  const form = (extra: Record<string, string> = {}) => {
    const h = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const fd = new FormData();
    const campos = { patientId: paciente.id, professionalId: prof.id, procedureId: limpeza.id, date: hoje, startTime: h(minuto), endTime: h(minuto + 30), type: 'PARTICULAR', status: 'SCHEDULED', ...extra };
    minuto += 30;
    for (const [k, v] of Object.entries(campos)) fd.set(k, v);
    return fd;
  };
  const situacao = async (id: string) => (await prisma.appointment.findFirst({ where: { id }, select: { billingStatus: true } }))?.billingStatus;

  afterAll(async () => {
    const w = { tenantId: t.id };
    await prisma.cardReceivable.deleteMany({ where: w });
    await prisma.walletEntry.deleteMany({ where: w });
    await prisma.financialTransaction.deleteMany({ where: { ...w, reversalOfId: { not: null } } });
    await prisma.financialTransaction.deleteMany({ where: w });
    await prisma.cashSession.deleteMany({ where: w });
    await prisma.financialTitle.deleteMany({ where: w });
    await prisma.payment.deleteMany({ where: w });
    await prisma.appointmentItem.deleteMany({ where: w });
    await prisma.whatsAppMessage.deleteMany({ where: w });
    await prisma.appointment.deleteMany({ where: w });
    await prisma.finPaymentMethodFee.deleteMany({ where: w });
    await prisma.finPaymentMethod.deleteMany({ where: w });
    await prisma.financialCategory.deleteMany({ where: { ...w, parentId: { not: null } } });
    await prisma.financialCategory.deleteMany({ where: w });
    await prisma.financialAccount.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: w });
    await prisma.procedure.deleteMany({ where: w });
    await prisma.professional.deleteMany({ where: w });
    await prisma.patient.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.subscription.deleteMany({ where: w });
    await prisma.clinicUnit.deleteMany({ where: w });
    await prisma.tenant.deleteMany({ where: { id: t.id } });
  });

  it('agendar com procedimentos e valores grava os itens e a situação "a receber"', async () => {
    como(rec);
    const fd = form({ items: JSON.stringify([{ procedureId: consulta.id, name: 'Consulta', quantity: 1, unitPriceCents: 15000, discountCents: 0 }, { procedureId: limpeza.id, name: 'Limpeza', quantity: 1, unitPriceCents: 20000, discountCents: 5000 }]) });
    const r = await agenda.createAppointment(null, fd);
    expect(r.success).toBe(true);
    if (!r.success) return;
    const itens = await prisma.appointmentItem.findMany({ where: { appointmentId: r.appointmentId }, orderBy: { order: 'asc' } });
    expect(itens.map((i) => [i.name, Number(i.total)])).toEqual([['Consulta', 150], ['Limpeza', 150]]);
    expect((await prisma.appointment.findFirst({ where: { id: r.appointmentId } }))?.procedureId).toBe(consulta.id);
    expect(await situacao(r.appointmentId)).toBe('TO_RECEIVE');
    const d = await fin.appointmentBilling(r.appointmentId);
    expect(d).toMatchObject({ status: 'TO_RECEIVE', totalCents: 30000, unbilledCents: 30000 });

    // Itens inválidos não deixam nada pela metade.
    const antes = await prisma.appointment.count({ where: { tenantId: t.id } });
    const ruim = await agenda.createAppointment(null, form({ items: JSON.stringify([{ procedureId: limpeza.id, name: 'Limpeza', quantity: 1, unitPriceCents: 100, discountCents: 500 }]) }));
    expect(ruim.success).toBe(false);
    expect(await prisma.appointment.count({ where: { tenantId: t.id } })).toBe(antes);
  });

  it('sem itens na janela, o agendamento nasce com o item do procedimento', async () => {
    como(rec);
    const r = await agenda.createAppointment(null, form());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(await prisma.appointmentItem.count({ where: { appointmentId: r.appointmentId } })).toBe(1);
    expect(await situacao(r.appointmentId)).toBe('TO_RECEIVE');
  });

  it('receber pela agenda: cria a conta, recebe no PIX e fica "pago"; excluir com pagamento é recusado', async () => {
    como(rec);
    const r = await agenda.createAppointment(null, form());
    if (!r.success) throw new Error('não criou');
    const rec1 = await fin.receiveAppointmentAction(r.appointmentId);
    expect(rec1).toMatchObject({ ok: true, created: true });
    if (!rec1.ok) return;
    // Fechar sem receber some com a conta.
    expect((await fin.discardReceiveAction(rec1.titleId)).ok).toBe(true);
    expect(await situacao(r.appointmentId)).toBe('TO_RECEIVE');

    const rec2 = await fin.receiveAppointmentAction(r.appointmentId);
    if (!rec2.ok) throw new Error(rec2.message);
    const pago = await settleAction({ titleId: rec2.titleId, lines: [{ methodId: methodId(t.id, 'PIX'), amountCents: 20000, paidOn: hoje }] });
    expect(pago.ok).toBe(true);
    expect(await situacao(r.appointmentId)).toBe('PAID');
    // Recebido pela agenda também aparece para as telas antigas (espelho).
    expect(await prisma.payment.count({ where: { tenantId: t.id, patientId: paciente.id } })).toBe(1);

    const del = await agenda.deleteAppointment(r.appointmentId);
    expect(del).toMatchObject({ success: false, error: 'has-payment' });
    expect(await prisma.appointment.findFirst({ where: { id: r.appointmentId } })).not.toBeNull();
  });

  it('finalizar devolve o que falta receber; com "faturar sozinho" a conta nasce na hora', async () => {
    como(rec);
    const r = await agenda.createAppointment(null, form());
    if (!r.success) throw new Error('não criou');
    for (const passo of ['arrive', 'start'] as const) expect((await agenda.advanceAppointment(r.appointmentId, passo)).ok).toBe(true);
    const fim = await agenda.advanceAppointment(r.appointmentId, 'finish');
    expect(fim).toMatchObject({ ok: true, openCents: 20000 });
    expect(await prisma.financialTitle.count({ where: { appointmentId: r.appointmentId } })).toBe(0);

    await prisma.tenant.update({ where: { id: t.id }, data: { settings: { finance: { autoBillOnFinish: true } } } });
    const r2 = await agenda.createAppointment(null, form());
    if (!r2.success) throw new Error('não criou');
    await agenda.advanceAppointment(r2.appointmentId, 'arrive');
    await agenda.advanceAppointment(r2.appointmentId, 'start');
    expect(await agenda.advanceAppointment(r2.appointmentId, 'finish')).toMatchObject({ ok: true, openCents: 20000 });
    expect(await situacao(r2.appointmentId)).toBe('BILLED');
    await prisma.tenant.update({ where: { id: t.id }, data: { settings: {} } });
  });

  it('bloqueio do início sem pagamento, quando a clínica liga', async () => {
    await prisma.tenant.update({ where: { id: t.id }, data: { settings: { finance: { blockStartWithoutPayment: 'PAID' } } } });
    como(rec);
    const r = await agenda.createAppointment(null, form());
    if (!r.success) throw new Error('não criou');
    await agenda.advanceAppointment(r.appointmentId, 'arrive');
    const travado = await agenda.advanceAppointment(r.appointmentId, 'start');
    expect(travado.ok).toBe(false);
    expect(await fin.noChargeAction(r.appointmentId, 'Retorno de garantia')).toMatchObject({ ok: true });
    expect((await agenda.advanceAppointment(r.appointmentId, 'start')).ok).toBe(true);
    await prisma.tenant.update({ where: { id: t.id }, data: { settings: {} } });
  });

  it('o profissional não vê o financeiro do agendamento nem recebe', async () => {
    const p = await pessoa('prof', 'PROFESSIONAL');
    como(rec);
    const r = await agenda.createAppointment(null, form());
    if (!r.success) throw new Error('não criou');
    como(p);
    expect(await fin.appointmentBilling(r.appointmentId)).toBeNull();
    expect((await fin.receiveAppointmentAction(r.appointmentId)).ok).toBe(false);
    expect((await fin.noChargeAction(r.appointmentId, 'Tentativa')).ok).toBe(false);
    como(dono);
    expect(await fin.appointmentBilling(r.appointmentId)).not.toBeNull();
  });
});
