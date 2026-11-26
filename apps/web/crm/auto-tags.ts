import { prisma, type LeadSource, type TenantPrismaClient } from '@clinicaiq/db';
import { readCrmPrefs } from './crm-prefs';
import { CHANNEL_TAG, CHANNEL_TAG_NAMES, matchProcedures, procedureForTag, sameTag } from './auto-tags-rules';
import type { CrmColor } from './defaults';

/**
 * Tags automáticas no lead (Configurações › Geral › "Tags automáticas"):
 *
 * - **Canal de entrada**: todo lead novo ganha a tag de onde veio (whatsapp,
 *   instagram, facebook, site, indicação). Quando a origem fica mais precisa
 *   (chegou pelo WhatsApp, mas a Meta disse que era de anúncio do Instagram),
 *   a tag genérica sai e entra a certa.
 * - **Procedimento**: o que a pessoa escreve na conversa (e o texto do anúncio)
 *   vira tag: implante, clareamento, aparelho… O primeiro procedimento achado
 *   que a clínica tem cadastrado vira o interesse do lead, se ainda não tiver.
 *
 * Regras puras em `auto-tags-rules.ts`.
 */

/** As preferências da clínica dizem se as tags automáticas estão ligadas. */
export async function autoTagsOn(tenantId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return readCrmPrefs(t?.settings).autoTags;
}

/** A tag com esse nome (acento, hífen e maiúscula não contam: `tagKey`), ou cria. */
export async function ensureTag(db: TenantPrismaClient, tenantId: string, name: string, color: CrmColor): Promise<string> {
  const achar = async () => sameTag(await db.leadTag.findMany({ select: { id: true, name: true } }), name);
  const tem = await achar();
  if (tem) return tem.id;
  try {
    return (await db.leadTag.create({ data: { tenantId, name, color }, select: { id: true } })).id;
  } catch {
    // Duas mensagens ao mesmo tempo: a outra criou.
    const outra = await achar();
    if (!outra) throw new Error(`tag ${name} não criada`);
    return outra.id;
  }
}

/** Põe a tag no lead e registra no histórico (só se ela ainda não estava). */
async function tagLead(db: TenantPrismaClient, tenantId: string, leadId: string, tagId: string): Promise<boolean> {
  const { count } = await db.leadTagOnLead.createMany({ data: [{ tenantId, leadId, tagId }], skipDuplicates: true });
  if (count) await db.leadActivity.create({ data: { tenantId, leadId, type: 'TAG_ADDED', actorId: null, data: { tagId } } });
  return count > 0;
}

/**
 * A tag do canal de entrada. As outras tags de canal que o lead tiver saem
 * (o lead tem um canal só): "whatsapp" dá lugar a "instagram" quando o
 * anúncio aparece.
 */
export async function applyChannelTag(db: TenantPrismaClient, tenantId: string, leadId: string, source: LeadSource): Promise<void> {
  const canal = CHANNEL_TAG[source];
  if (!canal) return;
  const tagId = await ensureTag(db, tenantId, canal.name, canal.color);
  const outras = await db.leadTag.findMany({
    where: { id: { not: tagId }, OR: CHANNEL_TAG_NAMES.map((n) => ({ name: { equals: n, mode: 'insensitive' as const } })) },
    select: { id: true },
  });
  if (outras.length) await db.leadTagOnLead.deleteMany({ where: { leadId, tagId: { in: outras.map((t) => t.id) } } });
  await tagLead(db, tenantId, leadId, tagId);
}

/** A tag de canal do lead recém-criado, se a clínica deixou ligado. Nunca derruba a criação. */
export async function channelTagForNewLead(db: TenantPrismaClient, tenantId: string, leadId: string, source: LeadSource): Promise<void> {
  try {
    if (CHANNEL_TAG[source] && (await autoTagsOn(tenantId))) await applyChannelTag(db, tenantId, leadId, source);
  } catch (e) {
    console.error('[crm] tag de canal falhou', e instanceof Error ? e.message : e);
  }
}

