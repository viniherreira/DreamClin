import 'server-only';

import { getTenantClient, Prisma, type TenantPrismaClient } from '@clinicaiq/db';
import { adsCredentials } from './ads-account';
import { fetchAdInfo } from './ads-meta';
import type { AdInfo } from './ads-rules';
import type { ProcedureLite } from './auto-tags-rules';
import { adMetaOf, cleanTopic, topicFor, type TopicRule } from './origin-rules';

/**
 * A origem do lead pelo anúncio: gravada uma vez, no primeiro contato que
 * veio com os dados do anúncio (a Meta manda junto com a mensagem). Depois
 * não muda, escreva a pessoa o que escrever. O assunto (implante, prótese,
 * carga imediata) é o que a clínica escolheu para o anúncio ou a campanha na
 * tela Anúncios; sem escolha, o procedimento achado no nome da campanha ou do
 * anúncio. Regras puras em `origin-rules.ts`.
 */

type Topics = Map<string, TopicRule>;
const chave = (scope: 'AD' | 'CAMPAIGN', id: string) => `${scope}:${id}`;

interface Cache {
  info?: Map<string, AdInfo>;
  procedures?: ProcedureLite[];
  topics?: Topics;
}

/** Nome do anúncio e da campanha na Meta, se a clínica conectou a tela Anúncios. Nunca derruba nada. */
export async function adInfoFor(tenantId: string, adIds: readonly string[]): Promise<Map<string, AdInfo>> {
  if (!adIds.length) return new Map();
  try {
    const cred = await adsCredentials(tenantId);
    return cred ? await fetchAdInfo(cred.token, adIds) : new Map();
  } catch {
    return new Map();
  }
}

async function loadTopics(db: TenantPrismaClient): Promise<Topics> {
  const rows = await db.adTopic.findMany({ select: { scope: true, externalId: true, topic: true, procedureId: true } });
  return new Map(rows.map((r) => [chave(r.scope === 'CAMPAIGN' ? 'CAMPAIGN' : 'AD', r.externalId), { topic: r.topic, procedureId: r.procedureId }]));
}

const loadProcedures = (db: TenantPrismaClient) => db.procedure.findMany({ where: { active: true, deletedAt: null }, select: { id: true, name: true } });

/**
 * Grava a origem do anúncio no lead, se ele ainda não tem. Devolve se gravou.
 * O interesse do lead vem do assunto, se ainda estava vazio.
 */
export async function captureOrigin(db: TenantPrismaClient, tenantId: string, leadId: string, rawAd: unknown, at: Date, cache: Cache = {}): Promise<boolean> {
  const meta = adMetaOf(rawAd);
  if (!meta) return false;
  const lead = await db.lead.findFirst({ where: { id: leadId, originAt: null }, select: { id: true } });
  if (!lead) return false;

  const info = meta.adId ? (cache.info ?? (await adInfoFor(tenantId, [meta.adId]))).get(meta.adId) : undefined;
  const [topics, procedures] = await Promise.all([cache.topics ?? loadTopics(db), cache.procedures ?? loadProcedures(db)]);
  const campaignId = info?.campaignId ?? null;
  const assunto = topicFor({
    forAd: meta.adId ? topics.get(chave('AD', meta.adId)) : null,
    forCampaign: campaignId ? topics.get(chave('CAMPAIGN', campaignId)) : null,
    names: [info?.campaignName, info?.name, meta.headline],
    procedures,
  });

  const { count } = await db.lead.updateMany({
    where: { id: leadId, originAt: null },
    data: {
      originAt: at,
      originAdId: meta.adId,
      originCampaignId: campaignId,
      originCampaignName: info?.campaignName ?? null,
      originAdName: info?.name ?? null,
      originHeadline: meta.headline,
      originImageUrl: info?.thumbnailUrl ?? meta.imageUrl,
      originTopic: assunto?.topic ?? null,
    },
  });
  if (count && assunto?.procedureId) {
    await db.lead.updateMany({ where: { id: leadId, interestProcedureId: null }, data: { interestProcedureId: assunto.procedureId } });
  }
  return count > 0;
}

/**
 * Os leads antigos: a origem sai da primeira mensagem com anúncio de cada um.
 * Só preenche as colunas novas, e só de quem ainda não tem.
 */
