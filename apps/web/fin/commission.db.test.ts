import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('financeiro: comissões e repasses (banco)', async () => {
  const { prisma, getTenantClient, encrypt } = await import('@clinicaiq/db');
  const { setupFinance, methodId } = await import('./setup');
  const { settleTitleTx } = await import('./settle');
  const { reverseTransactionTx } = await import('./reverse');
  const { cancelTitle } = await import('./titles');
  const appt = await import('./appointments');
  const com = await import('./commission');
  const { DEFAULT_FINANCE_SETTINGS } = await import('../lib/financeiro/settings');
  const { toCents } = await import('../lib/financeiro/money');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const HOJE = '2026-11-17' as never;
  const chave = process.env.ENCRYPTION_MASTER_KEY!;

  const t = await prisma.tenant.create({ data: { clerkOrgId: `cm_${suffix}`, name: 'Comissões', slug: `cm-${suffix}` } });
  const B = await prisma.tenant.create({ data: { clerkOrgId: `cmb_${suffix}`, name: 'Comissões B', slug: `cmb-${suffix}` } });
  await setupFinance(t.id);
  await setupFinance(B.id);
  const db = getTenantClient(t.id);
  const dbB = getTenantClient(B.id);
  const dono = await prisma.user.create({ data: { tenantId: t.id, clerkUserId: `cm_dono_${suffix}`, name: 'Dono', email: `cm-dono-${suffix}@teste.local`, role: 'OWNER' } });
  const draAna = await prisma.professional.create({ data: { tenantId: t.id, name: 'Dra. Ana', commissionPercent: 10 } });
  const drBeto = await prisma.professional.create({ data: { tenantId: t.id, name: 'Dr. Beto' } });
  const limpeza = await prisma.procedure.create({ data: { tenantId: t.id, name: 'Limpeza', basePrice: 200, costPrice: 20, durationMinutes: 30 } });
  const canal = await prisma.procedure.create({ data: { tenantId: t.id, name: 'Canal', basePrice: 800, durationMinutes: 60 } });
  const lab = await prisma.finContact.create({ data: { tenantId: t.id, name: 'Laboratório Sorriso', kind: 'SUPPLIER', personType: 'PJ' } });
  const paciente = await prisma.patient.create({ data: { tenantId: t.id, controlNumber: 1, name: 'Paciente Comissão', phoneEncrypted: encrypt('11999990009', chave, t.id) } });
  let minuto = 0;
  const agendar = (professionalId: string, procedureId: string, extra: object = {}) => {
    const inicio = Date.parse('2026-11-17T08:00:00.000Z') + minuto++ * 30 * 60_000;
    return prisma.appointment.create({ data: { tenantId: t.id, patientId: paciente.id, professionalId, procedureId, startTime: new Date(inicio), endTime: new Date(inicio + 30 * 60_000), ...extra } });
  };
  const settings = (s: object = {}) => ({ ...DEFAULT_FINANCE_SETTINGS, requireOpenCashForCash: false, ...s });
  const env = (s: object = {}) => ({ tenantId: t.id, userId: dono.id, settings: settings(s), today: HOJE });
  const settleEnv = (s: object = {}) => ({ ...env(s), access: { role: 'OWNER' as const } });
  const linhas = (appointmentId: string) => db.commissionEntry.findMany({ where: { appointmentId }, orderBy: { createdAt: 'asc' } });
  const soma = async (appointmentId: string, kind = 'COMMISSION') => (await db.commissionEntry.findMany({ where: { appointmentId, kind, status: { not: 'REVERSED' } } })).reduce((s, l) => s + toCents(l.amount) + toCents(l.adjustment), 0);

  afterAll(async () => {
    for (const id of [t.id, B.id]) {
      const w = { tenantId: id };
      await prisma.commissionEntry.deleteMany({ where: w });
      await prisma.commissionException.deleteMany({ where: w });
      await prisma.transferType.deleteMany({ where: w });
      await prisma.walletEntry.deleteMany({ where: w });
      await prisma.cardReceivable.deleteMany({ where: w });
      await prisma.financialTransaction.deleteMany({ where: { ...w, reversalOfId: { not: null } } });
      await prisma.financialTransaction.deleteMany({ where: w });
      await prisma.financialTitle.deleteMany({ where: w });
      await prisma.payment.deleteMany({ where: w });
      await prisma.appointmentItem.deleteMany({ where: w });
      await prisma.appointment.deleteMany({ where: w });
      await prisma.finContact.deleteMany({ where: w });
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
      await prisma.tenant.deleteMany({ where: { id } });
    }
  });

  it('no atendimento: o % do cadastro do profissional vale como regra (nada muda para quem já usava)', async () => {
    const a = await agendar(draAna.id, limpeza.id, { status: 'ATTENDED' });
    await db.$transaction((tx) => appt.onAttendedTx(tx, env(), a.id));
    const l = await linhas(a.id);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ kind: 'COMMISSION', professionalId: draAna.id, trigger: 'EXECUTION' });
    expect(toCents(l[0].amount)).toBe(2000);
    expect(l[0].ruleLabel).toContain('cadastro do profissional');
    // Rodar de novo não repete.
    await db.$transaction((tx) => appt.onAttendedTx(tx, env(), a.id));
    expect(await linhas(a.id)).toHaveLength(1);
    // Profissional sem % e clínica com 0%: nada nasce.
    const b = await agendar(drBeto.id, limpeza.id, { status: 'ATTENDED' });
    await db.$transaction((tx) => appt.onAttendedTx(tx, env(), b.id));
    expect(await linhas(b.id)).toHaveLength(0);
  });

  it('exceções e base: procedimento > profissional; tabela, cobrado e custo', async () => {
    await prisma.commissionException.createMany({
      data: [
        { tenantId: t.id, professionalId: drBeto.id, procedureId: canal.id, mode: 'PERCENT', value: 30 },
        { tenantId: t.id, professionalId: drBeto.id, procedureId: null, mode: 'FIXED', value: 15 },
      ],
    });
    const a = await agendar(drBeto.id, canal.id, { status: 'ATTENDED' });
    await db.$transaction((tx) => appt.saveItemsTx(tx, env(), a.id, [
      { procedureId: canal.id, name: 'Canal', quantity: 1, unitPriceCents: 80000, discountCents: 10000 },
      { procedureId: limpeza.id, name: 'Limpeza', quantity: 2, unitPriceCents: 20000, discountCents: 0 },
    ]));
    await db.$transaction((tx) => appt.onAttendedTx(tx, env(), a.id));
    const l = await linhas(a.id);
    // Canal: 30% de 700 (cobrado) = 210. Limpeza: R$ 15 por unidade × 2 = 30.
    expect(l.map((x) => toCents(x.amount))).toEqual([21000, 3000]);

    // Base pela tabela e descontando o custo (limpeza tem custo de R$ 20).
    const b = await agendar(draAna.id, limpeza.id, { status: 'ATTENDED' });
    await db.$transaction((tx) => appt.onAttendedTx(tx, env({ commissionBase: 'TABLE', commissionDeductCost: true }), b.id));
    expect(toCents((await linhas(b.id))[0].amount)).toBe(1800);
  });

  it('itens mudaram depois de atendido: a comissão pendente é refeita', async () => {
    const a = await agendar(draAna.id, limpeza.id, { status: 'ATTENDED' });
    await db.$transaction((tx) => appt.onAttendedTx(tx, env(), a.id));
    expect(await soma(a.id)).toBe(2000);
    await db.$transaction((tx) => appt.saveItemsTx(tx, env(), a.id, [{ procedureId: canal.id, name: 'Canal', quantity: 1, unitPriceCents: 80000, discountCents: 0 }]));
    expect(await soma(a.id)).toBe(8000);
  });

  it('no faturamento: nasce quando a conta do atendimento é criada', async () => {
    const a = await agendar(draAna.id, limpeza.id, { status: 'ATTENDED' });
    const s = { commissionWhen: 'BILLING' as const };
    await db.$transaction((tx) => appt.onAttendedTx(tx, env(s), a.id));
    expect(await linhas(a.id)).toHaveLength(0);
    await db.$transaction((tx) => appt.billAppointmentTx(tx, env(s), { appointmentId: a.id, dueDate: HOJE }));
    expect(await soma(a.id)).toBe(2000);
  });

  it('no recebimento: proporcional ao recebido, e o estorno estorna a parte dele', async () => {
    const s = { commissionWhen: 'RECEIPT' as const };
    const a = await agendar(draAna.id, canal.id, { status: 'ATTENDED' });
    await db.$transaction((tx) => appt.onAttendedTx(tx, env(s), a.id));
    expect(await linhas(a.id)).toHaveLength(0);
    const f = await db.$transaction((tx) => appt.billAppointmentTx(tx, env(s), { appointmentId: a.id, dueDate: HOJE }));
    if (!f.ok) throw new Error(f.message);
    const receber = (valor: number) => db.$transaction((tx) => settleTitleTx(tx, settleEnv(s), { titleId: f.titleIds[0], lines: [{ methodId: methodId(t.id, 'PIX'), amountCents: valor, paidOn: HOJE }] }));
    // Comissão inteira: 10% de 800 = 80. Recebeu 200 de 800: 20.
    const r1 = await receber(20000);
    expect(await soma(a.id)).toBe(2000);
    const r2 = await receber(30000);
    expect(await soma(a.id)).toBe(5000);
    if (!r2.ok) return;
    const e = await db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: t.id, userId: dono.id, today: HOJE }, { transactionId: r2.transactionIds[0], reason: 'Estorno do teste' }));
    expect(e.ok).toBe(true);
    expect(await soma(a.id)).toBe(2000);
    expect((await linhas(a.id)).filter((l) => l.status === 'REVERSED')).toHaveLength(1);
    // O resto completa os 80, sem passar.
    await receber(60000);
    expect(await soma(a.id)).toBe(8000);
    expect(r1.ok).toBe(true);
  });

  it('repasse: entra para o laboratório nos procedimentos da lista', async () => {
    await prisma.transferType.create({ data: { tenantId: t.id, name: 'Laboratório', mode: 'FIXED', value: 120, contactId: lab.id, procedureIds: [canal.id] } });
    const a = await agendar(draAna.id, canal.id, { status: 'ATTENDED' });
    await db.$transaction((tx) => appt.onAttendedTx(tx, env(), a.id));
    const rep = (await linhas(a.id)).find((l) => l.kind === 'TRANSFER');
    expect(rep).toMatchObject({ contactId: lab.id, professionalId: null });
    expect(toCents(rep!.amount)).toBe(12000);
    expect(await soma(a.id)).toBe(8000);
  });

  it('conferência: ajusta com motivo, aprova e fatura a conta a pagar; cancelar a conta solta as linhas', async () => {
    const lista = await com.listCommissions(db, { from: HOJE, to: HOJE, professionalId: draAna.id });
    const pendentes = lista.filter((r) => r.display === 'PENDING' && r.kind === 'COMMISSION');
    expect(pendentes.length).toBeGreaterThan(1);
    expect((await db.$transaction((tx) => com.adjustCommissionTx(tx, { tenantId: t.id, userId: dono.id }, pendentes[0].id, -500, '')))).toMatchObject({ ok: false });
    expect((await db.$transaction((tx) => com.adjustCommissionTx(tx, { tenantId: t.id, userId: dono.id }, pendentes[0].id, -500, 'Refez o serviço')))).toMatchObject({ ok: true });
    const ids = pendentes.map((p) => p.id);
    // Sem aprovar não fatura.
    expect((await db.$transaction((tx) => com.invoiceCommissionsTx(tx, env(), { ids, dueDate: '2026-12-05' as never }))).ok).toBe(false);
    expect(await db.$transaction((tx) => com.approveCommissionsTx(tx, { tenantId: t.id, userId: dono.id }, ids))).toMatchObject({ ok: true, approved: ids.length });
    const total = (await com.listCommissions(db, { from: HOJE, to: HOJE, professionalId: draAna.id })).filter((r) => ids.includes(r.id)).reduce((s, r) => s + r.totalCents, 0);
    const inv = await db.$transaction((tx) => com.invoiceCommissionsTx(tx, env(), { ids, dueDate: '2026-12-05' as never }));
    expect(inv).toMatchObject({ ok: true, totalCents: total });
    if (!inv.ok) return;
    const titulo = await db.financialTitle.findFirst({ where: { id: inv.titleId } });
    expect(titulo).toMatchObject({ direction: 'PAYABLE', origin: 'COMMISSION', professionalId: draAna.id });
    expect(toCents(titulo!.amount)).toBe(total);
    expect((await com.listCommissions(db, { from: HOJE, to: HOJE, professionalId: draAna.id, status: 'BILLED' })).length).toBe(ids.length);
    // Já faturada não ajusta.
    expect((await db.$transaction((tx) => com.adjustCommissionTx(tx, { tenantId: t.id, userId: dono.id }, ids[0], 100, 'Mais')))).toMatchObject({ ok: false });
    // Linhas de duas pessoas não vão juntas.
    const doLab = (await com.listCommissions(db, { from: HOJE, to: HOJE })).find((r) => r.kind === 'TRANSFER')!;
    await db.$transaction((tx) => com.approveCommissionsTx(tx, { tenantId: t.id, userId: dono.id }, [doLab.id]));
    expect((await db.$transaction((tx) => com.invoiceCommissionsTx(tx, env(), { ids: [doLab.id, ...pendentes.slice(0, 1).map((p) => p.id)], dueDate: HOJE }))).ok).toBe(false);

    expect((await cancelTitle({ tenantId: t.id, userId: dono.id, db }, inv.titleId, 'Valor errado')).ok).toBe(true);
    expect((await com.listCommissions(db, { from: HOJE, to: HOJE, professionalId: draAna.id })).filter((r) => ids.includes(r.id)).every((r) => r.display === 'APPROVED')).toBe(true);
    // A outra clínica não vê nem fatura.
    expect(await com.listCommissions(dbB, { from: HOJE, to: HOJE })).toHaveLength(0);
    expect((await dbB.$transaction((tx) => com.invoiceCommissionsTx(tx, { ...env(), tenantId: B.id }, { ids, dueDate: HOJE }))).ok).toBe(false);
  });
});
