import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: () => undefined,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers() }));

let logado: string | null = null;
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: logado }) }));

/**
 * Excluir orçamento: quando não pode, devolve o motivo (a tela mostra e não
 * volta para a lista); quando pode, exclui e diz que deu certo.
 */
const envFile = resolve(__dirname, '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('excluir orçamento (banco)', async () => {
  const { prisma, encrypt } = await import('@clinicaiq/db');
  const acoes = await import('./actions');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await prisma.tenant.create({ data: { clerkOrgId: `exq_${suffix}`, name: 'EXQ', slug: `exq-${suffix}` } });
  const sub = await prisma.subscription.create({ data: { tenantId: tenant.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') } });
  const dono = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId: `user_exq_${suffix}`, name: 'Dono', email: `exq-${suffix}@teste.local`, role: 'OWNER' } });
  const pac = await prisma.patient.create({ data: { tenantId: tenant.id, controlNumber: 1, name: 'Paciente 1', phoneEncrypted: encrypt('11987650000', process.env.ENCRYPTION_MASTER_KEY!, tenant.id), lgpdConsentAt: new Date() } });
  const orcamento = (n: number) =>
    prisma.quote.create({ data: { tenantId: tenant.id, patientId: pac.id, number: n, publicToken: `tok_${suffix}_${n}`, subtotal: 100, total: 100, validUntil: new Date('2099-01-01') } });

  afterAll(async () => {
    const t = { tenantId: tenant.id };
    await prisma.auditLog.deleteMany({ where: t });
    await prisma.quote.deleteMany({ where: t });
    await prisma.patient.deleteMany({ where: t });
    await prisma.user.deleteMany({ where: t });
    await prisma.subscription.deleteMany({ where: t });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });

  it('exclui e confirma', async () => {
    logado = dono.clerkUserId;
    const q = await orcamento(1);
    expect(await acoes.deleteQuote(q.id)).toEqual({ ok: true });
    expect(await prisma.quote.count({ where: { id: q.id } })).toBe(0);
  });

  it('conta só em leitura: não exclui e devolve o motivo', async () => {
    logado = dono.clerkUserId;
    const q = await orcamento(2);
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', currentPeriodEnd: new Date('2020-01-01'), cancelledAt: new Date('2020-01-01') } });
    const r = await acoes.deleteQuote(q.id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message.length).toBeGreaterThan(0);
    expect(await prisma.quote.count({ where: { id: q.id } })).toBe(1);
  });

  it('orçamento que não existe: diz isso', async () => {
    logado = dono.clerkUserId;
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01'), cancelledAt: null } });
    expect(await acoes.deleteQuote('nao-existe')).toEqual({ ok: false, message: 'Orçamento não encontrado. Atualize a página.' });
  });
});
