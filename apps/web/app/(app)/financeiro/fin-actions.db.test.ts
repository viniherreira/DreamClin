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

const envFile = resolve(__dirname, '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';
// A bandeira ligada para todos: assim dá para testar uma clínica comum (não cortesia) em só leitura.
process.env.FINANCEIRO_COMPLETO = 'todos';

describe.skipIf(!process.env.DATABASE_URL)('financeiro: ações com perfil, liberação e conta em só leitura (banco)', async () => {
  const { prisma, getTenantClient, encrypt } = await import('@clinicaiq/db');
  const acoes = await import('./fin-actions');
  const { categoryId, methodId } = await import('@/fin/setup');
  const { toCents } = await import('@/lib/financeiro/money');
  const { clinicToday } = await import('@/lib/tz');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const hoje = clinicToday();
  const t = await prisma.tenant.create({ data: { clerkOrgId: `fa_${suffix}`, name: 'Ações', slug: `fa-${suffix}` } });
  await prisma.subscription.create({ data: { tenantId: t.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') } });
  const pessoa = (nome: string, role: 'OWNER' | 'ADMIN' | 'RECEPTIONIST' | 'PROFESSIONAL') =>
    prisma.user.create({ data: { tenantId: t.id, clerkUserId: `fa_${nome}_${suffix}`, name: nome, email: `fa-${nome}-${suffix}@teste.local`, role } });
  const dono = await pessoa('dono', 'OWNER');
  const admin = await pessoa('admin', 'ADMIN');
  const recepcao = await pessoa('recepcao', 'RECEPTIONIST');
  const profissional = await pessoa('profissional', 'PROFESSIONAL');
  const como = (u: { clerkUserId: string | null }) => {
    logado = u.clerkUserId;
  };
  const db = getTenantClient(t.id);
  const paciente = await prisma.patient.create({ data: { tenantId: t.id, controlNumber: 1, name: 'Paciente das Ações', phoneEncrypted: encrypt('11999990001', process.env.ENCRYPTION_MASTER_KEY!, t.id) } });

  afterAll(async () => {
    const w = { tenantId: t.id };
    await prisma.financialRelease.deleteMany({ where: w });
    await prisma.walletEntry.deleteMany({ where: w });
    await prisma.cardReceivable.deleteMany({ where: w });
    await prisma.financialTransaction.deleteMany({ where: { ...w, reversalOfId: { not: null } } });
    await prisma.financialTransaction.deleteMany({ where: w });
    await prisma.financialTitleAllocation.deleteMany({ where: w });
    await prisma.financialTitle.deleteMany({ where: w });
    await prisma.recurrenceRule.deleteMany({ where: w });
    await prisma.payment.deleteMany({ where: w });
    await prisma.finPaymentMethodFee.deleteMany({ where: w });
    await prisma.finPaymentMethod.deleteMany({ where: w });
    await prisma.financialCategory.deleteMany({ where: { ...w, parentId: { not: null } } });
    await prisma.financialCategory.deleteMany({ where: w });
    await prisma.financialAccount.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: w });
    await prisma.patient.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.subscription.deleteMany({ where: w });
    await prisma.tenant.deleteMany({ where: { id: t.id } });
  });

  const novo = (valor: number, extra: object = {}) =>
    acoes.createTitleAction({ direction: 'RECEIVABLE', patientId: paciente.id, categoryId: categoryId(t.id, 'procedimentos_particulares'), issueDate: hoje, dueDate: hoje, amountCents: valor, ...extra });
  const pix = (valor: number) => ({ methodId: methodId(t.id, 'PIX'), amountCents: valor, paidOn: hoje });

  it('a recepção lança e recebe; o profissional não entra no financeiro', async () => {
    como(profissional);
    expect((await novo(10000)).ok).toBe(false);
    expect((await acoes.listTitles({})).rows).toEqual([]);

    como(recepcao);
    const r = await novo(30000, { schedule: [{ dueDate: hoje, amountCents: 10000 }, { dueDate: hoje, amountCents: 20000 }] });
    expect(r).toMatchObject({ ok: true, data: { created: 2 } });
    const lista = await acoes.listTitles({ tab: 'RECEIVABLE' });
    expect(lista.rows.map((x) => x.amountCents)).toEqual([10000, 20000]);
    expect(lista.totals).toEqual({ receivableCents: 30000, payableCents: 0, balanceCents: 30000 });

    const pago = await acoes.settleAction({ titleId: lista.rows[0].id, expectedOpenCents: 10000, lines: [pix(10000)] });
    expect(pago).toMatchObject({ ok: true, titleStatus: 'PAID' });
    const mov = await acoes.listTransactions({});
    expect(mov.rows).toHaveLength(1);
    expect(mov.rows[0]).toMatchObject({ party: 'Paciente das Ações', signedCents: 10000, method: 'PIX' });
    expect(mov.byAccount).toEqual([{ account: 'Caixa interno', inCents: 10000, outCents: 0 }]);
  });

  it('estorno e cancelamento são de dono e administrador', async () => {
    const mov = (await getTenantClient(t.id).financialTransaction.findFirst({ where: { kind: 'RECEIPT' } }))!;
    como(recepcao);
    expect((await acoes.reverseAction({ transactionId: mov.id, reason: 'Tentativa da recepção' })).ok).toBe(false);
    expect(await acoes.reverseContext(mov.id)).toBeNull();
    const aberta = (await acoes.listTitles({ tab: 'RECEIVABLE' })).rows[0];
    expect((await acoes.cancelTitleAction(aberta.id, 'Tentativa da recepção')).ok).toBe(false);

    como(admin);
    expect(await acoes.reverseAction({ transactionId: mov.id, reason: 'Recebido no paciente errado' })).toMatchObject({ ok: true, data: { reversed: 1 } });
    expect((await acoes.listTransactions({ onlyReversals: true })).rows).toHaveLength(1);
    expect((await acoes.listTitles({ tab: 'RECEIVABLE' })).rows).toHaveLength(2);
    // O estorno fica no histórico com quem fez.
    const log = await prisma.auditLog.findFirst({ where: { tenantId: t.id, action: 'REVERSE' } });
    expect(log?.userId).toBe(admin.id);
  });

  it('liberação: a recepção pede, o dono aprova e o desconto passa uma vez', async () => {
    como(recepcao);
    const criado = await novo(20000);
    if (!criado.ok) throw new Error(criado.message);
    const id = criado.data.firstId!;
    const tentativa = { titleId: id, expectedOpenCents: 20000, lines: [pix(15000)], discountCents: 5000 };
    expect(await acoes.settleAction(tentativa)).toMatchObject({ ok: false, code: 'NEEDS_RELEASE' });
    const pedido = await acoes.requestRelease({ kind: 'DISCOUNT', titleId: id, amountCents: 5000 });
    if (!pedido.ok) throw new Error(pedido.message);
    expect(await acoes.releaseStatus(pedido.data.id)).toBe('PENDING');
    // Quem pediu não aprova, e a recepção não decide.
    expect((await acoes.decideRelease(pedido.data.id, true)).ok).toBe(false);
    expect(await acoes.listReleases()).toEqual([]);

    como(dono);
    expect(await acoes.pendingReleases()).toBe(1);
    expect((await acoes.listReleases())[0]).toMatchObject({ requestedBy: 'recepcao', amountCents: 5000, openCents: 20000, status: 'PENDING' });
    expect((await acoes.decideRelease(pedido.data.id, true)).ok).toBe(true);
    expect((await acoes.decideRelease(pedido.data.id, true)).ok).toBe(false);

    como(recepcao);
    expect(await acoes.releaseStatus(pedido.data.id)).toBe('APPROVED');
    expect(await acoes.settleAction({ ...tentativa, releaseId: pedido.data.id })).toMatchObject({ ok: true, titleStatus: 'PAID' });
    // A mesma liberação não serve para outra conta nem de novo.
    const outra = await novo(20000);
    if (!outra.ok) throw new Error(outra.message);
    expect((await acoes.settleAction({ titleId: outra.data.firstId!, lines: [pix(15000)], discountCents: 5000, releaseId: pedido.data.id })).ok).toBe(false);
  });

  it('baixa em lote quita cada conta e diz o que ficou de fora', async () => {
    como(recepcao);
    const abertas = (await acoes.listTitles({ tab: 'RECEIVABLE' })).rows;
    const paga = (await acoes.listTitles({ tab: 'RECEIVABLE', view: 'paid' })).rows[0];
    const r = await acoes.settleBatchAction({ ids: [...abertas.map((x) => x.id), paga.id], methodId: methodId(t.id, 'PIX'), paidOn: hoje });
    expect(r).toMatchObject({ ok: true, data: { done: abertas.length } });
    if (r.ok) expect(r.data.skipped.map((s) => s.code)).toEqual([paga.code]);
    expect((await acoes.listTitles({ tab: 'RECEIVABLE' })).rows).toEqual([]);
  });

  it('movimento: edita a descrição, não o valor, e não aceita data futura', async () => {
    const mov = (await db.financialTransaction.findFirst({ where: { kind: 'RECEIPT', reversedAt: null } }))!;
    como(recepcao);
    expect((await acoes.updateTransactionAction({ id: mov.id, description: 'x' })).ok).toBe(false);
    como(dono);
    expect((await acoes.updateTransactionAction({ id: mov.id, description: 'Comprovante conferido', documentNumber: 'E123' })).ok).toBe(true);
    expect((await acoes.updateTransactionAction({ id: mov.id, paidOn: '2099-01-01' })).ok).toBe(false);
    const depois = (await db.financialTransaction.findFirst({ where: { id: mov.id } }))!;
    expect(depois).toMatchObject({ description: 'Comprovante conferido', documentNumber: 'E123' });
    expect(toCents(depois.amount)).toBe(toCents(mov.amount));
  });

  it('conta em só leitura (assinatura vencida além da tolerância) não grava nada no financeiro', async () => {
    como(dono);
    const aberta = await novo(5000);
    if (!aberta.ok) throw new Error(aberta.message);
    const mov = (await db.financialTransaction.findFirst({ where: { kind: 'RECEIPT', reversedAt: null } }))!;
    await prisma.subscription.update({ where: { tenantId: t.id }, data: { status: 'CANCELLED', currentPeriodEnd: new Date('2020-01-01'), graceEndsAt: new Date('2020-02-01'), cancelledAt: new Date('2020-01-01') } });

    const antes = { titulos: await db.financialTitle.count(), movimentos: await db.financialTransaction.count(), pedidos: await db.financialRelease.count() };
    expect((await novo(1000)).ok).toBe(false);
    expect((await acoes.settleAction({ titleId: aberta.data.firstId!, lines: [pix(5000)] })).ok).toBe(false);
    expect((await acoes.settleBatchAction({ ids: [aberta.data.firstId!], methodId: methodId(t.id, 'PIX'), paidOn: hoje })).ok).toBe(false);
    expect((await acoes.reverseAction({ transactionId: mov.id, reason: 'Conta bloqueada' })).ok).toBe(false);
    expect((await acoes.cancelTitleAction(aberta.data.firstId!, 'Conta bloqueada')).ok).toBe(false);
    expect((await acoes.updateTitleAction({ id: aberta.data.firstId!, description: 'x' })).ok).toBe(false);
    expect((await acoes.requestRelease({ kind: 'DISCOUNT', titleId: aberta.data.firstId!, amountCents: 100 })).ok).toBe(false);
    expect({ titulos: await db.financialTitle.count(), movimentos: await db.financialTransaction.count(), pedidos: await db.financialRelease.count() }).toEqual(antes);
    // Ler continua podendo: os dados são da clínica.
    expect((await acoes.listTitles({ tab: 'RECEIVABLE' })).rows).toHaveLength(1);
  });
});
