import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

let logado: string | null = null;
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: logado }) }));

const envFile = resolve(__dirname, '..', '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';
process.env.FINANCEIRO_COMPLETO = 'todos';

describe.skipIf(!process.env.DATABASE_URL)('financeiro: ações do caixa por perfil, conferência cega e avisos (banco)', async () => {
  const { prisma } = await import('@clinicaiq/db');
  const caixa = await import('./cash-actions');
  const { finContext } = await import('@/fin/guard');
  const { cashAlerts, cashView, closedCashList, openCashList } = await import('@/fin/cash-read');
  const { ZERO_COUNT } = await import('@/lib/financeiro/cash');
  const { clinicToday } = await import('@/lib/tz');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const t = await prisma.tenant.create({ data: { clerkOrgId: `cxa_${suffix}`, name: 'Caixa ações', slug: `cxa-${suffix}` } });
  const assinatura = await prisma.subscription.create({ data: { tenantId: t.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') } });
  const pessoa = (nome: string, role: 'OWNER' | 'RECEPTIONIST' | 'PROFESSIONAL') =>
    prisma.user.create({ data: { tenantId: t.id, clerkUserId: `cxa_${nome}_${suffix}`, name: nome, email: `cxa-${nome}-${suffix}@teste.local`, role } });
  const dono = await pessoa('dono', 'OWNER');
  const rec = await pessoa('rec', 'RECEPTIONIST');
  const rec2 = await pessoa('rec2', 'RECEPTIONIST');
  const profissional = await pessoa('prof', 'PROFESSIONAL');
  const como = (u: { clerkUserId: string | null }) => {
    logado = u.clerkUserId;
  };
  const contexto = async () => (await finContext())!;
  const regras = (finance: object) => prisma.tenant.update({ where: { id: t.id }, data: { settings: { finance } } });
  const contado = (v: Partial<typeof ZERO_COUNT>) => ({ ...ZERO_COUNT, ...v });

  afterAll(async () => {
    const w = { tenantId: t.id };
    await prisma.cashSessionCount.deleteMany({ where: w });
    await prisma.financialTransaction.deleteMany({ where: w });
    await prisma.cashSession.deleteMany({ where: w });
    await prisma.finPaymentMethodFee.deleteMany({ where: w });
    await prisma.finPaymentMethod.deleteMany({ where: w });
    await prisma.financialCategory.deleteMany({ where: { ...w, parentId: { not: null } } });
    await prisma.financialCategory.deleteMany({ where: w });
    await prisma.financialAccount.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.subscription.deleteMany({ where: w });
    await prisma.clinicUnit.deleteMany({ where: w });
    await prisma.tenant.deleteMany({ where: { id: t.id } });
  });

  it('o profissional não opera o caixa; a recepção abre o dela e não mexe no da colega', async () => {
    como(profissional);
    expect((await caixa.openCashAction({ openingCents: 0 })).ok).toBe(false);
    como(rec);
    const meu = await caixa.openCashAction({ openingCents: 5000 });
    expect(meu.ok).toBe(true);
    if (!meu.ok) return;
    expect((await caixa.cashMoveAction({ sessionId: meu.id, kind: 'REINFORCEMENT', amountCents: 1000 })).ok).toBe(true);

    como(rec2);
    expect((await caixa.cashMoveAction({ sessionId: meu.id, kind: 'WITHDRAWAL', amountCents: 100 })).ok).toBe(false);
    expect((await caixa.closeCashAction({ sessionId: meu.id, counted: contado({ CASH: 6000 }) })).ok).toBe(false);
    // Nem vê: a tela do caixa de outra pessoa devolve nada, e a lista só traz os próprios.
    expect(await cashView(await contexto(), meu.id)).toBeNull();
    expect(await openCashList(await contexto())).toHaveLength(0);
    expect((await caixa.markCashSeenAction(meu.id)).ok).toBe(false);

    como(dono);
    expect((await openCashList(await contexto())).map((c) => c.id)).toEqual([meu.id]);
    expect((await cashView(await contexto(), meu.id))?.expected?.CASH).toBe(6000);
  });

  it('conferência cega: a recepção não vê o esperado antes de contar; o dono vê', async () => {
    await regras({ blindCashCount: true });
    como(rec);
    const aberto = (await openCashList(await contexto()))[0];
    const antes = await cashView(await contexto(), aberto.id);
    expect(antes).toMatchObject({ expected: null, summary: null, counts: [], blind: true });
    como(dono);
    expect((await cashView(await contexto(), aberto.id))?.expected?.CASH).toBe(6000);

    // Ela conta R$ 55 (espera-se R$ 60): fica registrado e agora ela vê a diferença.
    como(rec);
    const r1 = await caixa.closeCashAction({ sessionId: aberto.id, counted: contado({ CASH: 5500 }) });
    expect(r1).toMatchObject({ ok: false, code: 'NEEDS_JUSTIFICATION' });
    const depois = await cashView(await contexto(), aberto.id);
    expect(depois?.pendingCount).toBe(true);
    expect(depois?.counts.find((c) => c.group === 'CASH')).toMatchObject({ expected: 6000, counted: 5500, diff: -500 });
    // Mandar outro valor contado não muda nada: só a justificativa fecha.
    const r2 = await caixa.closeCashAction({ sessionId: aberto.id, counted: contado({ CASH: 6000 }), justification: 'Faltaram cinco reais no troco' });
    expect(r2).toMatchObject({ ok: true, difference: -500 });
    await regras({});
  });

  it('avisos: fechado com diferença aparece para o dono até ele marcar como visto', async () => {
    como(rec);
    expect((await cashAlerts(await contexto())).withDifference).toHaveLength(0);
    como(dono);
    const avisos = await cashAlerts(await contexto());
    expect(avisos.withDifference).toHaveLength(1);
    expect(avisos.withDifference[0]).toMatchObject({ differenceCents: -500, hasDifference: true });
    const hoje = clinicToday() as never;
    const fechados = await closedCashList(await contexto(), { from: hoje, to: hoje, onlyDifference: true });
    expect(fechados.total).toBe(1);
    expect((await caixa.markCashSeenAction(avisos.withDifference[0].id)).ok).toBe(true);
    expect((await cashAlerts(await contexto())).withDifference).toHaveLength(0);
    // Com o aviso desligado nas regras, nem aparece.
    await prisma.auditLog.deleteMany({ where: { tenantId: t.id, action: 'REVIEW' } });
    await regras({ alertCashDifference: false });
    expect((await cashAlerts(await contexto())).withDifference).toHaveLength(0);
    await regras({});
  });

  it('avisa caixa aberto há mais dias que o limite da clínica', async () => {
    como(rec2);
    const r = await caixa.openCashAction({ openingCents: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await cashAlerts(await contexto())).openLong).toHaveLength(0);
    await prisma.cashSession.update({ where: { id: r.id }, data: { openedAt: new Date(Date.now() - 3 * 86_400_000) } });
    const dela = await cashAlerts(await contexto());
    expect(dela.openLong.map((c) => c.id)).toEqual([r.id]);
    como(dono);
    expect((await cashAlerts(await contexto())).openLong[0]).toMatchObject({ id: r.id, mine: false, tooLong: true });
    await regras({ openCashAlertDays: 0 });
    expect((await cashAlerts(await contexto())).openLong).toHaveLength(0);
    await regras({});
    // O dono fecha o caixa esquecido da recepcionista.
    expect((await caixa.closeCashAction({ sessionId: r.id, counted: contado({}) })).ok).toBe(true);
  });

  it('conta em só leitura não abre nem movimenta caixa', async () => {
    await prisma.subscription.update({ where: { id: assinatura.id }, data: { status: 'PAST_DUE', currentPeriodEnd: new Date('2020-01-01') } });
    como(dono);
    const antes = await prisma.cashSession.count({ where: { tenantId: t.id } });
    expect((await caixa.openCashAction({ openingCents: 0 })).ok).toBe(false);
    expect(await prisma.cashSession.count({ where: { tenantId: t.id } })).toBe(antes);
    await prisma.subscription.update({ where: { id: assinatura.id }, data: { status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') } });
  });
});
