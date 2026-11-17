import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('financeiro: relatórios (banco)', async () => {
  const { prisma, getTenantClient, encrypt } = await import('@clinicaiq/db');
  const { setupFinance, methodId, categoryId, defaultAccountId } = await import('./setup');
  const { createTitles } = await import('./titles');
  const { settleTitleTx } = await import('./settle');
  const { reverseTransactionTx } = await import('./reverse');
  const reports = await import('./reports');
  const { DEFAULT_FINANCE_SETTINGS } = await import('../lib/financeiro/settings');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const t = await prisma.tenant.create({ data: { clerkOrgId: `rp_${suffix}`, name: 'Relatórios', slug: `rp-${suffix}` } });
  await setupFinance(t.id);
  const db = getTenantClient(t.id);
  const dono = await prisma.user.create({ data: { tenantId: t.id, clerkUserId: `rp_dono_${suffix}`, name: 'Dono', email: `rp-dono-${suffix}@teste.local`, role: 'OWNER' } });
  const p = await prisma.patient.create({ data: { tenantId: t.id, controlNumber: 1, name: 'Paciente Relatório', phoneEncrypted: encrypt('11999990010', process.env.ENCRYPTION_MASTER_KEY!, t.id) } });
  const ctx = { tenantId: t.id, userId: dono.id, role: 'OWNER', unitId: null, db, permission: { maxDiscountPercent: null, operation: 'BOTH', accountIds: [], canReverse: null, canSeeReports: null }, settings: DEFAULT_FINANCE_SETTINGS, can: () => true } as unknown as Parameters<typeof reports.overview>[0];
  const env = { tenantId: t.id, userId: dono.id, access: { role: 'OWNER' as const }, settings: { ...DEFAULT_FINANCE_SETTINGS, requireOpenCashForCash: false }, today: '2026-11-17' as never };
  const conta = async (direction: 'RECEIVABLE' | 'PAYABLE', key: string, amountCents: number, dueDate: string, extra: object = {}) => {
    const r = await createTitles({ tenantId: t.id, userId: dono.id, db }, { direction, categoryId: categoryId(t.id, key), issueDate: dueDate as never, dueDate: dueDate as never, amountCents, ...(direction === 'RECEIVABLE' ? { patientId: p.id } : {}), ...extra });
    if (!r.ok) throw new Error(r.message);
    return r.data.ids[0];
  };
  const baixa = (titleId: string, kind: Parameters<typeof methodId>[1], amountCents: number, paidOn: string, extra: object = {}) =>
    db.$transaction((tx) => settleTitleTx(tx, { ...env, today: '2026-11-30' as never }, { titleId, lines: [{ methodId: methodId(t.id, kind), amountCents, paidOn: paidOn as never }], ...extra }));

  afterAll(async () => {
    const w = { tenantId: t.id };
    await prisma.cardReceivable.deleteMany({ where: w });
    await prisma.financialTransaction.deleteMany({ where: { ...w, reversalOfId: { not: null } } });
    await prisma.financialTransaction.deleteMany({ where: w });
    await prisma.financialTitle.deleteMany({ where: w });
    await prisma.payment.deleteMany({ where: w });
    await prisma.finPaymentMethodFee.deleteMany({ where: w });
    await prisma.finPaymentMethod.deleteMany({ where: w });
    await prisma.financialCategory.deleteMany({ where: { ...w, parentId: { not: null } } });
    await prisma.financialCategory.deleteMany({ where: w });
    await prisma.financialAccount.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: w });
    await prisma.patient.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.tenant.deleteMany({ where: { id: t.id } });
  });

  // Novembro: receita de 1.000 (paga 900 com 100 de desconto), aluguel de 400 (pago), energia de 150 (em aberto).
  // Dezembro: receita de 500 em aberto.
  const r1 = await conta('RECEIVABLE', 'procedimentos_particulares', 100000, '2026-11-10');
  const aluguel = await conta('PAYABLE', 'aluguel', 40000, '2026-11-05');
  await conta('PAYABLE', 'energia', 15000, '2026-11-25');
  await conta('RECEIVABLE', 'procedimentos_particulares', 50000, '2026-12-10');
  await baixa(r1, 'PIX', 90000, '2026-11-10', { discountCents: 10000 });
  await baixa(aluguel, 'PIX', 40000, '2026-11-05');

  it('DRE de novembro bate com as categorias: receita, desconto e despesa administrativa', async () => {
    const d = await reports.dre(ctx, '2026-11-01' as never, '2026-11-30' as never);
    const v = (id: string) => d.rows.find((r) => r.id === id)!.value;
    expect(v('RECEITA_BRUTA')).toBe(100000);
    expect(v('DEDUCOES_RECEITA')).toBe(-10000);
    expect(v('RECEITA_LIQUIDA')).toBe(90000);
    // Aluguel (pago) + energia (em aberto): competência, não caixa.
    expect(v('DESPESAS_ADMINISTRATIVAS')).toBe(-55000);
    expect(v('RESULTADO_LIQUIDO')).toBe(35000);
    // Outubro não tem nada: sem variação.
    expect(d.rows.find((r) => r.id === 'RECEITA_BRUTA')!.variation).toBeNull();
    const lancamentos = await reports.dreEntries(ctx, '2026-11-01' as never, '2026-11-30' as never, 'DESPESAS_ADMINISTRATIVAS');
    expect(lancamentos.map((l) => l.cents).sort((a, b) => a - b)).toEqual([15000, 40000]);
  });

  it('fluxo de caixa bate com os movimentos: realizado + previsto e saldo', async () => {
    const f = await reports.cashFlow(ctx, '2026-11-01' as never, '2026-12-31' as never);
    const realEntradas = f.realized.filter((l) => l.direction === 'IN').reduce((s, l) => s + l.total, 0);
    const realSaidas = f.realized.filter((l) => l.direction === 'OUT').reduce((s, l) => s + l.total, 0);
    expect(realEntradas).toBe(90000);
    expect(realSaidas).toBe(40000);
    const prevEntradas = f.forecast.filter((l) => l.direction === 'IN').reduce((s, l) => s + l.total, 0);
    const prevSaidas = f.forecast.filter((l) => l.direction === 'OUT').reduce((s, l) => s + l.total, 0);
    expect(prevEntradas).toBe(50000);
    expect(prevSaidas).toBe(15000);
    expect(f.opening).toBe(0);
    expect(f.closing[f.closing.length - 1]).toBe(90000 - 40000 + 50000 - 15000);
    // Estorno some do realizado (o movimento original fica marcado e o estorno entra como saída).
    const mov = await db.financialTransaction.findFirst({ where: { titleId: aluguel, kind: 'PAYMENT' } });
    await db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: t.id, userId: dono.id, today: '2026-11-30' as never }, { transactionId: mov!.id, reason: 'Teste' }));
    const f2 = await reports.cashFlow(ctx, '2026-11-01' as never, '2026-12-31' as never);
    expect(f2.closing[f2.closing.length - 1]).toBe(90000 - 40000 + 40000 + 50000 - 15000 - 40000);
  });

  it('visão geral: saldo das contas, vencidas e inadimplência', async () => {
    const o = await reports.overview(ctx, '2026-11-01' as never, '2026-11-30' as never, '2026-11-30' as never);
    expect(o.revenue.period).toBe(90000);
    expect(o.accounts.find((a) => a.id === defaultAccountId(t.id))).toBeTruthy();
    expect(o.accountsTotal).toBe(90000);
    expect(o.expense.overdue).toBe(15000 + 40000);
    const a = await reports.aging(ctx, '2026-12-31' as never);
    // Em 31/12, a receita de dezembro (vencida em 10/12) está entre 1 e 30 dias de atraso.
    expect(a.total).toBe(50000);
    expect(a.totals['1-30']).toBe(50000);
    expect(a.rows[0]).toMatchObject({ name: 'Paciente Relatório', titles: 1, maxDaysLate: 21 });
    expect(a.rows[0].whatsapp).toBeTruthy();
  });
});
