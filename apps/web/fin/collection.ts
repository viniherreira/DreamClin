import 'server-only';

import { decrypt, getTenantClient, prisma } from '@clinicaiq/db';
import { CloudApiError } from '@clinicaiq/whatsapp';
import { activeCloudAccount, cloudClient } from '@/lib/cloud-account';
import { META_TEMPLATE_STATUS } from '@/lib/agenda-templates-sync';
import {
  COLLECTION_KEYS,
  COLLECTION_TEMPLATE_PREFIX,
  collectionParams,
  collectionTemplateName,
  collectionTemplateVersion,
  dueDatesFor,
  fillCollection,
  stepFor,
  toCollectionTemplate,
  type CollectionKey,
  type CollectionPurpose,
} from '@/lib/financeiro/collection';
import { addDays, dateToDay, dayBR, dayToDate, type Day } from '@/lib/financeiro/dates';
import { formatCents, toCents } from '@/lib/financeiro/money';
import { readFinanceSettings } from '@/lib/financeiro/settings';
import { normalizeBrazilPhone } from '@/lib/phone';
import { sendCollectionTemplate, type CollectionSend } from '@/lib/whatsapp';

/**
 * Régua de cobrança pelo WhatsApp oficial: lembrete antes e no dia do
 * vencimento, cobrança depois, com os modelos que a clínica mandou a Meta
 * aprovar. Roda no cron de lembretes (9h de Brasília). Respeita quem pediu
 * para não receber mensagens. Cada aviso de cada conta sai uma vez só.
 */

export interface ApprovedCollectionTemplate {
  name: string;
  language: string;
  body: string;
  varKeys: CollectionKey[];
}

const lerChaves = (v: unknown): CollectionKey[] | null => (Array.isArray(v) && v.every((k) => (COLLECTION_KEYS as readonly string[]).includes(k)) ? (v as CollectionKey[]) : null);

export async function approvedCollectionTemplate(tenantId: string, purpose: CollectionPurpose): Promise<ApprovedCollectionTemplate | null> {
  const t = await getTenantClient(tenantId).messageTemplate.findFirst({ where: { purpose, status: 'APPROVED' }, orderBy: { createdAt: 'desc' }, select: { name: true, language: true, body: true, varKeys: true } });
  const chaves = t ? lerChaves(t.varKeys) : null;
  return t && chaves ? { name: t.name, language: t.language, body: t.body, varKeys: chaves } : null;
}

export interface CollectionTemplateView {
  status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  text: string | null;
  rejectedReason: string | null;
  approvedName: string | null;
}

/** A situação do modelo de cada aviso, para a tela de configuração. */
export async function collectionTemplateViews(tenantId: string): Promise<Record<CollectionPurpose, CollectionTemplateView>> {
  const db = getTenantClient(tenantId);
  const out = {} as Record<CollectionPurpose, CollectionTemplateView>;
  for (const p of ['COLLECTION_REMINDER', 'COLLECTION_OVERDUE'] as const) {
    const [ultimo, aprovado] = await Promise.all([
      db.messageTemplate.findFirst({ where: { purpose: p }, orderBy: { createdAt: 'desc' }, select: { status: true, sourceText: true, rejectedReason: true } }),
      db.messageTemplate.findFirst({ where: { purpose: p, status: 'APPROVED' }, orderBy: { createdAt: 'desc' }, select: { name: true } }),
    ]);
    out[p] = { status: (ultimo?.status as CollectionTemplateView['status']) ?? 'NONE', text: ultimo?.sourceText ?? null, rejectedReason: ultimo?.rejectedReason ?? null, approvedName: aprovado?.name ?? null };
  }
  return out;
}

/**
 * Manda o texto da clínica para a Meta aprovar, como versão nova do modelo.
 * Só roda quando o dono clica para mandar (Configurações › Financeiro ›
 * Régua de cobrança). Não manda de novo um texto igual ao último.
 */
