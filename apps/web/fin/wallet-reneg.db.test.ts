import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('financeiro: carteira, renegociação e transferências (banco)', async () => {
  const { prisma, getTenantClient, encrypt } = await import('@clinicaiq/db');
  const { setupFinance, methodId, categoryId, defaultAccountId } = await import('./setup');
  const { createTitles } = await import('./titles');
  const { settleTitleTx } = await import('./settle');
  const { reverseTransactionTx } = await import('./reverse');
  const wallet = await import('./wallet');
  const reneg = await import('./renegotiation');
  const transfers = await import('./transfers');
  const { DEFAULT_FINANCE_SETTINGS } = await import('../lib/financeiro/settings');
  const { toCents } = await import('../lib/financeiro/money');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const HOJE = '2026-11-17' as never;
  const chave = process.env.ENCRYPTION_MASTER_KEY!;

  const novaClinica = async (nome: string) => {
    const t = await prisma.tenant.create({ data: { clerkOrgId: `wr_${nome}_${suffix}`, name: `Carteira ${nome}`, slug: `wr-${nome}-${suffix}` } });
    await setupFinance(t.id);
    const dono = await prisma.user.create({ data: { tenantId: t.id, clerkUserId: `wr_dono_${nome}_${suffix}`, name: 'Dono', email: `wr-dono-${nome}-${suffix}@teste.local`, role: 'OWNER' } });
    const rec = await prisma.user.create({ data: { tenantId: t.id, clerkUserId: `wr_rec_${nome}_${suffix}`, name: 'Recepção', email: `wr-rec-${nome}-${suffix}@teste.local`, role: 'RECEPTIONIST' } });
    const banco = await prisma.financialAccount.create({ data: { tenantId: t.id, name: 'Banco', kind: 'BANK', openingDate: new Date('2026-11-01T00:00:00Z') } });
    let n = 0;
    const paciente = (name: string) => prisma.patient.create({ data: { tenantId: t.id, controlNumber: ++n, name, phoneEncrypted: encrypt(`1199999${String(1000 + n)}`, chave, t.id) } });
    return { id: t.id, db: getTenantClient(t.id), dono, rec, banco, paciente };
  };
  const A = await novaClinica('a');
  const B = await novaClinica('b');
  type C = typeof A;

  const env = (c: C, role: 'OWNER' | 'RECEPTIONIST' = 'OWNER', settings = {}) => ({
    tenantId: c.id,
    userId: role === 'OWNER' ? c.dono.id : c.rec.id,
    access: { role },
    settings: { ...DEFAULT_FINANCE_SETTINGS, requireOpenCashForCash: false, ...settings },
    today: HOJE,
  });
  const saldo = async (c: C, patientId: string) => toCents((await c.db.walletEntry.aggregate({ where: { patientId }, _sum: { amount: true } }))._sum.amount);
  const saldoConta = async (c: C, accountId: string) => toCents((await c.db.financialTransaction.aggregate({ where: { accountId }, _sum: { signedAmount: true } }))._sum.signedAmount);
  const titulo = async (c: C, amountCents: number, patientId: string, dueDate = HOJE as string, extra: object = {}) => {
    const r = await createTitles({ tenantId: c.id, userId: c.dono.id, db: c.db }, { direction: 'RECEIVABLE', categoryId: categoryId(c.id, 'procedimentos_particulares'), issueDate: dueDate as never, dueDate: dueDate as never, amountCents, patientId, ...extra });
    if (!r.ok) throw new Error(r.message);
    return r.data.ids;
  };
  const receber = (c: C, titleId: string, kind: Parameters<typeof methodId>[1], amountCents: number) =>
    c.db.$transaction((tx) => settleTitleTx(tx, env(c), { titleId, lines: [{ methodId: methodId(c.id, kind), amountCents, paidOn: HOJE }] }));
  const estornar = (c: C, transactionId: string, extra: object = {}) => c.db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: c.id, userId: c.dono.id, today: HOJE }, { transactionId, reason: 'Estorno do teste', ...extra }));

  afterAll(async () => {
    for (const id of [A.id, B.id]) {
      const t = { tenantId: id };
      await prisma.renegotiationTitle.deleteMany({ where: t });
      await prisma.renegotiation.deleteMany({ where: t });
      await prisma.walletEntry.deleteMany({ where: t });
      await prisma.cardReceivable.deleteMany({ where: t });
      await prisma.financialTransaction.deleteMany({ where: { ...t, reversalOfId: { not: null } } });
      await prisma.financialTransaction.deleteMany({ where: t });
      await prisma.financialTitle.deleteMany({ where: t });
      await prisma.payment.deleteMany({ where: t });
      await prisma.finPaymentMethodFee.deleteMany({ where: t });
      await prisma.finPaymentMethod.deleteMany({ where: t });
      await prisma.financialCategory.deleteMany({ where: { ...t, parentId: { not: null } } });
      await prisma.financialCategory.deleteMany({ where: t });
      await prisma.financialAccount.deleteMany({ where: t });
      await prisma.auditLog.deleteMany({ where: t });
      await prisma.patient.deleteMany({ where: t });
      await prisma.user.deleteMany({ where: t });
      await prisma.tenant.deleteMany({ where: { id } });
    }
  });

  it('adicionar crédito entra dinheiro na conta e na carteira; usar paga conta sem mexer na conta; devolver não passa do saldo', async () => {
    const p = await A.paciente('Carteira');
    const r = await A.db.$transaction((tx) => wallet.addCreditTx(tx, env(A), { patientId: p.id, amountCents: 50000, methodId: methodId(A.id, 'PIX'), paidOn: HOJE }));
    expect(r.ok).toBe(true);
    expect(await saldo(A, p.id)).toBe(50000);
    const conta = await A.db.financialTransaction.findFirst({ where: { id: r.ok ? r.transactionId : '' } });
    expect(conta).toMatchObject({ kind: 'RECEIPT', origin: 'WALLET', patientId: p.id });
    expect(toCents(conta!.signedAmount)).toBe(50000);

    const [t] = await titulo(A, 30000, p.id);
    const usou = await receber(A, t, 'WALLET', 30000);
    expect(usou).toMatchObject({ ok: true, titleStatus: 'PAID' });
    expect(await saldo(A, p.id)).toBe(20000);

    // Usado o crédito, estornar o adiantamento inteiro deixaria a carteira negativa.
    if (r.ok) expect((await estornar(A, r.transactionId)).ok).toBe(false);

    expect((await A.db.$transaction((tx) => wallet.refundCreditTx(tx, env(A), { patientId: p.id, amountCents: 20001, methodId: methodId(A.id, 'PIX'), paidOn: HOJE }))).ok).toBe(false);
    const dev = await A.db.$transaction((tx) => wallet.refundCreditTx(tx, env(A), { patientId: p.id, amountCents: 20000, methodId: methodId(A.id, 'PIX'), paidOn: HOJE }));
    expect(dev.ok).toBe(true);
    expect(await saldo(A, p.id)).toBe(0);

    const lista = await wallet.walletList(A.db, 'all');
    expect(lista.find((x) => x.patientId === p.id)).toMatchObject({ creditsCents: 50000, debitsCents: 50000, balanceCents: 0 });
    expect((await wallet.walletList(A.db, 'with')).some((x) => x.patientId === p.id)).toBe(false);
    const extrato = await wallet.walletStatement(A.db, p.id);
    expect(extrato.lines.map((l) => l.reason).sort()).toEqual(['ADVANCE', 'REFUND', 'USE']);
    // Outra clínica não vê nada.
    expect(await wallet.walletList(B.db, 'all')).toHaveLength(0);
  });

  it('crédito em dinheiro pede o caixa aberto, como no recebimento', async () => {
    const p = await A.paciente('Dinheiro');
    const r = await A.db.$transaction((tx) => wallet.addCreditTx(tx, env(A, 'OWNER', { requireOpenCashForCash: true }), { patientId: p.id, amountCents: 1000, methodId: methodId(A.id, 'CASH'), paidOn: HOJE }));
    expect(r).toMatchObject({ ok: false, code: 'CASH_CLOSED' });
  });

  it('transferência: sai de uma conta, entra na outra; o estorno desfaz as duas pontas', async () => {
    const caixa = defaultAccountId(A.id);
    const antes = { caixa: await saldoConta(A, caixa), banco: await saldoConta(A, A.banco.id) };
    const r = await A.db.$transaction((tx) => transfers.transferTx(tx, env(A), { fromAccountId: caixa, toAccountId: A.banco.id, amountCents: 12345, date: HOJE }));
    expect(r.ok).toBe(true);
    expect(await saldoConta(A, caixa)).toBe(antes.caixa - 12345);
    expect(await saldoConta(A, A.banco.id)).toBe(antes.banco + 12345);
    expect((await A.db.$transaction((tx) => transfers.transferTx(tx, env(A), { fromAccountId: caixa, toAccountId: caixa, amountCents: 1, date: HOJE }))).ok).toBe(false);
    expect((await B.db.$transaction((tx) => transfers.transferTx(tx, env(B), { fromAccountId: caixa, toAccountId: A.banco.id, amountCents: 1, date: HOJE }))).ok).toBe(false);

    const lista = await transfers.transferList(A.db, HOJE, HOJE);
    const linha = lista.find((l) => r.ok && l.transferId === r.transferId)!;
    expect(linha).toMatchObject({ amountCents: 12345, toName: 'Banco', reversed: false });
    // Pela tela de movimentações não estorna; pela de transferências, sim.
    expect((await estornar(A, linha.outId)).ok).toBe(false);
    expect((await estornar(A, linha.outId, { transfer: true })).ok).toBe(true);
    expect(await saldoConta(A, caixa)).toBe(antes.caixa);
    expect(await saldoConta(A, A.banco.id)).toBe(antes.banco);
  });

  it('renegociação: corrige as vencidas, desconto, entrada paga na hora, parcelas novas; antigas viram RENEGOCIADO', async () => {
    const p = await A.paciente('Renegocia');
    const [v1] = await titulo(A, 50000, p.id, '2026-11-07');
    const [v2] = await titulo(A, 30000, p.id, '2026-12-01');
    const settings = { lateChargesEnabled: true, finePercent: 2, dailyInterestPercent: 0.033 };
    const corrigidas = await reneg.correctedFor(A.db, env(A, 'OWNER', settings), [v1, v2]);
    expect(corrigidas.reduce((s, t) => s + t.corrected, 0)).toBe(51165 + 30000);

    const r = await A.db.$transaction((tx) =>
      reneg.renegotiateTx(tx, env(A, 'OWNER', settings), { titleIds: [v1, v2], discountCents: 1165, downPaymentCents: 20000, downPaymentDate: HOJE, downPaymentMethodId: methodId(A.id, 'PIX'), installments: 3, interval: { kind: 'monthly' }, firstDueDate: '2026-12-17' as never }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.receiptGroupId).toBeTruthy();
    const antigas = await A.db.financialTitle.findMany({ where: { id: { in: [v1, v2] } } });
    expect(antigas.every((t) => t.status === 'RENEGOTIATED')).toBe(true);
    const novas = await A.db.financialTitle.findMany({ where: { id: { in: r.newTitleIds } }, orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }] });
    // 81.165 − 1.165 = 80.000: entrada de 200 (paga) e 3 parcelas de 200.
    expect(novas.map((t) => toCents(t.amount))).toEqual([20000, 20000, 20000, 20000]);
    expect(novas[0].status).toBe('PAID');
    expect(novas.every((t) => t.origin === 'RENEGOTIATION' && t.renegotiationId === r.renegotiationId)).toBe(true);
    // Uma conta já renegociada não entra em outra renegociação, e não se recebe direto.
    expect((await A.db.$transaction((tx) => reneg.renegotiateTx(tx, env(A), { titleIds: [v1], discountCents: 0, downPaymentCents: 0, installments: 1, interval: { kind: 'monthly' }, firstDueDate: HOJE }))).ok).toBe(false);
    expect((await receber(A, v1, 'PIX', 100)).ok).toBe(false);

    // Com a entrada paga, não desfaz.
    expect((await A.db.$transaction((tx) => reneg.undoRenegotiationTx(tx, env(A), r.renegotiationId))).ok).toBe(false);
    const lista = await reneg.renegotiationList(A.db);
    expect(lista.find((x) => x.id === r.renegotiationId)).toMatchObject({ canUndo: false, newPaidCents: 20000, newOpenCents: 60000, correctedCents: 81165, discountCents: 1165 });
  });

  it('desfazer: sem pagamento nas novas, as antigas voltam como estavam', async () => {
    const p = await A.paciente('Desfaz');
    const [t1] = await titulo(A, 40000, p.id);
    await receber(A, t1, 'PIX', 10000);
    const r = await A.db.$transaction((tx) => reneg.renegotiateTx(tx, env(A), { titleIds: [t1], discountCents: 0, downPaymentCents: 0, installments: 2, interval: { kind: 'monthly' }, firstDueDate: '2026-12-17' as never }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Só o que faltava (300) foi renegociado.
    expect((await A.db.financialTitle.findMany({ where: { id: { in: r.newTitleIds } } })).map((t) => toCents(t.amount)).sort()).toEqual([15000, 15000]);
    expect((await A.db.$transaction((tx) => reneg.undoRenegotiationTx(tx, env(A), r.renegotiationId))).ok).toBe(true);
    expect((await A.db.financialTitle.findFirst({ where: { id: t1 } }))?.status).toBe('PARTIAL');
    expect((await A.db.financialTitle.findMany({ where: { id: { in: r.newTitleIds } } })).every((t) => t.status === 'CANCELLED')).toBe(true);
    expect((await A.db.$transaction((tx) => reneg.undoRenegotiationTx(tx, env(A), r.renegotiationId))).ok).toBe(false);
  });

  it('regras: um cliente por vez, desconto no limite da recepção, juros e multa só com dono', async () => {
    const p1 = await A.paciente('Um');
    const p2 = await A.paciente('Outro');
    const [a] = await titulo(A, 10000, p1.id, '2026-11-01');
    const [b] = await titulo(A, 10000, p2.id);
    const base = { downPaymentCents: 0, installments: 1, interval: { kind: 'monthly' as const }, firstDueDate: '2026-12-17' as never };
    expect((await A.db.$transaction((tx) => reneg.renegotiateTx(tx, env(A), { ...base, titleIds: [a, b], discountCents: 0 }))).ok).toBe(false);
    const settings = { lateChargesEnabled: true, defaultMaxDiscountPercent: 5 };
    // Recepção: 6% de desconto passa do limite de 5%.
    expect((await A.db.$transaction((tx) => reneg.renegotiateTx(tx, env(A, 'RECEPTIONIST', settings), { ...base, titleIds: [a], discountCents: 700 }))).ok).toBe(false);
    expect((await A.db.$transaction((tx) => reneg.renegotiateTx(tx, env(A, 'RECEPTIONIST', settings), { ...base, titleIds: [a], discountCents: 0, chargeLate: false }))).ok).toBe(false);
    expect((await A.db.$transaction((tx) => reneg.renegotiateTx(tx, env(A, 'RECEPTIONIST', settings), { ...base, titleIds: [a], discountCents: 0, monthlyInterestPercent: 3 }))).ok).toBe(false);
    // A outra clínica não renegocia conta desta.
    expect((await B.db.$transaction((tx) => reneg.renegotiateTx(tx, env(B), { ...base, titleIds: [a], discountCents: 0 }))).ok).toBe(false);
    const ok = await A.db.$transaction((tx) => reneg.renegotiateTx(tx, env(A, 'RECEPTIONIST', settings), { ...base, titleIds: [a], discountCents: 0 }));
    expect(ok.ok).toBe(true);
  });
});
