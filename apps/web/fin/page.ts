import 'server-only';

import { financeAdvanced } from './flag';
import { requireFinance, type FinContext } from './guard';
import { ensureLegacyMigrated } from './quotes';
import { ensureFinanceSetup } from './setup';
import type { FinCapability } from '@/lib/financeiro/access';

/**
 * O começo de toda página do financeiro: confere o acesso, garante o preparo
 * da clínica (contas, categorias, formas e a cópia do financeiro antigo) e
 * devolve o que as abas do topo precisam.
 */
export async function finPage(capability: FinCapability): Promise<{
  ctx: FinContext;
  advanced: boolean;
  nav: { reverse: boolean; pendingReleases: number };
}> {
  const ctx = await requireFinance(capability);
  await ensureFinanceSetup(ctx.tenantId);
  await ensureLegacyMigrated(ctx.tenantId);
  const reverse = ctx.can('fin_estornar');
  const [advanced, pendingReleases] = await Promise.all([
    financeAdvanced(ctx.tenantId),
    reverse && (ctx.role === 'OWNER' || ctx.role === 'ADMIN') ? ctx.db.financialRelease.count({ where: { status: 'PENDING', expiresAt: { gt: new Date() } } }) : 0,
  ]);
  return { ctx, advanced, nav: { reverse, pendingReleases } };
}
