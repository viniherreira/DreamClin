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

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';
// O ambiente local pode ter a bandeira ligada para todos; o teste confere a regra da cortesia.
delete process.env.FINANCEIRO_COMPLETO;

describe.skipIf(!process.env.DATABASE_URL)('financeiro: fundação (banco)', async () => {
  const { prisma, getTenantClient } = await import('@clinicaiq/db');
  const { setupFinance, defaultAccountId, categoryId } = await import('./setup');
  const { financeEnabled } = await import('./flag');
  const acoes = await import('../app/(app)/configuracoes/finance-actions');
  const { DEFAULT_CATEGORIES, DEFAULT_METHODS } = await import('../lib/financeiro/defaults');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const novaClinica = async (nome: string, cortesia: boolean, settings?: object) => {
    const t = await prisma.tenant.create({ data: { clerkOrgId: `fin_${nome}_${suffix}`, name: `Fin ${nome}`, slug: `fin-${nome}-${suffix}`, settings } });
    await prisma.subscription.create({ data: { tenantId: t.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01'), complimentary: cortesia } });
    return t;
  };
  const a = await novaClinica('a', true, { paymentMethods: ['PIX', 'Dinheiro', 'Permuta', 'Outro'] });
  const b = await novaClinica('b', false);
  const pessoa = (tenantId: string, nome: string, role: 'OWNER' | 'RECEPTIONIST') =>
    prisma.user.create({ data: { tenantId, clerkUserId: `${nome}_${suffix}`, name: nome, email: `${nome}_${suffix}@teste.local`, role } });
  const dono = await pessoa(a.id, 'dono', 'OWNER');
  const recepcao = await pessoa(a.id, 'recepcao', 'RECEPTIONIST');
  const donoB = await pessoa(b.id, 'donob', 'OWNER');
  const como = (u: { clerkUserId: string | null }) => {
    logado = u.clerkUserId;
  };

  afterAll(async () => {
    for (const id of [a.id, b.id]) {
      const t = { tenantId: id };
      await prisma.finPaymentMethodFee.deleteMany({ where: t });
      await prisma.finPaymentMethod.deleteMany({ where: t });
      await prisma.financialPermission.deleteMany({ where: t });
      await prisma.finContact.deleteMany({ where: t });
      await prisma.costCenter.deleteMany({ where: t });
      await prisma.financialCategory.deleteMany({ where: { ...t, parentId: { not: null } } });
      await prisma.financialCategory.deleteMany({ where: t });
      await prisma.financialAccount.deleteMany({ where: t });
      await prisma.auditLog.deleteMany({ where: t });
      await prisma.user.deleteMany({ where: t });
      await prisma.subscription.deleteMany({ where: t });
      await prisma.clinicUnit.deleteMany({ where: t });
      await prisma.tenant.deleteMany({ where: { id } });
    }
  });

  const totalCategorias = DEFAULT_CATEGORIES.reduce((s, c) => s + 1 + c.children.length, 0);

  it('a bandeira liga só na conta em cortesia', async () => {
    expect(await financeEnabled(a.id)).toBe(true);
    expect(await financeEnabled(b.id)).toBe(false);
  });

  it('prepara a clínica uma vez só, mesmo rodando de novo e em paralelo', async () => {
    await Promise.all([setupFinance(a.id), setupFinance(a.id)]);
    await setupFinance(a.id);
    const db = getTenantClient(a.id);
    expect(await db.financialAccount.count()).toBe(1);
    expect(await db.financialCategory.count()).toBe(totalCategorias);
    // As formas padrão mais "Permuta", que a clínica já tinha em texto. "Outro" não duplica "Outros".
    expect(await db.finPaymentMethod.count()).toBe(DEFAULT_METHODS.length + 1);
    const permuta = await db.finPaymentMethod.findFirst({ where: { name: 'Permuta' } });
    expect(permuta?.kind).toBe('OTHER');
    const conta = await db.financialAccount.findFirst({ where: { id: defaultAccountId(a.id) } });
    expect(conta).toMatchObject({ name: 'Caixa interno', kind: 'CASH', isDefault: true });
    const sub = await db.financialCategory.findFirst({ where: { id: categoryId(a.id, 'taxas_cartao') } });
    expect(sub).toMatchObject({ dreLine: 'DEDUCOES_RECEITA', direction: 'PAYABLE', parentId: categoryId(a.id, 'deducoes') });
  });

  it('não muda o que a clínica já editou', async () => {
    const db = getTenantClient(a.id);
    await db.financialCategory.update({ where: { id: categoryId(a.id, 'aluguel') }, data: { name: 'Aluguel da sala', active: false } });
    await setupFinance(a.id);
    expect(await db.financialCategory.findFirst({ where: { id: categoryId(a.id, 'aluguel') } })).toMatchObject({ name: 'Aluguel da sala', active: false });
  });

  it('nada de uma clínica aparece na outra', async () => {
    const dbB = getTenantClient(b.id);
    expect(await dbB.financialAccount.count()).toBe(0);
    expect(await dbB.financialCategory.count()).toBe(0);
    expect(await dbB.finPaymentMethod.count()).toBe(0);
    // Nem pedindo pelo id exato da outra clínica.
    expect(await dbB.financialAccount.findFirst({ where: { id: defaultAccountId(a.id) } })).toBeNull();
    expect(await dbB.financialCategory.updateMany({ where: { id: categoryId(a.id, 'aluguel') }, data: { name: 'invadido' } })).toMatchObject({ count: 0 });
  });

  it('clínica sem a bandeira não lê nem grava o financeiro novo', async () => {
    como(donoB);
    expect(await acoes.listFinanceAccounts()).toEqual([]);
    const r = await acoes.saveFinanceAccount({ name: 'Banco', kind: 'BANK', openingBalanceCents: 0, openingDate: '2026-11-01', active: true, isDefault: false });
    expect(r.ok).toBe(false);
    expect(await getTenantClient(b.id).financialAccount.count()).toBe(0);
  });

  it('a recepção não configura; o dono cria conta e troca a padrão', async () => {
    como(recepcao);
    expect((await acoes.saveFinanceAccount({ name: 'Banco', kind: 'BANK', openingBalanceCents: 0, openingDate: '2026-11-01', active: true, isDefault: false })).ok).toBe(false);
    expect(await acoes.listFinanceAccounts()).toEqual([]);

    como(dono);
    expect((await acoes.saveFinanceAccount({ name: 'Banco do Brasil', kind: 'BANK', bankName: 'BB', openingBalanceCents: 150000, openingDate: '2026-11-01', active: true, isDefault: true })).ok).toBe(true);
    const contas = await acoes.listFinanceAccounts();
    expect(contas).toHaveLength(2);
    expect(contas.filter((c) => c.isDefault).map((c) => c.name)).toEqual(['Banco do Brasil']);
    expect(contas.find((c) => c.name === 'Banco do Brasil')?.balanceCents).toBe(150000);
  });

  it('subcategoria exige a linha da DRE e categoria do sistema não se apaga', async () => {
    como(dono);
    const pai = categoryId(a.id, 'administrativas');
    expect((await acoes.saveFinanceCategory({ parentId: pai, name: 'Seguro', direction: 'PAYABLE', active: true })).ok).toBe(false);
    expect((await acoes.saveFinanceCategory({ parentId: pai, name: 'Seguro', direction: 'PAYABLE', dreLine: 'DESPESAS_ADMINISTRATIVAS', active: true })).ok).toBe(true);
    expect((await acoes.saveFinanceCategory({ parentId: pai, name: 'seguro', direction: 'PAYABLE', dreLine: 'DESPESAS_ADMINISTRATIVAS', active: true })).ok).toBe(false);
    expect((await acoes.deleteFinanceCategory(categoryId(a.id, 'energia'))).ok).toBe(false);
    const seguro = (await acoes.listFinanceCategories()).find((c) => c.name === 'Seguro');
    expect(seguro).toBeDefined();
    expect((await acoes.deleteFinanceCategory(seguro!.id)).ok).toBe(true);
  });

  it('forma de cartão guarda as faixas de taxa e recusa faixa repetida', async () => {
    como(dono);
    const credito = (await acoes.listFinanceMethods()).find((m) => m.kind === 'CREDIT_CARD')!;
    const base = { ...credito, maxInstallments: 12 };
    expect((await acoes.saveFinanceMethod({ ...base, fees: [{ upToInstallments: 1, percent: 3.2 }, { upToInstallments: 1, percent: 4 }] })).ok).toBe(false);
    expect((await acoes.saveFinanceMethod({ ...base, fees: [{ upToInstallments: 1, percent: 3.2 }, { upToInstallments: 6, percent: 4.5 }, { upToInstallments: 12, percent: 5.9 }] })).ok).toBe(true);
    const depois = (await acoes.listFinanceMethods()).find((m) => m.kind === 'CREDIT_CARD')!;
    expect(depois.fees).toEqual([
      { upToInstallments: 1, percent: 3.2, fixedCents: null },
      { upToInstallments: 6, percent: 4.5, fixedCents: null },
      { upToInstallments: 12, percent: 5.9, fixedCents: null },
    ]);
  });

  it('fornecedor: documento cifrado no banco e repetido recusado', async () => {
    como(dono);
    const r = await acoes.saveFinanceContact({ name: 'Dental Sul', personType: 'PJ', document: '12.345.678/0001-90', kind: 'SUPPLIER', active: true });
    expect(r.ok).toBe(true);
    const cru = await prisma.finContact.findFirst({ where: { tenantId: a.id, name: 'Dental Sul' } });
    expect(cru?.documentEncrypted).toBeTruthy();
    expect(cru?.documentEncrypted).not.toContain('12345678000190');
    expect((await acoes.listFinanceContacts('dental'))[0]?.document).toBe('12345678000190');
    const outro = await acoes.saveFinanceContact({ name: 'Dental Sul 2', personType: 'PJ', document: '12345678000190', kind: 'SUPPLIER', active: true });
    expect(outro.ok).toBe(false);
    expect((await acoes.saveFinanceContact({ name: 'X', personType: 'PF', document: '123', kind: 'OTHER', active: true })).ok).toBe(false);
  });

  it('regras gerais: salva limpando valores fora da faixa', async () => {
    como(dono);
    expect((await acoes.saveFinanceRules({ finePercent: 500, closeWithUnbilled: 'BLOCK' })).ok).toBe(true);
    const t = await prisma.tenant.findUnique({ where: { id: a.id }, select: { settings: true } });
    const s = t?.settings as { finance: { finePercent: number; closeWithUnbilled: string }; paymentMethods: string[] };
    expect(s.finance.finePercent).toBe(20);
    expect(s.finance.closeWithUnbilled).toBe('BLOCK');
    // O resto das configurações da clínica continua lá.
    expect(s.paymentMethods).toContain('Permuta');
  });

  it('permissão por usuário: só para quem não é dono, e só com contas da própria clínica', async () => {
    como(dono);
    expect((await acoes.saveFinancePermission({ userId: dono.id, maxDiscountPercent: 5, operation: 'BOTH', accountIds: [], canReverse: null, canSeeReports: null })).ok).toBe(false);
    expect((await acoes.saveFinancePermission({ userId: donoB.id, maxDiscountPercent: 5, operation: 'BOTH', accountIds: [], canReverse: null, canSeeReports: null })).ok).toBe(false);
    const r = await acoes.saveFinancePermission({ userId: recepcao.id, maxDiscountPercent: 15, operation: 'RECEIVE', accountIds: [defaultAccountId(a.id), 'conta-de-outra-clinica'], canReverse: true, canSeeReports: null });
    expect(r.ok).toBe(true);
    const p = (await acoes.listFinancePermissions()).find((x) => x.userId === recepcao.id);
    expect(p).toMatchObject({ maxDiscountPercent: 15, operation: 'RECEIVE', accountIds: [defaultAccountId(a.id)], canReverse: true });
  });
});