export async function backfillOrigins(tenantId: string): Promise<number> {
  const db = getTenantClient(tenantId);
  const msgs = await db.chatMessage.findMany({
    where: { origin: 'CONTACT', ad: { not: Prisma.AnyNull }, conversation: { leadId: { not: null }, lead: { is: { originAt: null, deletedAt: null } } } },
    orderBy: { at: 'asc' },
    select: { ad: true, at: true, conversation: { select: { leadId: true } } },
    take: 3000,
  });
  const primeira = new Map<string, { ad: unknown; at: Date }>();
  for (const m of msgs) {
    const leadId = m.conversation.leadId;
    if (leadId && !primeira.has(leadId) && adMetaOf(m.ad)) primeira.set(leadId, { ad: m.ad, at: m.at });
  }
  if (!primeira.size) return 0;
  const ids = [...primeira.values()].map((p) => adMetaOf(p.ad)?.adId).filter((x): x is string => Boolean(x));
  const [info, topics, procedures] = await Promise.all([adInfoFor(tenantId, ids), loadTopics(db), loadProcedures(db)]);
  let n = 0;
  for (const [leadId, p] of primeira) if (await captureOrigin(db, tenantId, leadId, p.ad, p.at, { info, topics, procedures })) n += 1;
  return n;
}

const ultimaVez = new Map<string, number>();
/** O preenchimento dos antigos, no máximo uma vez por hora por clínica neste servidor. */
export async function backfillOriginsSometimes(tenantId: string): Promise<void> {
  const agora = Date.now();
  if ((ultimaVez.get(tenantId) ?? 0) > agora - 3_600_000) return;
  ultimaVez.set(tenantId, agora);
  try {
    await backfillOrigins(tenantId);
    await fillMissingAdNames(tenantId);
  } catch (e) {
    console.error('[crm] origem dos leads antigos falhou', e instanceof Error ? e.message : e);
  }
}

/**
 * Recalcula o assunto dos leads que vieram por anúncio (depois que a clínica
 * escolhe ou tira o assunto de um anúncio ou campanha, ou chegam os nomes da Meta).
 */
async function recomputeTopics(db: TenantPrismaClient, where: Prisma.LeadWhereInput): Promise<number> {
  const leads = await db.lead.findMany({
    where: { ...where, originAt: { not: null }, deletedAt: null },
    select: { id: true, originAdId: true, originCampaignId: true, originCampaignName: true, originAdName: true, originHeadline: true, originTopic: true },
    take: 5000,
  });
  if (!leads.length) return 0;
  const [topics, procedures] = await Promise.all([loadTopics(db), loadProcedures(db)]);
  const grupos = new Map<string, { topic: string | null; procedureId: string | null; ids: string[] }>();
  for (const l of leads) {
    const t = topicFor({
      forAd: l.originAdId ? topics.get(chave('AD', l.originAdId)) : null,
      forCampaign: l.originCampaignId ? topics.get(chave('CAMPAIGN', l.originCampaignId)) : null,
      names: [l.originCampaignName, l.originAdName, l.originHeadline],
      procedures,
    });
    const topic = t?.topic ?? null;
    if (topic === l.originTopic && !t?.procedureId) continue;
    const k = `${topic ?? ''}|${t?.procedureId ?? ''}`;
    const g = grupos.get(k) ?? { topic, procedureId: t?.procedureId ?? null, ids: [] };
    g.ids.push(l.id);
    grupos.set(k, g);
  }
  let n = 0;
  for (const g of grupos.values()) {
    n += (await db.lead.updateMany({ where: { id: { in: g.ids } }, data: { originTopic: g.topic } })).count;
    if (g.procedureId) await db.lead.updateMany({ where: { id: { in: g.ids }, interestProcedureId: null }, data: { interestProcedureId: g.procedureId } });
  }
  return n;
}

/** Os nomes da Meta para os leads que chegaram antes de a tela Anúncios ser conectada. */
export async function fillMissingAdNames(tenantId: string): Promise<number> {
  const db = getTenantClient(tenantId);
  const sem = await db.lead.findMany({ where: { originAdId: { not: null }, originCampaignId: null, deletedAt: null }, distinct: ['originAdId'], select: { originAdId: true }, take: 300 });
  const ids = sem.map((s) => s.originAdId!).filter(Boolean);
  if (!ids.length) return 0;
  const info = await adInfoFor(tenantId, ids);
  if (!info.size) return 0;
  for (const [adId, i] of info) {
    await db.lead.updateMany({
      where: { originAdId: adId, originCampaignId: null },
      data: { originCampaignId: i.campaignId, originCampaignName: i.campaignName, originAdName: i.name, ...(i.thumbnailUrl ? { originImageUrl: i.thumbnailUrl } : {}) },
    });
  }
  return recomputeTopics(db, { originAdId: { in: [...info.keys()] } });
}

export interface AdOriginRow {
  adId: string;
  adName: string | null;
  headline: string | null;
  imageUrl: string | null;
  campaignId: string | null;
  campaignName: string | null;
  leads: number;
  topic: string | null;
  /** De onde saiu o assunto: escolhido no anúncio, na campanha, achado no nome, ou nenhum. */
  topicFrom: 'AD' | 'CAMPAIGN' | 'AUTO' | null;
}

