import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('financeiro: títulos, recebimento e estorno (banco)', async () => {
  const { prisma, getTenantClient, encrypt } = await import('@clinicaiq/db');
  const { setupFinance, methodId, categoryId, defaultAccountId } = await import('./setup');
  const { createTitles, createRecurrence, extendRecurrences, updateTitle, cancelTitle } = await import('./titles');
  const { settleTitleTx } = await import('./settle');
  const { reverseTransactionTx } = await import('./reverse');
  const { openCashTx } = await import('./cash');
  const { migrateLegacy, legacyPending, syncQuoteTitlesTx, cancelQuoteTitlesTx, receiveInOrderTx } = await import('./quotes');
  const { DEFAULT_FINANCE_SETTINGS } = await import('../lib/financeiro/settings');
  const { toCents } = await import('../lib/financeiro/money');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const HOJE = '2026-11-16';
  const chave = process.env.ENCRYPTION_MASTER_KEY!;

  const novaClinica = async (nome: string) => {
    const t = await prisma.tenant.create({ data: { clerkOrgId: `eng_${nome}_${suffix}`, name: `Motor ${nome}`, slug: `eng-${nome}-${suffix}` } });
    await setupFinance(t.id);
    const dono = await prisma.user.create({ data: { tenantId: t.id, clerkUserId: `eng_dono_${nome}_${suffix}`, name: 'Dono', email: `eng-dono-${nome}-${suffix}@teste.local`, role: 'OWNER' } });
    const rec = await prisma.user.create({ data: { tenantId: t.id, clerkUserId: `eng_rec_${nome}_${suffix}`, name: 'Recepção', email: `eng-rec-${nome}-${suffix}@teste.local`, role: 'RECEPTIONIST' } });
    let n = 0;
    const paciente = async (name: string) =>
      prisma.patient.create({ data: { tenantId: t.id, controlNumber: ++n, name, phoneEncrypted: encrypt(`1199999${String(1000 + n)}`, chave, t.id) } });
    return { id: t.id, db: getTenantClient(t.id), dono, rec, paciente };
  };
  const A = await novaClinica('a');
  const B = await novaClinica('b');
  // Dinheiro só entra com o caixa aberto: o dono da clínica A trabalha com o dele aberto.
  await A.db.$transaction((tx) => openCashTx(tx, { tenantId: A.id, userId: A.dono.id, unitId: null, today: '2026-11-16', manageOthers: true }, { openingCents: 0 }));

  const env = (c: typeof A, role: 'OWNER' | 'RECEPTIONIST' = 'OWNER', settings = {}) => ({
    tenantId: c.id,
    userId: role === 'OWNER' ? c.dono.id : c.rec.id,
    access: { role },
    settings: { ...DEFAULT_FINANCE_SETTINGS, ...settings },
    today: HOJE,
  });
  const actor = (c: typeof A) => ({ tenantId: c.id, userId: c.dono.id, db: c.db });
  const forma = (c: typeof A, kind: Parameters<typeof methodId>[1]) => methodId(c.id, kind);
  const titulo = async (c: typeof A, amountCents: number, extra: object = {}) => {
    const r = await createTitles(actor(c), { direction: 'RECEIVABLE', categoryId: categoryId(c.id, 'procedimentos_particulares'), issueDate: HOJE, dueDate: HOJE, amountCents, ...extra });
    if (!r.ok) throw new Error(r.message);
    return r.data.ids;
  };
  const receber = (c: typeof A, input: Parameters<typeof settleTitleTx>[2], e = env(c)) => c.db.$transaction((tx) => settleTitleTx(tx, e, input));
  const estornar = (c: typeof A, input: Parameters<typeof reverseTransactionTx>[2]) => c.db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: c.id, userId: c.dono.id, today: HOJE }, input));
  const ler = (c: typeof A, id: string) => c.db.financialTitle.findFirst({ where: { id } });
  const linha = (c: typeof A, kind: Parameters<typeof methodId>[1], amountCents: number, extra: object = {}) => ({ methodId: forma(c, kind), amountCents, paidOn: HOJE, ...extra });

  afterAll(async () => {
    for (const id of [A.id, B.id]) {
      const t = { tenantId: id };
      await prisma.financialRelease.deleteMany({ where: t });
      await prisma.walletEntry.deleteMany({ where: t });
      await prisma.cardReceivable.deleteMany({ where: t });
      await prisma.financialTransaction.deleteMany({ where: { ...t, reversalOfId: { not: null } } });
      await prisma.financialTransaction.deleteMany({ where: t });
      await prisma.cashSession.deleteMany({ where: t });
      await prisma.financialTitleAllocation.deleteMany({ where: t });
      await prisma.financialTitle.deleteMany({ where: t });
      await prisma.recurrenceRule.deleteMany({ where: t });
      await prisma.payment.deleteMany({ where: t });
      await prisma.quoteItem.deleteMany({ where: { quote: t } });
      await prisma.quote.deleteMany({ where: t });
      await prisma.finPaymentMethodFee.deleteMany({ where: t });
      await prisma.finPaymentMethod.deleteMany({ where: t });
      await prisma.costCenter.deleteMany({ where: t });
      await prisma.financialCategory.deleteMany({ where: { ...t, parentId: { not: null } } });
      await prisma.financialCategory.deleteMany({ where: t });
      await prisma.financialAccount.deleteMany({ where: t });
      await prisma.auditLog.deleteMany({ where: t });
      await prisma.patient.deleteMany({ where: t });
      await prisma.user.deleteMany({ where: t });
      await prisma.tenant.deleteMany({ where: { id } });
    }
  });

  it('parcela R$ 1.000 em 3x com os centavos na última e numeração seguida', async () => {
    const p = await A.paciente('Parcelado');
    const ids = await titulo(A, 100000, { patientId: p.id, installments: 3 });
    const ts = await A.db.financialTitle.findMany({ where: { id: { in: ids } }, orderBy: { installmentNumber: 'asc' } });
    expect(ts.map((t) => toCents(t.amount))).toEqual([33333, 33333, 33334]);
    expect(ts.map((t) => t.dueDate.toISOString().slice(0, 10))).toEqual(['2026-11-16', '2026-12-16', '2027-01-16']);
    expect(ts.map((t) => t.competence)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(ts[1].code).toBe(ts[0].code + 1);
    expect(new Set(ts.map((t) => t.groupId)).size).toBe(1);
  });

  it('rateio tem de bater com o valor', async () => {
    const admin = categoryId(A.id, 'aluguel');
    const base = { direction: 'PAYABLE' as const, categoryId: admin, issueDate: HOJE, dueDate: HOJE, amountCents: 10000 };
    const ruim = await createTitles(actor(A), { ...base, allocations: [{ categoryId: admin, amount: 6000 }] });
    expect(ruim.ok).toBe(false);
    const bom = await createTitles(actor(A), { ...base, allocations: [{ categoryId: admin, amount: 6000 }, { categoryId: categoryId(A.id, 'energia'), amount: 4000 }] });
    expect(bom.ok).toBe(true);
    // Categoria de receita não entra em conta a pagar.
    expect((await createTitles(actor(A), { ...base, categoryId: categoryId(A.id, 'procedimentos_particulares') })).ok).toBe(false);
  });

  it('baixa parcial deixa PARCIAL; o resto zera e vira PAGO', async () => {
    const p = await A.paciente('Parcial');
    const [id] = await titulo(A, 10000, { patientId: p.id });
    const r1 = await receber(A, { titleId: id, lines: [linha(A, 'PIX', 4000)] });
    expect(r1).toMatchObject({ ok: true, titleStatus: 'PARTIAL', remainingCents: 6000 });
    const r2 = await receber(A, { titleId: id, lines: [linha(A, 'PIX', 6000)] });
    expect(r2).toMatchObject({ ok: true, titleStatus: 'PAID', remainingCents: 0 });
    expect(toCents((await ler(A, id))!.paidAmount)).toBe(10000);
    // E uma conta paga não aceita mais nada.
    expect((await receber(A, { titleId: id, lines: [linha(A, 'PIX', 100)] })).ok).toBe(false);
  });

  it('dois recebimentos ao mesmo tempo do mesmo título: um passa, o outro é recusado', async () => {
    const p = await A.paciente('Concorrente');
    const [id] = await titulo(A, 10000, { patientId: p.id });
    const tentativa = () => receber(A, { titleId: id, expectedOpenCents: 10000, lines: [linha(A, 'PIX', 10000)] });
    const [a, b] = await Promise.all([tentativa(), tentativa()]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const recusado = a.ok ? b : a;
    if (!recusado.ok) expect(recusado.code).toBe('STALE');
    expect(toCents((await ler(A, id))!.paidAmount)).toBe(10000);
    expect(await A.db.financialTransaction.count({ where: { titleId: id } })).toBe(1);
  });

  it('não recebe mais que o em aberto; dinheiro a mais vira troco ou crédito na carteira', async () => {
    const p = await A.paciente('Troco');
    const [t1] = await titulo(A, 8500, { patientId: p.id });
    expect((await receber(A, { titleId: t1, lines: [linha(A, 'PIX', 10000)] })).ok).toBe(false);
    const troco = await receber(A, { titleId: t1, lines: [linha(A, 'CASH', 10000)] });
    expect(troco).toMatchObject({ ok: true, changeCents: 1500, walletCreditCents: 0, titleStatus: 'PAID' });
    const mov = await A.db.financialTransaction.findFirst({ where: { titleId: t1 } });
    expect(toCents(mov!.amount)).toBe(8500);

    const [t2] = await titulo(A, 8500, { patientId: p.id });
    const credito = await receber(A, { titleId: t2, lines: [linha(A, 'CASH', 10000)], change: 'WALLET' });
    expect(credito).toMatchObject({ ok: true, changeCents: 0, walletCreditCents: 1500 });
    const saldo = await A.db.walletEntry.aggregate({ where: { patientId: p.id }, _sum: { amount: true } });
    expect(toCents(saldo._sum.amount)).toBe(1500);
    // O dinheiro inteiro entrou na conta: 85 do título + 15 da carteira.
    if (credito.ok) {
      const movs = await A.db.financialTransaction.findMany({ where: { receiptGroupId: credito.receiptGroupId } });
      expect(movs.reduce((s, m) => s + toCents(m.signedAmount), 0)).toBe(10000);
    }
  });

  it('carteira paga conta sem mexer em conta bancária e não passa do saldo', async () => {
    const p = await A.paciente('Carteira');
    await A.db.walletEntry.create({ data: { tenantId: A.id, patientId: p.id, amount: '50.00', reason: 'ADVANCE' } });
    const [id] = await titulo(A, 8000, { patientId: p.id });
    expect((await receber(A, { titleId: id, lines: [linha(A, 'WALLET', 8000)] })).ok).toBe(false);
    const r = await receber(A, { titleId: id, lines: [linha(A, 'WALLET', 5000), linha(A, 'PIX', 3000)] });
    expect(r).toMatchObject({ ok: true, titleStatus: 'PAID' });
    const movs = await A.db.financialTransaction.findMany({ where: { titleId: id }, orderBy: { code: 'asc' } });
    expect(movs.map((m) => [m.methodKind, toCents(m.signedAmount), m.accountId === null])).toEqual([
      ['WALLET', 0, true],
      ['PIX', 3000, false],
    ]);
    const saldo = await A.db.walletEntry.aggregate({ where: { patientId: p.id }, _sum: { amount: true } });
    expect(toCents(saldo._sum.amount)).toBe(0);
  });

  it('desconto acima do limite é recusado no servidor e passa com liberação aprovada', async () => {
    const p = await A.paciente('Desconto');
    const [id] = await titulo(A, 10000, { patientId: p.id });
    const recepcao = env(A, 'RECEPTIONIST');
    // Limite da clínica: 10%. 20% de desconto pede liberação.
    const semLiberar = await receber(A, { titleId: id, lines: [linha(A, 'PIX', 8000)], discountCents: 2000 }, recepcao);
    expect(semLiberar).toMatchObject({ ok: false, code: 'NEEDS_RELEASE' });
    // Dentro do limite passa.
    const [dentro] = await titulo(A, 10000, { patientId: p.id });
    expect((await receber(A, { titleId: dentro, lines: [linha(A, 'PIX', 9000)], discountCents: 1000 }, recepcao)).ok).toBe(true);
    // Liberação pendente não vale; aprovada vale uma vez.
    const lib = await A.db.financialRelease.create({ data: { tenantId: A.id, kind: 'DISCOUNT', titleId: id, payload: { amountCents: 2000 }, requestedById: A.rec.id, expiresAt: new Date(Date.now() + 600_000) } });
    expect((await receber(A, { titleId: id, lines: [linha(A, 'PIX', 8000)], discountCents: 2000, releaseId: lib.id }, recepcao)).ok).toBe(false);
    await A.db.financialRelease.update({ where: { id: lib.id }, data: { status: 'APPROVED', decidedById: A.dono.id, decidedAt: new Date() } });
    // Liberação de R$ 20 não cobre desconto de R$ 30.
    expect((await receber(A, { titleId: id, lines: [linha(A, 'PIX', 7000)], discountCents: 3000, releaseId: lib.id }, recepcao)).ok).toBe(false);
    expect((await receber(A, { titleId: id, lines: [linha(A, 'PIX', 8000)], discountCents: 2000, releaseId: lib.id }, recepcao)).ok).toBe(true);
    expect((await A.db.financialRelease.findFirst({ where: { id: lib.id } }))?.usedAt).toBeTruthy();
    expect((await ler(A, id))!.status).toBe('PAID');
    // O dono não tem limite.
    const [doDono] = await titulo(A, 10000, { patientId: p.id });
    expect((await receber(A, { titleId: doDono, lines: [linha(A, 'PIX', 5000)], discountCents: 5000 })).ok).toBe(true);
  });

  it('cartão em 3x: recebíveis, taxa lançada como despesa e saldo da conta', async () => {
    const p = await A.paciente('Cartão');
    await A.db.finPaymentMethodFee.createMany({
      data: [
        { tenantId: A.id, methodId: forma(A, 'CREDIT_CARD'), upToInstallments: 1, percent: 3.2 },
        { tenantId: A.id, methodId: forma(A, 'CREDIT_CARD'), upToInstallments: 6, percent: 4.5 },
      ],
    });
    const [id] = await titulo(A, 100000, { patientId: p.id });
    // R$ 200 no PIX + R$ 800 no cartão em 3x: o exemplo do pedido.
    const r = await receber(A, { titleId: id, lines: [linha(A, 'PIX', 20000), linha(A, 'CREDIT_CARD', 80000, { installments: 3, cardBrand: 'Visa', nsu: '123456' })] });
    expect(r).toMatchObject({ ok: true, titleStatus: 'PAID' });
    if (!r.ok) return;
    const movs = await A.db.financialTransaction.findMany({ where: { receiptGroupId: r.receiptGroupId }, orderBy: { code: 'asc' } });
    expect(movs.map((m) => [m.kind, toCents(m.amount)])).toEqual([
      ['RECEIPT', 20000],
      ['RECEIPT', 80000],
      ['FEE', 3600],
    ]);
    const cartao = movs[1];
    const recebiveis = await A.db.cardReceivable.findMany({ where: { transactionId: cartao.id }, orderBy: { installmentNumber: 'asc' } });
    expect(recebiveis.map((x) => [toCents(x.grossAmount), toCents(x.feeAmount), toCents(x.netAmount), x.expectedDate.toISOString().slice(0, 10)])).toEqual([
      [26666, 1200, 25466, '2026-12-16'],
      [26666, 1200, 25466, '2027-01-15'],
      [26668, 1200, 25468, '2027-02-14'],
    ]);
    expect(cartao.settlementDate?.toISOString().slice(0, 10)).toBe('2026-12-16');
    // Passar do máximo de parcelas da forma é recusado.
    const [outro] = await titulo(A, 10000, { patientId: p.id });
    expect((await receber(A, { titleId: outro, lines: [linha(A, 'CREDIT_CARD', 10000, { installments: 13 })] })).ok).toBe(false);
    expect((await receber(A, { titleId: outro, lines: [linha(A, 'CREDIT_CARD', 10000, { installments: 2 })] }, env(A, 'OWNER', { requireCardData: true }))).ok).toBe(false);
  });

  it('estorno reabre o título, leva a taxa junto, cancela os recebíveis e tira o espelho', async () => {
    const p = await A.paciente('Estorno');
    const [id] = await titulo(A, 50000, { patientId: p.id });
    const r = await receber(A, { titleId: id, lines: [linha(A, 'CREDIT_CARD', 50000, { installments: 2 })] });
    if (!r.ok) throw new Error(r.message);
    const [movId] = r.transactionIds;
    const espelho = (await A.db.financialTransaction.findFirst({ where: { id: movId } }))!.mirrorPaymentId!;
    expect(await A.db.payment.count({ where: { id: espelho } })).toBe(1);

    expect((await estornar(A, { transactionId: movId, reason: 'x' })).ok).toBe(false);
    const e = await estornar(A, { transactionId: movId, reason: 'Cartão passado errado' });
    expect(e).toMatchObject({ ok: true });
    if (!e.ok) return;
    expect(e.reversedIds).toHaveLength(2); // o recebimento e a taxa
    expect(await ler(A, id)).toMatchObject({ status: 'OPEN' });
    expect(toCents((await ler(A, id))!.paidAmount)).toBe(0);
    expect(await A.db.cardReceivable.count({ where: { transactionId: movId, status: 'OPEN' } })).toBe(0);
    expect(await A.db.payment.count({ where: { id: espelho } })).toBe(0);
    // Nada foi apagado: os movimentos originais continuam lá, marcados, e o saldo do grupo zera.
    const grupo = await A.db.financialTransaction.findMany({ where: { receiptGroupId: r.receiptGroupId } });
    expect(grupo).toHaveLength(4);
    expect(grupo.reduce((s, m) => s + toCents(m.signedAmount), 0)).toBe(0);
    // Não estorna duas vezes, nem estorna um estorno.
    expect((await estornar(A, { transactionId: movId, reason: 'de novo' })).ok).toBe(false);
    const rev = grupo.find((m) => m.kind === 'REVERSAL')!;
    expect((await estornar(A, { transactionId: rev.id, reason: 'estorno do estorno' })).ok).toBe(false);
    // E o título volta a aceitar pagamento.
    expect((await receber(A, { titleId: id, lines: [linha(A, 'PIX', 50000)] })).ok).toBe(true);
  });

  it('estorno devolve o que saiu da carteira', async () => {
    const p = await A.paciente('Estorno carteira');
    await A.db.walletEntry.create({ data: { tenantId: A.id, patientId: p.id, amount: '100.00', reason: 'ADVANCE' } });
    const [id] = await titulo(A, 6000, { patientId: p.id });
    const r = await receber(A, { titleId: id, lines: [linha(A, 'WALLET', 6000)] });
    if (!r.ok) throw new Error(r.message);
    const saldo = async () => toCents((await A.db.walletEntry.aggregate({ where: { patientId: p.id }, _sum: { amount: true } }))._sum.amount);
    expect(await saldo()).toBe(4000);
    expect((await estornar(A, { transactionId: r.transactionIds[0], reason: 'Lançado no paciente errado' })).ok).toBe(true);
    expect(await saldo()).toBe(10000);
  });

  it('título com pagamento não muda de valor nem é cancelado; sem pagamento, sim', async () => {
    const p = await A.paciente('Editar');
    const [id] = await titulo(A, 10000, { patientId: p.id });
    expect((await updateTitle(actor(A), id, { amountCents: 12000, description: 'Ajustado' })).ok).toBe(true);
    expect(toCents((await ler(A, id))!.amount)).toBe(12000);
    await receber(A, { titleId: id, lines: [linha(A, 'PIX', 2000)] });
    expect((await updateTitle(actor(A), id, { amountCents: 15000 })).ok).toBe(false);
    expect((await updateTitle(actor(A), id, { description: 'Só o texto' })).ok).toBe(true);
    expect((await cancelTitle(actor(A), id, 'Lançado errado')).ok).toBe(false);
    const [livre] = await titulo(A, 5000, { patientId: p.id });
    expect((await cancelTitle(actor(A), livre, 'ok')).ok).toBe(false); // motivo curto
    expect((await cancelTitle(actor(A), livre, 'Lançado em duplicidade')).ok).toBe(true);
    expect((await receber(A, { titleId: livre, lines: [linha(A, 'PIX', 5000)] })).ok).toBe(false);
  });

  it('conta a pagar: paga, não gera espelho nem recebível, e o valor sai da conta', async () => {
    const r = await createTitles(actor(A), { direction: 'PAYABLE', categoryId: categoryId(A.id, 'energia'), issueDate: HOJE, dueDate: HOJE, amountCents: 32000, description: 'Conta de luz' });
    if (!r.ok) throw new Error(r.message);
    const pagamentosAntes = await A.db.payment.count();
    const pago = await receber(A, { titleId: r.data.ids[0], lines: [linha(A, 'PIX', 32000)] });
    expect(pago).toMatchObject({ ok: true, titleStatus: 'PAID' });
    const mov = await A.db.financialTransaction.findFirst({ where: { titleId: r.data.ids[0] } });
    expect(mov).toMatchObject({ kind: 'PAYMENT', mirrorPaymentId: null });
    expect(toCents(mov!.signedAmount)).toBe(-32000);
    expect(await A.db.payment.count()).toBe(pagamentosAntes);
    // Pagar a mais não existe.
    const outro = await createTitles(actor(A), { direction: 'PAYABLE', categoryId: categoryId(A.id, 'agua'), issueDate: HOJE, dueDate: HOJE, amountCents: 1000 });
    if (outro.ok) expect((await receber(A, { titleId: outro.data.ids[0], lines: [linha(A, 'CASH', 5000)] })).ok).toBe(false);
  });

  it('lançamento recorrente: gera 12 meses à frente, sem repetir ao rodar de novo', async () => {
    const hoje = (await import('../lib/tz')).clinicToday();
    const r = await createRecurrence(
      actor(A),
      { direction: 'PAYABLE', categoryId: categoryId(A.id, 'aluguel'), issueDate: hoje, dueDate: hoje, amountCents: 250000, description: 'Aluguel' },
      { every: 1, unit: 'MONTH', start: hoje },
    );
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.data.created).toBe(13); // hoje e os 12 meses seguintes
    expect(await extendRecurrences(A.db, A.id, hoje)).toBe(0);
    const ts = await A.db.financialTitle.findMany({ where: { recurrenceId: r.data.ruleId }, orderBy: { dueDate: 'asc' } });
    expect(ts).toHaveLength(13);
    expect(ts.every((t) => t.origin === 'RECURRENCE' && toCents(t.amount) === 250000)).toBe(true);
    // "Este e os próximos": muda o valor daqui para a frente e o molde.
    expect((await updateTitle(actor(A), ts[2].id, { amountCents: 260000 }, 'following')).ok).toBe(true);
    const depois = await A.db.financialTitle.findMany({ where: { recurrenceId: r.data.ruleId }, orderBy: { dueDate: 'asc' } });
    expect(depois.map((t) => toCents(t.amount))).toEqual([250000, 250000, ...Array(11).fill(260000)]);
    // Cancelar este e os próximos para a regra.
    const c = await cancelTitle(actor(A), ts[5].id, 'Mudamos de sala', 'following');
    expect(c).toMatchObject({ ok: true, data: { cancelled: 8 } });
    expect((await A.db.recurrenceRule.findFirst({ where: { id: r.data.ruleId } }))?.active).toBe(false);
  });

  it('nada de uma clínica é alcançado pela outra', async () => {
    const p = await A.paciente('Isolado');
    const [id] = await titulo(A, 10000, { patientId: p.id });
    const r = await receber(A, { titleId: id, lines: [linha(A, 'PIX', 1000)] });
    if (!r.ok) throw new Error(r.message);
    // A clínica B não vê, não baixa e não estorna.
    expect(await B.db.financialTitle.findFirst({ where: { id } })).toBeNull();
    expect(await B.db.financialTransaction.count()).toBe(0);
    expect((await B.db.$transaction((tx) => settleTitleTx(tx, env(B), { titleId: id, lines: [linha(B, 'PIX', 1000)] }))).ok).toBe(false);
    expect((await B.db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: B.id, userId: B.dono.id, today: HOJE }, { transactionId: r.transactionIds[0], reason: 'invasão' }))).ok).toBe(false);
    // Nem usando a forma ou a categoria da outra clínica.
    expect((await receber(A, { titleId: id, lines: [{ methodId: forma(B, 'PIX'), amountCents: 1000, paidOn: HOJE }] })).ok).toBe(false);
    expect((await createTitles(actor(B), { direction: 'RECEIVABLE', categoryId: categoryId(A.id, 'procedimentos_particulares'), issueDate: HOJE, dueDate: HOJE, amountCents: 100 })).ok).toBe(false);
    expect((await createTitles(actor(B), { direction: 'RECEIVABLE', categoryId: categoryId(B.id, 'procedimentos_particulares'), patientId: p.id, issueDate: HOJE, dueDate: HOJE, amountCents: 100 })).ok).toBe(false);
    expect(toCents((await ler(A, id))!.paidAmount)).toBe(1000);
  });

  // ─── Orçamentos e migração do financeiro antigo ────────────────────────────

  let numero = 0;
  const orcamento = async (c: typeof A, patientId: string, total: number, down: number, parcelas: number, status: 'ACCEPTED' | 'DRAFT' = 'ACCEPTED') =>
    prisma.quote.create({
      data: {
        tenantId: c.id,
        patientId,
        number: ++numero,
        publicToken: `tok_${suffix}_${numero}`,
        status,
        subtotal: total,
        total,
        downPayment: down,
        installments: parcelas,
        paymentMethod: null,
        validUntil: new Date('2026-12-31T00:00:00.000Z'),
        acceptedAt: status === 'ACCEPTED' ? new Date('2026-10-10T15:00:00.000Z') : null,
      },
    });
  const pagamento = (c: typeof A, patientId: string, quoteId: string | null, amount: number, method: string | null, dia: string) =>
    prisma.payment.create({ data: { tenantId: c.id, patientId, quoteId, amount, method, paidAt: new Date(`${dia}T15:00:00.000Z`) } });

  it('migração: orçamentos antigos mostram os mesmos valores pagos e em aberto de antes', async () => {
    const p = await B.paciente('Legado');
    // R$ 1.000: entrada de 200 + 4x de 200. Pagou 200 e depois 300 (cobre a 1ª parcela e metade da 2ª).
    const q = await orcamento(B, p.id, 1000, 200, 4);
    const p1 = await pagamento(B, p.id, q.id, 200, 'PIX', '2026-10-10');
    const p2 = await pagamento(B, p.id, q.id, 300, 'Cartão de crédito', '2026-11-05');
    // Um avulso, sem orçamento, e um pagamento num orçamento ainda não aprovado.
    const avulso = await pagamento(B, p.id, null, 150, 'Dinheiro', '2026-11-06');
    const rascunho = await orcamento(B, p.id, 500, 0, 1, 'DRAFT');
    const sinal = await pagamento(B, p.id, rascunho.id, 100, null, '2026-11-07');

    const antes = await prisma.payment.findMany({ where: { tenantId: B.id }, orderBy: { id: 'asc' } });
    expect(await legacyPending(B.id)).toBe(true);
    const r = await migrateLegacy(B.id);
    expect(r.titles).toBe(5 + 1 + 1); // 5 parcelas, o avulso e o sinal fora do plano
    expect(await legacyPending(B.id)).toBe(false);

    // Os pagamentos antigos não mudaram em nada.
    expect(await prisma.payment.findMany({ where: { tenantId: B.id }, orderBy: { id: 'asc' } })).toEqual(antes);

    const ts = await B.db.financialTitle.findMany({ where: { quoteId: q.id }, orderBy: { installmentNumber: 'asc' } });
    expect(ts.map((t) => [toCents(t.amount), toCents(t.paidAmount), t.status])).toEqual([
      [20000, 20000, 'PAID'],
      [20000, 20000, 'PAID'],
      [20000, 10000, 'PARTIAL'],
      [20000, 0, 'OPEN'],
      [20000, 0, 'OPEN'],
    ]);
    expect(ts.map((t) => t.dueDate.toISOString().slice(0, 10))).toEqual(['2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10']);
    // Pago e em aberto iguais ao que a tela antiga calculava (total − soma dos pagamentos).
    const pagoNovo = ts.reduce((s, t) => s + toCents(t.paidAmount), 0);
    expect(pagoNovo).toBe(50000);
    expect(ts.reduce((s, t) => s + toCents(t.amount), 0) - pagoNovo).toBe(100000 - 50000);

    // O pagamento de 300 virou dois movimentos (100 + 200 não: 200 da 1ª parcela e 100 da 2ª).
    const doP2 = await B.db.financialTransaction.findMany({ where: { mirrorPaymentId: p2.id }, orderBy: { code: 'asc' } });
    expect(doP2.map((m) => toCents(m.amount))).toEqual([20000, 10000]);
    expect(doP2.map((m) => m.legacyPaymentId)).toEqual([p2.id, null]);
    expect(doP2[0].methodKind).toBe('CREDIT_CARD');
    expect(doP2[0].paidOn.toISOString().slice(0, 10)).toBe('2026-11-05');
    expect((await B.db.financialTransaction.findFirst({ where: { legacyPaymentId: p1.id } }))?.methodKind).toBe('PIX');

    // Avulso: um título já pago. Sinal em orçamento não aprovado: também, ligado ao orçamento.
    const tAvulso = await B.db.financialTransaction.findFirst({ where: { legacyPaymentId: avulso.id }, include: { title: true } });
    expect(tAvulso?.title).toMatchObject({ status: 'PAID', origin: 'MANUAL', quoteId: null });
    expect(tAvulso?.methodKind).toBe('CASH');
    const tSinal = await B.db.financialTransaction.findFirst({ where: { legacyPaymentId: sinal.id }, include: { title: true } });
    expect(tSinal?.title).toMatchObject({ status: 'PAID', quoteId: rascunho.id });
    expect(tSinal?.methodKind).toBe('OTHER');

    // Rodar de novo não cria nada.
    expect(await migrateLegacy(B.id)).toEqual({ titles: 0, transactions: 0 });
    // O total recebido da clínica bate com a soma dos pagamentos antigos.
    const recebido = await B.db.financialTransaction.aggregate({ where: { kind: 'RECEIPT' }, _sum: { amount: true } });
    expect(toCents(recebido._sum.amount)).toBe(20000 + 30000 + 15000 + 10000);
  });

  it('estornar parte de um pagamento antigo repartido encolhe o espelho em vez de apagar', async () => {
    const q = await prisma.quote.findFirst({ where: { tenantId: B.id, status: 'ACCEPTED' } });
    const parcial = await B.db.financialTitle.findFirst({ where: { quoteId: q!.id, status: 'PARTIAL' } });
    const mov = await B.db.financialTransaction.findFirst({ where: { titleId: parcial!.id } });
    const espelho = mov!.mirrorPaymentId!;
    const e = await B.db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: B.id, userId: B.dono.id, today: HOJE }, { transactionId: mov!.id, reason: 'Lançado a mais' }));
    expect(e.ok).toBe(true);
    // O pagamento antigo era de 300 (200 + 100); estornados os 100, ficam 200.
    expect(Number((await prisma.payment.findFirst({ where: { id: espelho } }))!.amount)).toBe(200);
    expect((await B.db.financialTitle.findFirst({ where: { id: parcial!.id } }))!.status).toBe('OPEN');
  });

  it('orçamento: parcela do meio com as seguintes pagas pede confirmação para estornar', async () => {
    const p = await A.paciente('Ordem');
    const q = await orcamento(A, p.id, 600, 0, 3);
    await A.db.$transaction((tx) => syncQuoteTitlesTx(tx, A.id, A.dono.id, q.id));
    const ts = await A.db.financialTitle.findMany({ where: { quoteId: q.id }, orderBy: { installmentNumber: 'asc' } });
    expect(ts.map((t) => toCents(t.amount))).toEqual([20000, 20000, 20000]);
    // "Registrar pagamento" de R$ 500 cobre as parcelas em ordem: duas inteiras e metade da terceira.
    const r = await A.db.$transaction((tx) => receiveInOrderTx(tx, env(A), ts.map((t) => t.id), 50000, { methodId: forma(A, 'PIX'), paidOn: HOJE }));
    expect(r).toMatchObject({ ok: true, settledTitles: 3 });
    expect((await A.db.financialTitle.findMany({ where: { quoteId: q.id }, orderBy: { installmentNumber: 'asc' } })).map((t) => t.status)).toEqual(['PAID', 'PAID', 'PARTIAL']);
    // Receber mais do que falta é recusado e nada fica gravado pela metade.
    const demais = await A.db.$transaction(async (tx) => {
      const x = await receiveInOrderTx(tx, env(A), ts.map((t) => t.id), 20000, { methodId: forma(A, 'PIX'), paidOn: HOJE });
      if (!x.ok) throw new Error('desfaz');
      return x;
    }).catch(() => null);
    expect(demais).toBeNull();
    expect(toCents((await ler(A, ts[2].id))!.paidAmount)).toBe(10000);

    const primeira = await A.db.financialTransaction.findFirst({ where: { titleId: ts[0].id } });
    const semConfirmar = await estornar(A, { transactionId: primeira!.id, reason: 'Estorno da primeira' });
    expect(semConfirmar).toMatchObject({ ok: false, code: 'OUT_OF_ORDER' });
    expect((await estornar(A, { transactionId: primeira!.id, reason: 'Estorno da primeira', confirmOutOfOrder: true })).ok).toBe(true);
  });

  it('orçamento reaberto cancela o que não recebeu; aprovado de novo reparte só o que falta', async () => {
    const p = await A.paciente('Reabrir');
    const q = await orcamento(A, p.id, 900, 0, 3);
    await A.db.$transaction((tx) => syncQuoteTitlesTx(tx, A.id, A.dono.id, q.id));
    const [primeiro] = await A.db.financialTitle.findMany({ where: { quoteId: q.id }, orderBy: { installmentNumber: 'asc' } });
    await receber(A, { titleId: primeiro.id, lines: [linha(A, 'PIX', 30000)] });
    // Rodar de novo com tudo coberto não cria nada.
    expect(await A.db.$transaction((tx) => syncQuoteTitlesTx(tx, A.id, A.dono.id, q.id))).toEqual({ created: 0 });

    expect(await A.db.$transaction((tx) => cancelQuoteTitlesTx(tx, A.id, A.dono.id, q.id, 'Orçamento reaberto'))).toBe(2);
    // O orçamento subiu para R$ 1.200 e foi aprovado de novo: faltam 900, em duas parcelas.
    await prisma.quote.update({ where: { id: q.id }, data: { total: 1200, subtotal: 1200 } });
    expect(await A.db.$transaction((tx) => syncQuoteTitlesTx(tx, A.id, A.dono.id, q.id))).toEqual({ created: 2 });
    const vivos = await A.db.financialTitle.findMany({ where: { quoteId: q.id, status: { not: 'CANCELLED' } }, orderBy: { installmentNumber: 'asc' } });
    expect(vivos.map((t) => [toCents(t.amount), t.status])).toEqual([
      [30000, 'PAID'],
      [45000, 'OPEN'],
      [45000, 'OPEN'],
    ]);
    expect(vivos.reduce((s, t) => s + toCents(t.amount), 0)).toBe(120000);
  });

  it('os espelhos mantêm a tela antiga certa: soma dos pagamentos = o que os títulos dizem que foi pago', async () => {
    for (const c of [A, B]) {
      const espelhos = await prisma.payment.aggregate({ where: { tenantId: c.id }, _sum: { amount: true } });
      const titulos = await c.db.financialTitle.aggregate({ where: { direction: 'RECEIVABLE', patientId: { not: null }, status: { not: 'CANCELLED' } }, _sum: { paidAmount: true } });
      expect(toCents(espelhos._sum.amount)).toBe(toCents(titulos._sum.paidAmount));
    }
    void defaultAccountId;
  });
});
