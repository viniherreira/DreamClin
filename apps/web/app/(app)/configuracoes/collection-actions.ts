'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, type Prisma } from '@clinicaiq/db';
import { collectionHistory, collectionTemplateViews, submitCollectionTemplate, type CollectionTemplateView, type DispatchRow } from '@/fin/collection';
import { finRead, finWrite } from '@/fin/guard';
import { activeCloudAccount } from '@/lib/cloud-account';
import { DEFAULT_COLLECTION_TEXT, type CollectionPurpose } from '@/lib/financeiro/collection';
import { cleanFinanceSettings, readFinanceSettings } from '@/lib/financeiro/settings';

/**
 * Configurações › Financeiro › Régua de cobrança. Mandar um modelo para a Meta
 * aprovar só acontece quando o dono clica (nunca sozinho).
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export interface CollectionConfig {
  enabled: boolean;
  daysBefore: number;
  onDueDay: boolean;
  daysAfter: number[];
  connected: boolean;
  templates: Record<CollectionPurpose, CollectionTemplateView & { draft: string }>;
  history: DispatchRow[];
}

export async function collectionConfig(): Promise<CollectionConfig | null> {
  const g = await finRead('fin_config');
  if (!g.ok) return null;
  const { tenantId, settings: s } = g.ctx;
  const [views, history, conta] = await Promise.all([collectionTemplateViews(tenantId), collectionHistory(tenantId), activeCloudAccount(tenantId)]);
  const comRascunho = (p: CollectionPurpose) => ({ ...views[p], draft: views[p].text ?? DEFAULT_COLLECTION_TEXT[p] });
  return {
    enabled: s.collectionEnabled,
    daysBefore: s.collectionDaysBefore,
    onDueDay: s.collectionOnDueDay,
    daysAfter: s.collectionDaysAfter,
    connected: Boolean(conta),
    templates: { COLLECTION_REMINDER: comRascunho('COLLECTION_REMINDER'), COLLECTION_OVERDUE: comRascunho('COLLECTION_OVERDUE') },
    history,
  };
}

const rulesSchema = z.object({
  enabled: z.boolean(),
  daysBefore: z.number().int().min(0).max(30),
  onDueDay: z.boolean(),
  daysAfter: z.array(z.number().int().min(1).max(90)).max(3),
});

export async function saveCollectionRules(input: z.input<typeof rulesSchema>): Promise<Result> {
  const g = await finWrite('fin_config');
  if (!g.ok) return g;
  const p = rulesSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Confira os dias: antes vai de 0 a 30, depois de 1 a 90 (até três).' };
  const { tenantId, userId, db } = g.ctx;
  // `Tenant` não passa pelo filtro de clínica: o id vem da sessão, nunca do formulário.
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const atual = (tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {}) as Record<string, unknown>;
  const novo = cleanFinanceSettings({ ...readFinanceSettings(atual), collectionEnabled: p.data.enabled, collectionDaysBefore: p.data.daysBefore, collectionOnDueDay: p.data.onDueDay, collectionDaysAfter: p.data.daysAfter });
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: { ...atual, finance: novo } as unknown as Prisma.InputJsonValue } });
  await db.auditLog.create({ data: { tenantId, userId, action: 'UPDATE', entity: 'CollectionRules', entityId: tenantId, metadata: { ligada: p.data.enabled } } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

/** O dono clicou em "Mandar para a Meta aprovar". */
export async function submitCollectionTemplateAction(purpose: CollectionPurpose, text: string): Promise<Result<{ submitted: boolean }>> {
  const g = await finWrite('fin_config');
  if (!g.ok) return g;
  if (purpose !== 'COLLECTION_REMINDER' && purpose !== 'COLLECTION_OVERDUE') return { ok: false, message: 'Mensagem desconhecida.' };
  const r = await submitCollectionTemplate(g.ctx.tenantId, purpose, text.slice(0, 1000));
  if (!r.ok) return r;
  await g.ctx.db.auditLog.create({ data: { tenantId: g.ctx.tenantId, userId: g.ctx.userId, action: 'TEMPLATE_SUBMIT', entity: 'MessageTemplate', entityId: purpose, metadata: { mandado: r.submitted } } });
  revalidatePath('/configuracoes');
  return { ok: true, submitted: r.submitted };
}
