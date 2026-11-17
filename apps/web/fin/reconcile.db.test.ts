import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('financeiro: conciliação bancária e de cartões (banco)', async () => {
  const { prisma, getTenantClient, encrypt } = await import('@clinicaiq/db');
  const { setupFinance, methodId, categoryId } = await import('./setup');
  const { createTitles } = await import('./titles');
  const { settleTitleTx } = await import('./settle');
  const rec = await import('./reconcile');
  const { parseOfx } = await import('../lib/financeiro/statement');
  const { DEFAULT_FINANCE_SETTINGS } = await import('../lib/financeiro/settings');
  const { toCents } = await import('../lib/financeiro/money');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const t = await prisma.tenant.create({ data: { clerkOrgId: `cc_${suffix}`, name: 'Conciliação', slug: `cc-${suffix}` } });
  await setupFinance(t.id);
  const db = getTenantClient(t.id);
  const dono = await prisma.user.create({ data: { tenantId: t.id, clerkUserId: `cc_dono_${suffix}`, name: 'Dono', email: `cc-dono-${suffix}@teste.local`, role: 'OWNER' } });
  const banco = await prisma.financialAccount.create({ data: { tenantId: t.id, name: 'Banco', kind: 'BANK', openingDate: new Date('2026-11-01T00:00:00Z') } });
  const cofre = await prisma.financialAccount.create({ data: { tenantId: t.id, name: 'Cofre', kind: 'CASH', openingDate: new Date('2026-11-01T00:00:00Z') } });
  const p = await prisma.patient.create({ data: { tenantId: t.id, controlNumber: 1, name: 'Paciente Conciliação', phoneEncrypted: encrypt('11999990011', process.env.ENCRYPTION_MASTER_KEY!, t.id) } });
  // PIX e cartão caem no banco.
  await prisma.finPaymentMethod.updateMany({ where: { tenantId: t.id, kind: { in: ['PIX', 'CREDIT_CARD', 'CHECK'] } }, data: { accountId: banco.id } });
  await prisma.finPaymentMethodFee.create({ data: { tenantId: t.id, methodId: methodId(t.id, 'CREDIT_CARD'), upToInstallments: 12, percent: 3 } });
  const env = (s: object = {}) => ({ tenantId: t.id, userId: dono.id, access: { role: 'OWNER' as const }, settings: { ...DEFAULT_FINANCE_SETTINGS, requireOpenCashForCash: false, ...s }, today: '2026-11-30' as never });
  const conta = async (amountCents: number, due: string) => {
    const r = await createTitles({ tenantId: t.id, userId: dono.id, db }, { direction: 'RECEIVABLE', categoryId: categoryId(t.id, 'procedimentos_particulares'), issueDate: due as never, dueDate: due as never, amountCents, patientId: p.id });
    if (!r.ok) throw new Error(r.message);
    return r.data.ids[0];
  };
  const receber = (titleId: string, kind: Parameters<typeof methodId>[1], amountCents: number, paidOn: string, extra: object = {}, s: object = {}) =>
    db.$transaction((tx) => settleTitleTx(tx, env(s), { titleId, lines: [{ methodId: methodId(t.id, kind), amountCents, paidOn: paidOn as never, ...extra }] }));

  afterAll(async () => {
    const w = { tenantId: t.id };
    await prisma.bankStatementLine.deleteMany({ where: w });
    await prisma.bankStatementImport.deleteMany({ where: w });
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

  it('importa o OFX: exatas casam sozinhas, aproximadas viram sugestão, repetidas são puladas', async () => {
    await receber(await conta(35000, '2026-11-10'), 'PIX', 35000, '2026-11-10');
    await receber(await conta(20000, '2026-11-12'), 'PIX', 20000, '2026-11-12');
    const ofx = `<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>20261110<TRNAMT>350.00<FITID>F1<MEMO>PIX Maria</STMTTRN>
<STMTTRN><DTPOSTED>20261114<TRNAMT>200.00<FITID>F2<MEMO>PIX João</STMTTRN>
<STMTTRN><DTPOSTED>20261115<TRNAMT>-12.90<FITID>F3<MEMO>Tarifa pacote</STMTTRN>
<STMTTRN><DTPOSTED>20261116<TRNAMT>-500.00<FITID>F4<MEMO>Transf. para o cofre</STMTTRN>
<STMTTRN><DTPOSTED>20261117<TRNAMT>-1.00<FITID>F5<MEMO>Duvidosa</STMTTRN>
</BANKTRANLIST></OFX>`;
    const r = await db.$transaction((tx) => rec.importStatementTx(tx, env(), { accountId: banco.id, filename: 'extrato.ofx', format: 'OFX', lines: parseOfx(ofx) }));
    expect(r).toMatchObject({ ok: true, added: 5, skipped: 0, matched: 1 });
    const de_novo = await db.$transaction((tx) => rec.importStatementTx(tx, env(), { accountId: banco.id, filename: 'extrato.ofx', format: 'OFX', lines: parseOfx(ofx) }));
    expect(de_novo).toMatchObject({ ok: true, added: 0, skipped: 5 });

    const pend = await rec.statementLines(db, banco.id);
    expect(pend).toHaveLength(4);
    const joao = pend.find((l) => l.description === 'PIX João')!;
    expect(joao.suggestion).toBeTruthy();
    expect((await db.$transaction((tx) => rec.linkLineTx(tx, env(), joao.id, joao.suggestion!.id))).ok).toBe(true);

    // Tarifa: lançar como despesa (categoria de receita é recusada).
    const tarifa = pend.find((l) => l.description === 'Tarifa pacote')!;
    expect((await db.$transaction((tx) => rec.createFromLineTx(tx, env(), tarifa.id, { categoryId: categoryId(t.id, 'procedimentos_particulares') }))).ok).toBe(false);
    const criada = await db.$transaction((tx) => rec.createFromLineTx(tx, env(), tarifa.id, { categoryId: categoryId(t.id, 'tarifas_bancarias') }));
    expect(criada.ok).toBe(true);

    // Para o cofre: transferência.
    const transf = pend.find((l) => l.description === 'Transf. para o cofre')!;
    expect((await db.$transaction((tx) => rec.transferFromLineTx(tx, env(), transf.id, cofre.id))).ok).toBe(true);
    const saldoCofre = toCents((await db.financialTransaction.aggregate({ where: { accountId: cofre.id }, _sum: { signedAmount: true } }))._sum.signedAmount);
    expect(saldoCofre).toBe(50000);

    const duvidosa = pend.find((l) => l.description === 'Duvidosa')!;
    expect((await db.$transaction((tx) => rec.discardLineTx(tx, env(), duvidosa.id))).ok).toBe(true);
    expect(await rec.statementLines(db, banco.id)).toHaveLength(0);

    const resumo = (await rec.accountsReconSummary(db)).find((a) => a.id === banco.id)!;
    expect(resumo.pendingLines).toBe(0);
    // Tudo no banco conciliado: 350 + 200 − 12,90 − 500.
    expect(resumo.reconciledCents).toBe(35000 + 20000 - 1290 - 50000);
    expect(resumo.balanceCents).toBe(resumo.reconciledCents);

    // Desfazer a tarifa criada: estorna o movimento e a linha volta a pendente.
    expect((await db.$transaction((tx) => rec.undoLineTx(tx, env(), tarifa.id))).ok).toBe(true);
    expect(await rec.statementLines(db, banco.id)).toHaveLength(1);
    expect((await rec.accountsReconSummary(db)).find((a) => a.id === banco.id)!.balanceCents).toBe(35000 + 20000 - 50000);
  });

  it('cartão: concilia (taxa na conciliação quando a clínica escolhe) e antecipa com custo', async () => {
    const s = { cardFeeWhen: 'RECONCILIATION' as const };
    const r = await receber(await conta(30000, '2026-11-20'), 'CREDIT_CARD', 30000, '2026-11-20', { installments: 3 }, s);
    expect(r.ok).toBe(true);
    // Sem taxa lançada no recebimento.
    expect(await db.financialTransaction.count({ where: { kind: 'FEE', origin: 'CARD_FEE' } })).toBe(0);
    const lista = await rec.listReceivables(db, { from: '2026-11-01' as never, to: '2027-03-31' as never, by: 'expected', status: 'OPEN', kind: 'CARD' });
    expect(lista).toHaveLength(3);
    expect(lista.reduce((x, l) => x + l.feeCents, 0)).toBe(900);
    const c = await db.$transaction((tx) => rec.reconcileReceivablesTx(tx, env(s), [lista[0].id]));
    expect(c).toMatchObject({ ok: true, reconciled: 1 });
    expect(toCents((await db.financialTransaction.aggregate({ where: { kind: 'FEE', origin: 'CARD_FEE' }, _sum: { amount: true } }))._sum.amount)).toBe(300);
    // Antecipa as outras duas: líquido 194, recebeu 190 → custo de 4.
    const a = await db.$transaction((tx) => rec.anticipateTx(tx, env(s), { ids: [lista[1].id, lista[2].id], date: '2026-11-25' as never, receivedCents: 19000 }));
    expect(a).toMatchObject({ ok: true, costCents: 400 });
    expect((await rec.listReceivables(db, { from: '2026-11-01' as never, to: '2027-03-31' as never, by: 'expected', status: 'OPEN', kind: 'CARD' }))).toHaveLength(0);
  });

  it('cheque devolvido reabre a conta do paciente', async () => {
    const id = await conta(15000, '2026-11-22');
    const r = await receber(id, 'CHECK', 15000, '2026-11-22', { checkBank: '001', checkNumber: '000123', checkHolder: 'Paciente', checkDate: '2026-12-05' });
    expect(r.ok).toBe(true);
    const cheque = (await rec.listReceivables(db, { from: '2026-11-01' as never, to: '2026-12-31' as never, by: 'expected', status: 'ALL', kind: 'CHECK' }))[0];
    expect(cheque.documentNumber).toBe('000123');
    expect((await db.$transaction((tx) => rec.checkReturnedTx(tx, env(), cheque.id))).ok).toBe(true);
    expect(await db.financialTitle.findFirst({ where: { id } })).toMatchObject({ status: 'OPEN' });
    expect((await db.cardReceivable.findFirst({ where: { id: cheque.id } }))?.status).toBe('RETURNED');
    expect((await db.$transaction((tx) => rec.checkReturnedTx(tx, env(), cheque.id))).ok).toBe(false);
  });
});