/**
 * Os procedimentos citados no texto viram tags do lead; o primeiro que a
 * clínica tem cadastrado vira o interesse, se o lead ainda não tem um.
 * Devolve as tags novas (para teste e para o histórico).
 */
export async function applyProcedureTags(db: TenantPrismaClient, tenantId: string, leadId: string, text: string): Promise<string[]> {
  if (!text.trim()) return [];
  const procedures = await db.procedure.findMany({ where: { active: true, deletedAt: null }, select: { id: true, name: true } });
  const achados = matchProcedures(text, procedures);
  if (!achados.length) return [];

  const novas: string[] = [];
  for (const a of achados) {
    const tagId = await ensureTag(db, tenantId, a.tag, 'violet');
    if (await tagLead(db, tenantId, leadId, tagId)) novas.push(a.tag);
  }

  const interesse = achados.find((a) => a.procedureId)?.procedureId;
  if (interesse) {
    await db.lead.updateMany({ where: { id: leadId, interestProcedureId: null }, data: { interestProcedureId: interesse } });
  }
  if (novas.length) {
    const lista = achados.filter((a) => novas.includes(a.tag)).map((a) => `“${a.word}”`).join(', ');
    await db.leadActivity.create({
      data: { tenantId, leadId, type: 'NOTE', actorId: null, data: { text: `Tags automáticas: a pessoa falou em ${lista}.` } },
    });
  }
  return novas;
}

/**
 * A tag de procedimento preenche o interesse do lead, se ainda estiver vazio:
 * pôr "implante" na mão, por automação, robô ou planilha dá ao lead o
 * interesse no procedimento de implante da clínica. Nunca troca um interesse
 * que já existe e nunca derruba quem chamou.
 */
export async function fillInterestFromTags(db: TenantPrismaClient, leadId: string, tagIds: readonly string[]): Promise<void> {
  if (!tagIds.length) return;
  try {
    const lead = await db.lead.findFirst({ where: { id: leadId, interestProcedureId: null }, select: { id: true } });
    if (!lead) return;
    const [tags, procedures] = await Promise.all([
      db.leadTag.findMany({ where: { id: { in: [...tagIds] } }, select: { id: true, name: true } }),
      db.procedure.findMany({ where: { active: true, deletedAt: null }, select: { id: true, name: true } }),
    ]);
    if (!procedures.length) return;
    // Na ordem em que vieram: a primeira tag que é procedimento decide.
    for (const id of tagIds) {
      const tag = tags.find((t) => t.id === id);
      const proc = tag ? procedureForTag(tag.name, procedures) : null;
      if (proc) {
        await db.lead.updateMany({ where: { id: leadId, interestProcedureId: null }, data: { interestProcedureId: proc } });
        return;
      }
    }
  } catch (e) {
    console.error('[crm] interesse pela tag falhou', e instanceof Error ? e.message : e);
  }
}

/**
 * O assunto do anúncio ("Implante") vira a tag do procedimento nos leads que
 * vieram por ele, a mesma tag que a conversa põe: um filtro só acha os dois.
 * Respeita a chave das tags automáticas. Nunca derruba quem chamou.
 */
export async function tagAdTopic(db: TenantPrismaClient, tenantId: string, leadIds: readonly string[], topic: string): Promise<void> {
  const nome = topic.trim().toLowerCase().slice(0, 30);
  if (!nome || !leadIds.length) return;
  try {
    if (!(await autoTagsOn(tenantId))) return;
    const tagId = await ensureTag(db, tenantId, nome, 'violet');
    for (const leadId of leadIds) {
      if (await tagLead(db, tenantId, leadId, tagId)) await fillInterestFromTags(db, leadId, [tagId]);
    }
  } catch (e) {
    console.error('[crm] tag do assunto do anúncio falhou', e instanceof Error ? e.message : e);
  }
}

