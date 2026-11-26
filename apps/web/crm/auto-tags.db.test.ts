import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

/** Tags automáticas: canal de entrada em todo lead novo e procedimentos citados. */
describe.skipIf(!process.env.DATABASE_URL)('tags automáticas (banco)', async () => {
  const { prisma, getTenantClient } = await import('@clinicaiq/db');
  const { ensureDefaultPipeline } = await import('./pipeline');
  const { createLead, updateLead, setTags } = await import('./leads');
  const { mergeTags } = await import('./settings');
  const { applyOrigin } = await import('./ad-origin');
  const { applyProcedureTags, ensureTag, tagAdTopic } = await import('./auto-tags');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await prisma.tenant.create({ data: { clerkOrgId: `at_${suffix}`, name: 'Tags', slug: `at-${suffix}` } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, name: 'Dona', email: `at-${suffix}@teste.local`, role: 'OWNER' } });
  const db = getTenantClient(tenant.id);
  const actor = { tenantId: tenant.id, userId: user.id };
  await ensureDefaultPipeline(db, tenant.id);
  const implante = await prisma.procedure.create({
    data: { tenantId: tenant.id, name: 'Implante unitário', basePrice: 3000, durationMinutes: 60 },
  });

  afterAll(async () => {
    const t = { tenantId: tenant.id };
    await prisma.leadTagOnLead.deleteMany({ where: t });
    await prisma.leadTag.deleteMany({ where: t });
    await prisma.leadActivity.deleteMany({ where: t });
    await prisma.stageAutomation.deleteMany({ where: t });
    await prisma.conversation.deleteMany({ where: t });
    await prisma.lead.deleteMany({ where: t });
    await prisma.procedure.deleteMany({ where: t });
    await prisma.lostReason.deleteMany({ where: t });
    await prisma.pipelineStage.deleteMany({ where: t });
    await prisma.pipeline.deleteMany({ where: t });
    await prisma.user.deleteMany({ where: t });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.$disconnect();
  });

  const tagsDo = async (leadId: string) =>
    (await db.leadTagOnLead.findMany({ where: { leadId }, select: { tag: { select: { name: true } } } })).map((t) => t.tag.name).sort();
  const novo = async (phone: string, source?: 'WHATSAPP' | 'MANUAL' | 'INDICACAO') => {
    const r = await createLead(db, actor, { name: 'Ana', phone, source });
    if (!r.ok) throw new Error(r.message);
    return r.leadId;
  };

  // A origem é um campo do lead (e o anúncio fica em origin.ts): o canal não vira mais tag.
  it('lead novo não ganha tag de canal, venha de onde vier', async () => {
    expect(await tagsDo(await novo('11 97777-1001', 'WHATSAPP'))).toEqual([]);
    expect(await tagsDo(await novo('11 97777-1002', 'MANUAL'))).toEqual([]);
  });

  it('anúncio do Instagram muda a origem, sem tag', async () => {
    const id = await novo('11 97777-1003', 'WHATSAPP');
    await applyOrigin(db, tenant.id, id, 'INSTAGRAM', { sourceUrl: 'https://www.instagram.com/p/x', headline: 'Implante' });
    expect(await tagsDo(id)).toEqual([]);
    expect((await db.lead.findFirst({ where: { id }, select: { source: true } }))?.source).toBe('INSTAGRAM');
  });

  it('mudar a origem à mão não mexe nas tags', async () => {
    const id = await novo('11 97777-1004', 'WHATSAPP');
    await updateLead(db, actor, id, { source: 'INDICACAO' });
    expect(await tagsDo(id)).toEqual([]);
  });

  it('procedimento citado vira tag e o interesse do lead', async () => {
    const id = await novo('11 97777-1005', 'WHATSAPP');
    expect(await applyProcedureTags(db, tenant.id, id, 'Oi! Quanto custa implante e clareamento?')).toEqual(['implante', 'clareamento']);
    expect(await tagsDo(id)).toEqual(['clareamento', 'implante']);
    const lead = await db.lead.findFirst({ where: { id }, select: { interestProcedureId: true } });
    expect(lead?.interestProcedureId).toBe(implante.id);
    // Repetir não duplica nem anota de novo.
    expect(await applyProcedureTags(db, tenant.id, id, 'é o implante mesmo')).toEqual([]);
  });

  it('acento, hífen e maiúscula não criam tag repetida', async () => {
    const a = await ensureTag(db, tenant.id, 'prótese', 'violet');
    expect(await ensureTag(db, tenant.id, 'PROTESE', 'violet')).toBe(a);
    const b = await ensureTag(db, tenant.id, 'carga imediata', 'violet');
    expect(await ensureTag(db, tenant.id, 'carga-imediata', 'violet')).toBe(b);
  });

  it('tag de procedimento posta na mão vira o interesse (só se estiver vazio)', async () => {
    const id = await novo('11 97777-1006', 'WHATSAPP');
    const tag = await ensureTag(db, tenant.id, 'implante', 'violet');
    const facebook = await ensureTag(db, tenant.id, 'facebook', 'blue');
    expect((await setTags(db, actor, id, [facebook, tag])).ok).toBe(true);
    expect((await db.lead.findFirst({ where: { id }, select: { interestProcedureId: true } }))?.interestProcedureId).toBe(implante.id);

    const outro = await prisma.procedure.create({ data: { tenantId: tenant.id, name: 'Clareamento a laser', basePrice: 900, durationMinutes: 60 } });
    const clareamento = await ensureTag(db, tenant.id, 'clareamento', 'violet');
    await setTags(db, actor, id, [facebook, tag, clareamento]);
    // Já tinha interesse: continua o implante.
    expect((await db.lead.findFirst({ where: { id }, select: { interestProcedureId: true } }))?.interestProcedureId).toBe(implante.id);
    void outro;
  });

  it('assunto do anúncio vira a mesma tag que a conversa põe', async () => {
    const id = await novo('11 97777-1007', 'WHATSAPP');
    await tagAdTopic(db, tenant.id, [id], 'Implante');
    expect(await tagsDo(id)).toEqual(['implante']);
    expect(await db.leadTag.count({ where: { name: { equals: 'implante', mode: 'insensitive' } } })).toBe(1);
    expect((await db.lead.findFirst({ where: { id }, select: { interestProcedureId: true } }))?.interestProcedureId).toBe(implante.id);
  });

  it('juntar tags: leads, automação e histórico passam para a que fica', async () => {
    const id1 = await novo('11 97777-1008', 'WHATSAPP');
    const id2 = await novo('11 97777-1009', 'WHATSAPP');
    const lentes = await ensureTag(db, tenant.id, 'lentes de contato', 'violet');
    const velha = (await db.leadTag.create({ data: { tenantId: tenant.id, name: 'lentes-dentais', color: 'pink' } })).id;
    await setTags(db, actor, id1, [velha]);
    await setTags(db, actor, id2, [velha, lentes]);
    const stage = await db.pipelineStage.findFirst({ select: { id: true } });
    const auto = await db.stageAutomation.create({
      data: { tenantId: tenant.id, stageId: stage!.id, action: 'ADD_TAG', config: { tagIds: [velha] } },
    });

    expect((await mergeTags(db, tenant.id, velha, lentes)).ok).toBe(true);
    expect(await tagsDo(id1)).toEqual(['lentes de contato']);
    expect(await tagsDo(id2)).toEqual(['lentes de contato']);
    expect(await db.leadTag.findFirst({ where: { id: velha } })).toBeNull();
    const cfg = (await db.stageAutomation.findFirst({ where: { id: auto.id }, select: { config: true } }))?.config as { tagIds: string[] };
    expect(cfg.tagIds).toEqual([lentes]);
    const hist = await db.leadActivity.findMany({ where: { leadId: id1, type: 'TAG_ADDED' }, select: { data: true } });
    expect(hist.map((h) => (h.data as { tagId: string }).tagId)).toEqual([lentes]);

    expect((await mergeTags(db, tenant.id, lentes, lentes)).ok).toBe(false);
  });
});