export async function submitCollectionTemplate(tenantId: string, purpose: CollectionPurpose, text: string): Promise<{ ok: true; submitted: boolean } | { ok: false; message: string }> {
  const conta = await activeCloudAccount(tenantId);
  if (!conta) return { ok: false, message: 'Conecte a API oficial do WhatsApp primeiro (tela WhatsApp).' };
  const draft = toCollectionTemplate(text);
  if (!draft.ok) return draft;
  const fonte = text.trim();
  const db = getTenantClient(tenantId);
  const ultimo = await db.messageTemplate.findFirst({ where: { purpose }, orderBy: { createdAt: 'desc' }, select: { sourceText: true, status: true } });
  if (ultimo?.sourceText === fonte && ultimo.status !== 'REJECTED') return { ok: true, submitted: false };
  const nomes = await db.messageTemplate.findMany({ where: { name: { startsWith: `${COLLECTION_TEMPLATE_PREFIX[purpose]}_` } }, select: { name: true } });
  let versao = Math.max(0, ...nomes.map((n) => collectionTemplateVersion(purpose, n.name) ?? 0)) + 1;
  const api = cloudClient(conta);
  for (let tentativa = 0; tentativa < 3; tentativa++, versao++) {
    const name = collectionTemplateName(purpose, versao);
    try {
      const r = await api.createTemplate({ name, category: 'UTILITY', language: 'pt_BR', body: draft.body, examples: draft.examples, quickReplies: [] });
      const values = { category: 'UTILITY' as const, status: META_TEMPLATE_STATUS[r.status] ?? ('PENDING' as const), body: draft.body, variables: draft.varKeys.length, externalId: r.id, rejectedReason: null, purpose, varKeys: draft.varKeys, sourceText: fonte };
      // O modelo da clínica é guardado pelo nome (o mesmo nome volta só se a Meta recusou o anterior).
      const existente = await db.messageTemplate.findFirst({ where: { name, language: 'pt_BR' }, select: { id: true } });
      if (existente) await db.messageTemplate.updateMany({ where: { id: existente.id }, data: values });
      else await db.messageTemplate.create({ data: { tenantId, name, language: 'pt_BR', ...values } });
      return { ok: true, submitted: true };
    } catch (e) {
      if (e instanceof CloudApiError && /already exists|já existe/i.test(e.message)) continue;
      return { ok: false, message: e instanceof CloudApiError ? e.userMessage : 'Não foi possível falar com a Meta.' };
    }
  }
  return { ok: false, message: 'A Meta não aceitou o nome do modelo. Tente de novo daqui a pouco.' };
}

export type CollectionSender = (m: CollectionSend) => Promise<{ ok: boolean; messageId: string | null; error?: string }>;

