import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('financeiro: caixa (banco)', async () => {
  const { prisma, getTenantClient, encrypt } = await import('@clinicaiq/db');
  const { setupFinance, methodId, categoryId, defaultAccountId } = await import('./setup');
  const { createTitles } = await import('./titles');
  const { settleTitleTx } = await import('./settle');
  const { reverseTransactionTx } = await import('./reverse');
  const { openCashTx, cashMoveTx, closeCashTx, expectedOf, openCashOf } = await import('./cash');
  const { DEFAULT_FINANCE_SETTINGS } = await import('../lib/financeiro/settings');
  const { ZERO_COUNT } = await import('../lib/financeiro/cash');
  const { toCents } = await import('../lib/financeiro/money');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const HOJE = '2026-11-16';
  const chave = process.env.ENCRYPTION_MASTER_KEY!;

  const novaClinica = async (nome: string) => {
    const t = await prisma.tenant.create({ data: { clerkOrgId: `cx_${nome}_${suffix}`, name: `Caixa ${nome}`, slug: `cx-${nome}-${suffix}` } });
    await setupFinance(t.id);
    const pessoa = (papel: string, role: 'OWNER' | 'RECEPTIONIST') =>
      prisma.user.create({ data: { tenantId: t.id, clerkUserId: `cx_${papel}_${nome}_${suffix}`, name: papel, email: `cx-${papel}-${nome}-${suffix}@teste.local`, role } });
    const dono = await pessoa('dono', 'OWNER');
    const rec = await pessoa('rec', 'RECEPTIONIST');
    const rec2 = await pessoa('rec2', 'RECEPTIONIST');
    const banco = await prisma.financialAccount.create({ data: { tenantId: t.id, name: 'Banco', kind: 'BANK', openingDate: new Date(`${HOJE}T00:00:00Z`) } });
    let n = 0;
    const paciente = async (name: string) => prisma.patient.create({ data: { tenantId: t.id, controlNumber: ++n, name, phoneEncrypted: encrypt(`1199999${String(1000 + n)}`, chave, t.id) } });
    return { id: t.id, db: getTenantClient(t.id), dono, rec, rec2, banco, paciente };
  };
  const A = await novaClinica('a');
  const B = await novaClinica('b');
  type C = typeof A;

  const cx = (c: C, userId: string, manageOthers = false) => ({ tenantId: c.id, userId, unitId: null, today: HOJE as never, manageOthers });
  const abrir = (c: C, userId: string, openingCents = 0) => c.db.$transaction((tx) => openCashTx(tx, cx(c, userId), { openingCents }));
  const mover = (c: C, userId: string, input: Omit<Parameters<typeof cashMoveTx>[2], never>, gerente = false) => c.db.$transaction((tx) => cashMoveTx(tx, cx(c, userId, gerente), input));
  const fechar = (c: C, userId: string, input: Parameters<typeof closeCashTx>[2], opts: { blind?: boolean; gerente?: boolean } = {}) =>
    c.db.$transaction((tx) => closeCashTx(tx, cx(c, userId, opts.gerente), input, { blind: opts.blind ?? false }));
  const settleEnv = (c: C, userId: string, role: 'OWNER' | 'RECEPTIONIST' = 'RECEPTIONIST', settings = {}) => ({ tenantId: c.id, userId, access: { role }, settings: { ...DEFAULT_FINANCE_SETTINGS, ...settings }, today: HOJE as never });
  const titulo = async (c: C, amountCents: number, patientId?: string) => {
    const r = await createTitles({ tenantId: c.id, userId: c.dono.id, db: c.db }, { direction: 'RECEIVABLE', categoryId: categoryId(c.id, 'procedimentos_particulares'), issueDate: HOJE as never, dueDate: HOJE as never, amountCents, patientId });
    if (!r.ok) throw new Error(r.message);
    return r.data.ids[0];
  };
  const receber = (c: C, userId: string, titleId: string, kind: Parameters<typeof methodId>[1], amountCents: number, e = settleEnv(c, userId)) =>
    c.db.$transaction((tx) => settleTitleTx(tx, e, { titleId, lines: [{ methodId: methodId(c.id, kind), amountCents, paidOn: HOJE as never }] }));
  const esperado = async (c: C, sessionId: string) => {
    const s = await c.db.cashSession.findFirst({ where: { id: sessionId } });
    return expectedOf(c.db, c.id, s!);
  };
  const contado = (v: Partial<typeof ZERO_COUNT>) => ({ ...ZERO_COUNT, ...v });

  afterAll(async () => {
    for (const id of [A.id, B.id]) {
      const t = { tenantId: id };
      await prisma.cashSessionCount.deleteMany({ where: t });
      await prisma.walletEntry.deleteMany({ where: t });
      await prisma.cardReceivable.deleteMany({ where: t });
      await prisma.financialTransaction.deleteMany({ where: { ...t, reversalOfId: { not: null } } });
      await prisma.financialTransaction.deleteMany({ where: t });
      await prisma.cashSession.deleteMany({ where: t });
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

  it('dinheiro sem caixa aberto é recusado; PIX passa; com a regra desligada o dinheiro passa', async () => {
    const id = await titulo(A, 30000);
    const semCaixa = await receber(A, A.rec.id, id, 'CASH', 10000);
    expect(semCaixa).toMatchObject({ ok: false, code: 'CASH_CLOSED' });
    expect((await receber(A, A.rec.id, id, 'PIX', 10000)).ok).toBe(true);
    expect((await receber(A, A.rec.id, id, 'CASH', 10000, settleEnv(A, A.rec.id, 'RECEPTIONIST', { requireOpenCashForCash: false }))).ok).toBe(true);
    // Sem caixa aberto, nada disso entrou em sessão nenhuma.
    expect(await A.db.financialTransaction.count({ where: { cashSessionId: { not: null } } })).toBe(0);
  });

  it('um caixa aberto por pessoa; cada pessoa tem o seu; clínicas não se enxergam', async () => {
    const a = await abrir(A, A.rec.id, 10000);
    expect(a.ok).toBe(true);
    const de_novo = await abrir(A, A.rec.id);
    expect(de_novo).toMatchObject({ ok: false, code: 'ALREADY_OPEN' });
    expect((await abrir(A, A.rec2.id)).ok).toBe(true);
    const b = await abrir(B, B.rec.id, 5000);
    expect(b.ok).toBe(true);
    // Números próprios de cada clínica, e a sessão de uma não aparece na outra.
    if (a.ok && b.ok) {
      expect(b.code).toBe(1);
      expect(await B.db.cashSession.findFirst({ where: { id: a.id } })).toBeNull();
      expect(await openCashOf(A.db, A.id, B.rec.id)).toBeNull();
    }
    expect((await abrir(A, A.dono.id, -1)).ok).toBe(false);
  });

  it('recebimentos entram no caixa de quem recebeu; reforço e sangria mexem só no dinheiro', async () => {
    const meu = (await openCashOf(A.db, A.id, A.rec.id))!;
    const t1 = await titulo(A, 50000);
    expect((await receber(A, A.rec.id, t1, 'CASH', 20000)).ok).toBe(true);
    expect((await receber(A, A.rec.id, t1, 'PIX', 30000)).ok).toBe(true);
    // A outra recepcionista recebe no caixa dela.
    const t2 = await titulo(A, 7000);
    expect((await receber(A, A.rec2.id, t2, 'CASH', 7000)).ok).toBe(true);

    expect((await mover(A, A.rec.id, { sessionId: meu.id, kind: 'REINFORCEMENT', amountCents: 5000 })).ok).toBe(true);
    const saldoBanco = async () => toCents((await A.db.financialTransaction.aggregate({ where: { accountId: A.banco.id }, _sum: { signedAmount: true } }))._sum.signedAmount);
    // Sangria para o banco vira transferência: sai do caixa, entra no banco.
    expect((await mover(A, A.rec.id, { sessionId: meu.id, kind: 'WITHDRAWAL', amountCents: 15000, otherAccountId: A.banco.id })).ok).toBe(true);
    expect(await saldoBanco()).toBe(15000);
    // Não tira mais dinheiro do que tem (10.000 + 20.000 + 5.000 − 15.000 = 20.000).
    expect((await mover(A, A.rec.id, { sessionId: meu.id, kind: 'WITHDRAWAL', amountCents: 20001 })).ok).toBe(false);
    // Caixa de outra pessoa: só quem gerencia.
    expect((await mover(A, A.rec2.id, { sessionId: meu.id, kind: 'REINFORCEMENT', amountCents: 100 })).ok).toBe(false);
    expect((await mover(A, A.dono.id, { sessionId: meu.id, kind: 'REINFORCEMENT', amountCents: 100 }, true)).ok).toBe(true);

    expect(await esperado(A, meu.id)).toEqual({ CASH: 20100, PIX: 30000, CREDIT_CARD: 0, DEBIT_CARD: 0, OTHER: 0 });
    const dela = (await openCashOf(A.db, A.id, A.rec2.id))!;
    expect((await esperado(A, dela.id)).CASH).toBe(7000);
  });

  it('estornar a sangria desfaz as duas pontas da transferência', async () => {
    const meu = (await openCashOf(A.db, A.id, A.rec.id))!;
    const r = await mover(A, A.rec.id, { sessionId: meu.id, kind: 'WITHDRAWAL', amountCents: 1000, otherAccountId: A.banco.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const antes = await esperado(A, meu.id);
    const e = await A.db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: A.id, userId: A.dono.id, today: HOJE as never }, { transactionId: r.transactionId, reason: 'Sangria lançada errada' }));
    expect(e.ok).toBe(true);
    // O dinheiro volta para a mesma gaveta (o caixa original ainda está aberto) e sai do banco.
    expect((await esperado(A, meu.id)).CASH).toBe(antes.CASH + 1000);
    expect(toCents((await A.db.financialTransaction.aggregate({ where: { accountId: A.banco.id }, _sum: { signedAmount: true } }))._sum.signedAmount)).toBe(15000);
  });

  it('fechar: diferença pede justificativa; caixa de outro só para quem gerencia; fechado não muda mais', async () => {
    const meu = (await openCashOf(A.db, A.id, A.rec.id))!;
    const certo = await esperado(A, meu.id);
    // A colega não fecha o meu caixa.
    expect((await fechar(A, A.rec2.id, { sessionId: meu.id, counted: certo })).ok).toBe(false);
    // Faltaram R$ 10: sem justificativa não fecha.
    const falta = contado({ ...certo, CASH: certo.CASH - 1000 });
    const sem = await fechar(A, A.rec.id, { sessionId: meu.id, counted: falta });
    expect(sem).toMatchObject({ ok: false, code: 'NEEDS_JUSTIFICATION' });
    expect((await A.db.cashSession.findFirst({ where: { id: meu.id } }))?.status).toBe('OPEN');
    const com = await fechar(A, A.rec.id, { sessionId: meu.id, counted: falta, justification: 'Troco dado a mais para um paciente' });
    expect(com).toMatchObject({ ok: true, difference: -1000 });
    const fechado = await A.db.cashSession.findFirst({ where: { id: meu.id }, include: { counts: true } });
    expect(fechado).toMatchObject({ status: 'CLOSED', closedById: A.rec.id, blind: false, closingNote: 'Troco dado a mais para um paciente' });
    expect(toCents(fechado!.difference!)).toBe(-1000);
    expect(fechado!.counts).toHaveLength(5);
    expect(fechado!.counts.find((c) => c.methodKind === 'CASH')?.justification).toBeTruthy();
    expect(fechado!.counts.find((c) => c.methodKind === 'PIX')?.justification).toBeNull();

    // Fechado: não aceita movimento nem fecha de novo.
    expect((await mover(A, A.rec.id, { sessionId: meu.id, kind: 'REINFORCEMENT', amountCents: 100 })).ok).toBe(false);
    expect((await fechar(A, A.rec.id, { sessionId: meu.id, counted: certo })).ok).toBe(false);
    // E o dinheiro volta a exigir caixa aberto.
    const t = await titulo(A, 1000);
    expect(await receber(A, A.rec.id, t, 'CASH', 1000)).toMatchObject({ ok: false, code: 'CASH_CLOSED' });
  });

  it('estorno de recebimento de caixa já fechado não altera o caixa fechado', async () => {
    const fechado = await A.db.cashSession.findFirst({ where: { userId: A.rec.id, status: 'CLOSED' }, include: { counts: true } });
    const antes = await esperado(A, fechado!.id);
    const recebido = await A.db.financialTransaction.findFirst({ where: { cashSessionId: fechado!.id, kind: 'RECEIPT', methodKind: 'CASH' } });
    // O dono estorna sem caixa aberto: o estorno não entra em caixa nenhum.
    const e1 = await A.db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: A.id, userId: A.dono.id, today: HOJE as never }, { transactionId: recebido!.id, reason: 'Paciente desistiu' }));
    expect(e1.ok).toBe(true);
    expect(await esperado(A, fechado!.id)).toEqual(antes);
    const estorno = await A.db.financialTransaction.findFirst({ where: { reversalOfId: recebido!.id } });
    expect(estorno?.cashSessionId).toBeNull();

    // Com o caixa do dono aberto, o estorno do PIX entra no caixa dele (e não no fechado).
    const doDono = await abrir(A, A.dono.id);
    expect(doDono.ok).toBe(true);
    const pix = await A.db.financialTransaction.findFirst({ where: { cashSessionId: fechado!.id, kind: 'RECEIPT', methodKind: 'PIX' } });
    const e2 = await A.db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: A.id, userId: A.dono.id, today: HOJE as never }, { transactionId: pix!.id, reason: 'PIX devolvido' }));
    expect(e2.ok).toBe(true);
    expect(await esperado(A, fechado!.id)).toEqual(antes);
    if (doDono.ok) expect((await esperado(A, doDono.id)).PIX).toBe(-30000);
  });

  it('não fecha com o dinheiro negativo', async () => {
    const doDono = (await openCashOf(A.db, A.id, A.dono.id))!;
    // Paga uma conta em dinheiro com a gaveta vazia: o dinheiro fica negativo.
    const conta = await createTitles({ tenantId: A.id, userId: A.dono.id, db: A.db }, { direction: 'PAYABLE', categoryId: categoryId(A.id, 'energia'), issueDate: HOJE as never, dueDate: HOJE as never, amountCents: 2000 });
    if (!conta.ok) throw new Error(conta.message);
    const pago = await A.db.$transaction((tx) => settleTitleTx(tx, settleEnv(A, A.dono.id, 'OWNER'), { titleId: conta.data.ids[0], lines: [{ methodId: methodId(A.id, 'CASH'), amountCents: 2000, paidOn: HOJE as never }] }));
    expect(pago.ok).toBe(true);
    expect((await esperado(A, doDono.id)).CASH).toBe(-2000);
    const r = await fechar(A, A.dono.id, { sessionId: doDono.id, counted: contado({}), justification: 'Qualquer justificativa aqui' });
    expect(r).toMatchObject({ ok: false, code: 'NEGATIVE_CASH' });
    // Com o reforço do que faltou, fecha.
    expect((await mover(A, A.dono.id, { sessionId: doDono.id, kind: 'REINFORCEMENT', amountCents: 2000 })).ok).toBe(true);
    const ok = await fechar(A, A.dono.id, { sessionId: doDono.id, counted: contado({ PIX: 0 }), justification: 'PIX devolvido ao paciente pelo banco' });
    expect(ok.ok).toBe(true);
  });

  it('conferência cega: a primeira contagem fica valendo; depois só entra a justificativa', async () => {
    const dela = (await openCashOf(A.db, A.id, A.rec2.id))!;
    // Ela contou R$ 60, o sistema espera R$ 70.
    const r1 = await fechar(A, A.rec2.id, { sessionId: dela.id, counted: contado({ CASH: 6000 }) }, { blind: true });
    expect(r1).toMatchObject({ ok: false, code: 'NEEDS_JUSTIFICATION' });
    expect(await A.db.cashSessionCount.count({ where: { sessionId: dela.id } })).toBe(5);
    // Agora que viu o esperado, tentar "corrigir" o contado não adianta: vale a primeira contagem.
    const r2 = await fechar(A, A.rec2.id, { sessionId: dela.id, counted: contado({ CASH: 7000 }) }, { blind: true });
    expect(r2).toMatchObject({ ok: false, code: 'NEEDS_JUSTIFICATION' });
    const r3 = await fechar(A, A.rec2.id, { sessionId: dela.id, counted: contado({ CASH: 7000 }), justification: 'Faltou uma nota de dez no caixa' }, { blind: true });
    expect(r3).toMatchObject({ ok: true, difference: -1000 });
    const s = await A.db.cashSession.findFirst({ where: { id: dela.id }, include: { counts: true } });
    expect(s).toMatchObject({ status: 'CLOSED', blind: true });
    expect(toCents(s!.counts.find((c) => c.methodKind === 'CASH')!.counted)).toBe(6000);
  });

  it('dono fecha o caixa de outra pessoa e fica registrado na auditoria', async () => {
    const novo = await abrir(A, A.rec.id, 3000);
    expect(novo.ok).toBe(true);
    if (!novo.ok) return;
    const r = await fechar(A, A.dono.id, { sessionId: novo.id, counted: contado({ CASH: 3000 }) }, { gerente: true });
    expect(r.ok).toBe(true);
    const log = await prisma.auditLog.findFirst({ where: { tenantId: A.id, entity: 'CashSession', entityId: novo.id, action: 'CLOSE' } });
    expect(log?.userId).toBe(A.dono.id);
    expect((log?.metadata as { caixaDe?: string }).caixaDe).toBe(A.rec.id);
    expect(defaultAccountId(A.id)).toBeTruthy();
  });
});