/** Os anúncios que trouxeram leads, com o assunto de cada um (tela Anúncios). */
export async function adOrigins(tenantId: string): Promise<AdOriginRow[]> {
  const db = getTenantClient(tenantId);
  const [porAnuncio, fichas, topics, procedures] = await Promise.all([
    db.lead.groupBy({ by: ['originAdId'], where: { originAdId: { not: null }, deletedAt: null }, _count: true }),
    db.lead.findMany({
      where: { originAdId: { not: null }, deletedAt: null },
      distinct: ['originAdId'],
      orderBy: { originAt: 'desc' },
      select: { originAdId: true, originAdName: true, originHeadline: true, originImageUrl: true, originCampaignId: true, originCampaignName: true, originAt: true },
      take: 300,
    }),
    loadTopics(db),
    loadProcedures(db),
  ]);
  const quantos = new Map(porAnuncio.map((g) => [g.originAdId!, g._count]));
  return fichas
    .map((f) => {
      const t = topicFor({
        forAd: topics.get(chave('AD', f.originAdId!)),
        forCampaign: f.originCampaignId ? topics.get(chave('CAMPAIGN', f.originCampaignId)) : null,
        names: [f.originCampaignName, f.originAdName, f.originHeadline],
        procedures,
      });
      return {
        adId: f.originAdId!,
        adName: f.originAdName,
        headline: f.originHeadline,
        imageUrl: f.originImageUrl,
        campaignId: f.originCampaignId,
        campaignName: f.originCampaignName,
        leads: quantos.get(f.originAdId!) ?? 0,
        topic: t?.topic ?? null,
        topicFrom: t?.from ?? null,
      };
    })
    .sort((a, b) => b.leads - a.leads);
}

/** A clínica escolhe (ou tira, com assunto vazio) o assunto de um anúncio ou campanha. */
export async function setAdTopic(
  tenantId: string,
  input: { scope: 'AD' | 'CAMPAIGN'; externalId: string; topic: string; procedureId: string | null },
): Promise<{ ok: true; leads: number } | { ok: false; message: string }> {
  if (!/^\d{5,25}$/.test(input.externalId)) return { ok: false, message: 'Anúncio desconhecido.' };
  const db = getTenantClient(tenantId);
  const topic = cleanTopic(input.topic);
  let procedureId: string | null = null;
  if (input.procedureId) {
    const p = await db.procedure.findFirst({ where: { id: input.procedureId, deletedAt: null }, select: { id: true } });
    if (!p) return { ok: false, message: 'Procedimento não encontrado.' };
    procedureId = p.id;
  }
  const existente = await db.adTopic.findFirst({ where: { scope: input.scope, externalId: input.externalId }, select: { id: true } });
  if (!topic) {
    if (existente) await db.adTopic.deleteMany({ where: { id: existente.id } });
  } else if (existente) {
    await db.adTopic.updateMany({ where: { id: existente.id }, data: { topic, procedureId } });
  } else {
    try {
      await db.adTopic.create({ data: { tenantId, scope: input.scope, externalId: input.externalId, topic, procedureId } });
    } catch {
      await db.adTopic.updateMany({ where: { scope: input.scope, externalId: input.externalId }, data: { topic, procedureId } });
    }
  }
  const leads = await recomputeTopics(db, input.scope === 'AD' ? { originAdId: input.externalId } : { originCampaignId: input.externalId });
  return { ok: true, leads };
}

/** As opções dos filtros do funil: campanhas, anúncios e assuntos que já trouxeram leads. */
export async function originFilterOptions(db: TenantPrismaClient): Promise<{
  campaigns: { id: string; name: string }[];
  ads: { id: string; name: string }[];
  topics: string[];
}> {
  const [camp, ads, topics] = await Promise.all([
    db.lead.findMany({ where: { originCampaignId: { not: null }, deletedAt: null }, distinct: ['originCampaignId'], select: { originCampaignId: true, originCampaignName: true }, take: 200 }),
    db.lead.findMany({ where: { originAdId: { not: null }, deletedAt: null }, distinct: ['originAdId'], select: { originAdId: true, originAdName: true, originHeadline: true }, take: 300 }),
    db.lead.findMany({ where: { originTopic: { not: null }, deletedAt: null }, distinct: ['originTopic'], select: { originTopic: true }, take: 100 }),
  ]);
  return {
    campaigns: camp.map((c) => ({ id: c.originCampaignId!, name: c.originCampaignName ?? `Campanha ${c.originCampaignId}` })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    ads: ads.map((a) => ({ id: a.originAdId!, name: a.originAdName ?? a.originHeadline ?? `Anúncio ${a.originAdId}` })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    topics: topics.map((t) => t.originTopic!).sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}
