import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('origem do anúncio (banco)', async () => {
  const { prisma, getTenantClient } = await import('@clinicaiq/db');
  const { ensureDefaultPipeline } = await import('./pipeline');
  const { ingestChat } = await import('./chat-ingest');
  const { afterInbound } = await import('./inbound');
  const { createLead } = await import('./leads');
  const { loadThread } = await import('./conversations');
  const origem = await import('./origin');
  const { leadWhere, parseFilters } = await import('./board-data');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await prisma.tenant.create({ data: { clerkOrgId: `ad_${suffix}`, name: 'Anúncio', slug: `ad-${suffix}` } });
  const db = getTenantClient(tenant.id);
  await ensureDefaultPipeline(db, tenant.id);

  const anuncio = (url: string) => ({
    sourceId: '120210000000001',
    sourceType: 'ad',
    sourceUrl: url,
    headline: 'Prótese de Mama',
    body: 'Apenas este mês…',
    mediaType: 'image' as const,
    imageUrl: 'https://scontent.xx.fbcdn.net/v/t45.abc',
    videoUrl: null,
    thumbnailUrl: null,
    ctwaClid: 'CLID',
  });

  let seq = 0;
  async function chega(phone: string, text: string, ad?: ReturnType<typeof anuncio>) {
    const r = await ingestChat(tenant.id, {
      externalId: `AD${suffix}${seq++}`,
      direction: 'INBOUND',
      origin: 'CONTACT',
      phone,
      contactName: 'Li Sena',
      kind: 'TEXT',
      text,
      ad,
      at: new Date(),
    });
    if (!r.recorded) throw new Error('não gravou');
    await afterInbound(tenant.id, r.conversationId, r.messageId, { skipBot: true });
    return r.conversationId;
  }
  async function leadDa(conversationId: string) {
    const c = await db.conversation.findFirst({ where: { id: conversationId }, select: { leadId: true } });
    const lead = await db.lead.findFirst({ where: { id: c!.leadId! }, include: { tags: { include: { tag: true } }, activities: true } });
    return {
      source: lead!.source,
      tags: lead!.tags.map((t) => t.tag.name).sort(),
      notas: lead!.activities.filter((a) => a.type === 'NOTE').map((a) => (a.data as { text: string }).text),
    };
  }

  afterAll(async () => {
    const t = { tenantId: tenant.id };
    await prisma.chatMessage.deleteMany({ where: t });
    await prisma.conversation.deleteMany({ where: t });
    await prisma.automationRun.deleteMany({ where: t });
    await prisma.leadTagOnLead.deleteMany({ where: t });
    await prisma.leadTag.deleteMany({ where: t });
    await prisma.leadTask.deleteMany({ where: t });
    await prisma.leadActivity.deleteMany({ where: t });
    await prisma.adTopic.deleteMany({ where: t });
    await prisma.lead.deleteMany({ where: t });
    await prisma.lostReason.deleteMany({ where: t });
    await prisma.pipelineStage.deleteMany({ where: t });
    await prisma.pipeline.deleteMany({ where: t });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.$disconnect();
  });

  it('número novo por anúncio do Facebook: lead nasce com origem Facebook, o anúncio gravado e a nota (sem tag de canal)', async () => {
    const id = await chega('11 95555-0001', 'Diminuir as mamas um sonho meu', anuncio('https://fb.me/4YAcPbZJ2'));
    expect(await leadDa(id)).toEqual({
      source: 'FACEBOOK',
      // "Prótese" no anúncio também vira tag de procedimento (tags automáticas).
      tags: ['prótese'],
      notas: ['Veio do anúncio “Prótese de Mama” (Facebook).', 'Tags automáticas: a pessoa falou em “protese”.'],
    });
    expect(await db.leadTag.count({ where: { name: 'facebook' } })).toBe(0);
    const c = await db.conversation.findFirst({ where: { id }, select: { leadId: true } });
    const lead = await db.lead.findFirst({ where: { id: c!.leadId! } });
    expect(lead).toMatchObject({ originAdId: '120210000000001', originHeadline: 'Prótese de Mama', originTopic: 'Prótese', originImageUrl: 'https://scontent.xx.fbcdn.net/v/t45.abc' });
    expect(lead?.originAt).toBeInstanceOf(Date);
  });

  it('a conversa mostra o card do anúncio', async () => {
    const id = await chega('11 95555-0002', 'Quero saber o valor', anuncio('https://www.instagram.com/p/C1abc/'));
    const thread = await loadThread(db, tenant.id, id);
    expect(thread?.messages.at(-1)?.ad).toEqual({
      platform: 'Instagram',
      headline: 'Prótese de Mama',
      body: 'Apenas este mês…',
      url: 'https://www.instagram.com/p/C1abc/',
      imageUrl: 'https://scontent.xx.fbcdn.net/v/t45.abc',
    });
    expect(await leadDa(id)).toMatchObject({ source: 'INSTAGRAM', tags: ['prótese'] });
  });

  it('a origem fica: outra mensagem, outro anúncio ou outro assunto na conversa não trocam', async () => {
    const id = await chega('11 95555-0003', 'Oi', anuncio('https://instagram.com/reel/XYZ'));
    await chega('11 95555-0003', 'Na verdade quero clareamento', { ...anuncio('https://fb.me/z'), sourceId: '120219999999999', headline: 'Clareamento' });
    const c = await db.conversation.findFirst({ where: { id }, select: { leadId: true } });
    const lead = await db.lead.findFirst({ where: { id: c!.leadId! } });
    expect(lead).toMatchObject({ originAdId: '120210000000001', originTopic: 'Prótese' });
  });

  it('"vim pelo site" na primeira mensagem: origem Site, sem tag e sem anúncio', async () => {
    const id = await chega('11 95555-0004', 'Olá! Vim pelo site e quero agendar uma avaliação');
    expect(await leadDa(id)).toEqual({ source: 'SITE', tags: [], notas: [] });
  });

  it('mensagem comum fica com a origem WhatsApp, sem tag', async () => {
    const id = await chega('11 95555-0005', 'Boa tarde, quero agendar');
    expect(await leadDa(id)).toEqual({ source: 'WHATSAPP', tags: [], notas: [] });
  });

  it('quem já tinha negócio aberto e chega por anúncio: o negócio ganha a origem e o anúncio', async () => {
    const r = await createLead(db, { tenantId: tenant.id, userId: null }, { name: 'Bia', phone: '11 95555-0006', source: 'WHATSAPP' });
    if (!r.ok) throw new Error(r.message);
    const id = await chega('11 95555-0006', 'Vi o anúncio', anuncio('https://fb.me/abc'));
    const c = await db.conversation.findFirst({ where: { id }, select: { leadId: true } });
    expect(c?.leadId).toBe(r.leadId);
    expect(await leadDa(id)).toMatchObject({ source: 'FACEBOOK', tags: ['prótese'] });
    expect(await db.lead.findFirst({ where: { id: r.leadId }, select: { originAdId: true } })).toEqual({ originAdId: '120210000000001' });
  });

  it('o gestor escolhe o assunto: anúncio vale mais que campanha, e vale para quem já veio', async () => {
    // Sem a tela Anúncios conectada não há campanha; aqui ela entra direto no banco.
    await db.lead.updateMany({ where: { originAdId: '120210000000001' }, data: { originCampaignId: '120200000000777', originCampaignName: '[Leads] Novembro' } });
    const camp = await origem.setAdTopic(tenant.id, { scope: 'CAMPAIGN', externalId: '120200000000777', topic: 'Implante', procedureId: null });
    expect(camp).toEqual({ ok: true, leads: 4 });
    expect(await db.lead.count({ where: { originTopic: 'Implante' } })).toBe(4);
    const ad = await origem.setAdTopic(tenant.id, { scope: 'AD', externalId: '120210000000001', topic: '  Carga   imediata ', procedureId: null });
    expect(ad.ok).toBe(true);
    expect(await db.lead.count({ where: { originTopic: 'Carga imediata' } })).toBe(4);
    const linhas = await origem.adOrigins(tenant.id);
    expect(linhas[0]).toMatchObject({ adId: '120210000000001', leads: 4, topic: 'Carga imediata', topicFrom: 'AD', campaignName: '[Leads] Novembro' });
    // Tirar o do anúncio: volta o da campanha.
    await origem.setAdTopic(tenant.id, { scope: 'AD', externalId: '120210000000001', topic: '', procedureId: null });
    expect(await db.lead.count({ where: { originTopic: 'Implante' } })).toBe(4);
    // Filtros do funil por anúncio, campanha e assunto.
    const ctx = { tenantId: tenant.id, userId: 'x' };
    expect(await db.lead.count({ where: leadWhere(ctx, parseFilters({ anuncio: '120210000000001' })) })).toBe(4);
    expect(await db.lead.count({ where: leadWhere(ctx, parseFilters({ campanha: '120200000000777', assunto: 'Implante' })) })).toBe(4);
    expect(await db.lead.count({ where: leadWhere(ctx, parseFilters({ assunto: 'Prótese' })) })).toBe(0);
    expect(await origem.originFilterOptions(db)).toEqual({ campaigns: [{ id: '120200000000777', name: '[Leads] Novembro' }], ads: [{ id: '120210000000001', name: 'Prótese de Mama' }], topics: ['Implante'] });
  });

  it('leads antigos: a origem sai da primeira mensagem com anúncio, uma vez só', async () => {
    await db.lead.updateMany({ where: {}, data: { originAt: null, originAdId: null, originTopic: null, originHeadline: null, originCampaignId: null, originCampaignName: null } });
    await db.adTopic.deleteMany({ where: {} });
    expect(await origem.backfillOrigins(tenant.id)).toBe(4);
    expect(await db.lead.count({ where: { originAdId: '120210000000001', originTopic: 'Prótese' } })).toBe(4);
    expect(await origem.backfillOrigins(tenant.id)).toBe(0);
  });
});