/** Roda a régua de uma clínica para hoje. Devolve quantos avisos saíram, pularam ou falharam. */
export async function runCollectionsForTenant(tenantId: string, today: Day, send: CollectionSender = sendCollectionTemplate): Promise<{ sent: number; skipped: number; failed: number }> {
  const db = getTenantClient(tenantId);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, settings: true } });
  const s = readFinanceSettings(tenant?.settings);
  const regra = { enabled: s.collectionEnabled, daysBefore: s.collectionDaysBefore, onDueDay: s.collectionOnDueDay, daysAfter: s.collectionDaysAfter };
  const datas = dueDatesFor(today, regra, addDays);
  const out = { sent: 0, skipped: 0, failed: 0 };
  if (!datas.length) return out;

  const [lembrete, atraso] = await Promise.all([approvedCollectionTemplate(tenantId, 'COLLECTION_REMINDER'), approvedCollectionTemplate(tenantId, 'COLLECTION_OVERDUE')]);
  const titulos = await db.financialTitle.findMany({
    where: { direction: 'RECEIVABLE', status: { in: ['OPEN', 'PARTIAL'] }, patientId: { not: null }, dueDate: { in: datas.map(dayToDate) } },
    select: { id: true, dueDate: true, amount: true, paidAmount: true, patient: { select: { id: true, name: true, phoneEncrypted: true, whatsappOptOut: true, active: true, deletedAt: true } } },
    take: 2000,
  });
  const chave = process.env.ENCRYPTION_MASTER_KEY ?? '';

  for (const t of titulos) {
    const p = t.patient;
    if (!p || !p.active || p.deletedAt) continue;
    const passo = stepFor(dateToDay(t.dueDate), today, regra);
    if (!passo) continue;
    // Uma linha por conta e passo: se já existe, este aviso já saiu (ou já foi registrado por que não saiu).
    const ja = await db.collectionDispatch.findFirst({ where: { titleId: t.id, step: passo.step }, select: { id: true } });
    if (ja) continue;
    const marca = async (status: 'SENT' | 'SKIPPED' | 'FAILED', reason: string | null, messageId: string | null) => {
      try {
        await db.collectionDispatch.create({ data: { tenantId, titleId: t.id, patientId: p.id, step: passo.step, status, reason, messageId } });
      } catch {
        // Outra execução registrou ao mesmo tempo: vale a dela.
      }
    };
    if (p.whatsappOptOut) {
      await marca('SKIPPED', 'O paciente pediu para não receber mensagens.', null);
      out.skipped += 1;
      continue;
    }
    let telefone = '';
    try {
      telefone = normalizeBrazilPhone(decrypt(p.phoneEncrypted, chave, tenantId)) ?? '';
    } catch {
      telefone = '';
    }
    if (!telefone) {
      await marca('SKIPPED', 'Paciente sem WhatsApp válido no cadastro.', null);
      out.skipped += 1;
      continue;
    }
    const modelo = passo.purpose === 'COLLECTION_REMINDER' ? lembrete : atraso;
    if (!modelo) {
      await marca('SKIPPED', 'O modelo desta mensagem ainda não foi aprovado pela Meta.', null);
      out.skipped += 1;
      continue;
    }
    const aberto = Math.max(0, toCents(t.amount) - toCents(t.paidAmount));
    const params = collectionParams(modelo.varKeys, { nome: p.name.split(' ')[0], valor: formatCents(aberto), vencimento: dayBR(dateToDay(t.dueDate)), clinica: tenant?.name ?? '' });
    const r = await send({ tenantId, patientId: p.id, to: telefone, templateName: modelo.name, language: modelo.language, params, content: fillCollection(modelo.body, params) });
    await marca(r.ok ? 'SENT' : 'FAILED', r.ok ? null : (r.error ?? 'Falhou'), r.messageId);
    if (r.ok) out.sent += 1;
    else out.failed += 1;
  }
  return out;
}

export interface DispatchRow {
  id: string;
  at: string;
  step: string;
  patientName: string;
  status: string;
  reason: string | null;
  delivery: string | null;
}

/** O histórico da régua: o que saiu, o que pulou e por quê, e a situação da mensagem no WhatsApp. */
export async function collectionHistory(tenantId: string): Promise<DispatchRow[]> {
  const db = getTenantClient(tenantId);
  const linhas = await db.collectionDispatch.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const [pacientes, mensagens] = await Promise.all([
    db.patient.findMany({ where: { id: { in: [...new Set(linhas.map((l) => l.patientId))] } }, select: { id: true, name: true } }),
    db.whatsAppMessage.findMany({ where: { id: { in: linhas.map((l) => l.messageId).filter((x): x is string => Boolean(x)) } }, select: { id: true, status: true, errorMessage: true } }),
  ]);
  const nome = new Map(pacientes.map((p) => [p.id, p.name]));
  const msg = new Map(mensagens.map((m) => [m.id, m]));
  return linhas.map((l) => ({
    id: l.id,
    at: l.createdAt.toISOString(),
    step: l.step,
    patientName: nome.get(l.patientId) ?? '',
    status: l.status,
    reason: l.reason ?? (l.messageId ? (msg.get(l.messageId)?.errorMessage ?? null) : null),
    delivery: l.messageId ? (msg.get(l.messageId)?.status ?? null) : null,
  }));
}
