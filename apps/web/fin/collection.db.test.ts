import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('financeiro: régua de cobrança (banco, sem enviar de verdade)', async () => {
  const { prisma, getTenantClient, encrypt } = await import('@clinicaiq/db');
  const { setupFinance, categoryId } = await import('./setup');
  const { createTitles } = await import('./titles');
  const col = await import('./collection');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const t = await prisma.tenant.create({ data: { clerkOrgId: `rg_${suffix}`, name: 'Clínica Régua', slug: `rg-${suffix}`, settings: { finance: { collectionEnabled: true, collectionDaysBefore: 3, collectionOnDueDay: true, collectionDaysAfter: [5] } } } });
  await setupFinance(t.id);
  const db = getTenantClient(t.id);
  const dono = await prisma.user.create({ data: { tenantId: t.id, clerkUserId: `rg_dono_${suffix}`, name: 'Dono', email: `rg-dono-${suffix}@teste.local`, role: 'OWNER' } });
  const chave = process.env.ENCRYPTION_MASTER_KEY!;
  let n = 0;
  const paciente = (name: string, extra: object = {}) => prisma.patient.create({ data: { tenantId: t.id, controlNumber: ++n, name, phoneEncrypted: encrypt(`1199999${String(1000 + n)}`, chave, t.id), ...extra } });
  const conta = async (patientId: string, amountCents: number, due: string) => {
    const r = await createTitles({ tenantId: t.id, userId: dono.id, db }, { direction: 'RECEIVABLE', categoryId: categoryId(t.id, 'procedimentos_particulares'), issueDate: due as never, dueDate: due as never, amountCents, patientId });
    if (!r.ok) throw new Error(r.message);
    return r.data.ids[0];
  };
  const enviados: { to: string; templateName: string; params: string[]; content: string }[] = [];
  const falso = async (m: { to: string; templateName: string; params: string[]; content: string }) => {
    enviados.push(m);
    return { ok: true, messageId: null };
  };

  afterAll(async () => {
    const w = { tenantId: t.id };
    await prisma.collectionDispatch.deleteMany({ where: w });
    await prisma.messageTemplate.deleteMany({ where: w });
    await prisma.financialTitle.deleteMany({ where: w });
    await prisma.finPaymentMethodFee.deleteMany({ where: w });
    await prisma.finPaymentMethod.deleteMany({ where: w });
    await prisma.financialCategory.deleteMany({ where: { ...w, parentId: { not: null } } });
    await prisma.financialCategory.deleteMany({ where: w });
    await prisma.financialAccount.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: w });
    await prisma.whatsAppMessage.deleteMany({ where: w });
    await prisma.patient.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.tenant.deleteMany({ where: { id: t.id } });
  });

  const HOJE = '2026-11-17' as never;

  it('sem modelo aprovado, registra por que não saiu (uma vez só)', async () => {
    const ana = await paciente('Ana Lembrete');
    await conta(ana.id, 15000, '2026-11-20');
    const r = await col.runCollectionsForTenant(t.id, HOJE, falso);
    expect(r).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(enviados).toHaveLength(0);
    const linha = await db.collectionDispatch.findFirst({ where: {} });
    expect(linha).toMatchObject({ step: 'B3', status: 'SKIPPED' });
    expect(linha?.reason).toContain('aprovado');
    // Rodar de novo no mesmo dia não repete.
    expect(await col.runCollectionsForTenant(t.id, HOJE, falso)).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });

  it('com os modelos aprovados: lembrete antes, no dia, e cobrança depois; quem pediu para não receber fica de fora', async () => {
    for (const [purpose, body, varKeys, name] of [
      ['COLLECTION_REMINDER', 'Olá, {{1}}! Sua parcela de {{2}} vence em {{3}}. Clínica {{4}}.', ['nome', 'valor', 'vencimento', 'clinica'], 'dc_cobranca_lembrete_1'],
      ['COLLECTION_OVERDUE', 'Olá, {{1}}. Consta em aberto {{2}}, vencido em {{3}}.', ['nome', 'valor', 'vencimento'], 'dc_cobranca_atraso_1'],
    ] as const) {
      await prisma.messageTemplate.create({ data: { tenantId: t.id, name, language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', body, variables: varKeys.length, purpose, varKeys: [...varKeys] } });
    }
    const bia = await paciente('Bia Hoje Silva');
    await conta(bia.id, 20000, '2026-11-17');
    const caio = await paciente('Caio Atrasado');
    await conta(caio.id, 30000, '2026-11-12');
    const dora = await paciente('Dora Não Quer', { whatsappOptOut: true });
    await conta(dora.id, 10000, '2026-11-17');
    const eva = await paciente('Eva Fora do Dia');
    await conta(eva.id, 10000, '2026-11-15');

    const r = await col.runCollectionsForTenant(t.id, HOJE, falso);
    expect(r).toEqual({ sent: 2, skipped: 1, failed: 0 });
    expect(enviados.map((e) => e.templateName).sort()).toEqual(['dc_cobranca_atraso_1', 'dc_cobranca_lembrete_1']);
    const paraBia = enviados.find((e) => e.templateName === 'dc_cobranca_lembrete_1')!;
    const semNbsp = (x: string) => x.replace(/ /g, ' ');
    expect(paraBia.params.map(semNbsp)).toEqual(['Bia', 'R$ 200,00', '17/11/2026', 'Clínica Régua']);
    expect(semNbsp(paraBia.content)).toBe('Olá, Bia! Sua parcela de R$ 200,00 vence em 17/11/2026. Clínica Clínica Régua.');
    expect(paraBia.to).toMatch(/^55/);
    const hist = await col.collectionHistory(t.id);
    expect(hist.find((h) => h.patientName === 'Dora Não Quer')).toMatchObject({ status: 'SKIPPED' });
    // Conta paga não é cobrada: a da Bia já foi lembrada hoje, e no dia seguinte não há passo para ela.
    expect(await col.runCollectionsForTenant(t.id, '2026-11-18' as never, falso)).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });

  it('régua desligada não manda nada', async () => {
    await prisma.tenant.update({ where: { id: t.id }, data: { settings: { finance: { collectionEnabled: false } } } });
    const f = await paciente('Fábio Desligado');
    await conta(f.id, 10000, '2026-11-17');
    expect(await col.runCollectionsForTenant(t.id, HOJE, falso)).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });
});
