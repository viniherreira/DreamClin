'use server';

import { financeAdvanced } from '@/fin/flag';
import { finRead, type FinContext } from '@/fin/guard';
import { ensureLegacyMigrated } from '@/fin/quotes';
import { aging, cashFlow, costCenterReport, dre, dreEntries, overview, proceduresReport } from '@/fin/reports';
import { ensureFinanceSetup } from '@/fin/setup';
import { isDay, type Day } from '@/lib/financeiro/dates';
import { isDreLine } from '@/lib/financeiro/dre';
import { clinicToday } from '@/lib/tz';

/**
 * Ações dos relatórios. Todos pedem `fin_relatorios` (dono e administrador,
 * ou quem recebeu a permissão). DRE, fluxo de caixa e centros de custo são dos
 * planos com relatórios completos: no plano menor, devolvem `locked`.
 */

type Locked = { locked: true };

async function gate(advanced = false): Promise<{ ctx: FinContext } | null | Locked> {
  const g = await finRead('fin_relatorios');
  if (!g.ok) return null;
  await ensureFinanceSetup(g.ctx.tenantId);
  await ensureLegacyMigrated(g.ctx.tenantId);
  if (advanced && !(await financeAdvanced(g.ctx.tenantId))) return { locked: true };
  return { ctx: g.ctx };
}

const periodo = (from: string, to: string) => (isDay(from) && isDay(to) && from <= to ? { from: from as Day, to: to as Day } : null);

export async function overviewAction(from: string, to: string) {
  const g = await gate();
  const p = periodo(from, to);
  if (!g || 'locked' in g || !p) return null;
  return overview(g.ctx, p.from, p.to, clinicToday() as Day);
}

export async function cashFlowAction(from: string, to: string, accountId?: string, weekly?: boolean) {
  const g = await gate(true);
  if (!g) return null;
  if ('locked' in g) return g;
  const p = periodo(from, to);
  if (!p) return null;
  return cashFlow(g.ctx, p.from, p.to, { accountId: accountId || null, weekly });
}

export async function dreAction(from: string, to: string) {
  const g = await gate(true);
  if (!g) return null;
  if ('locked' in g) return g;
  const p = periodo(from, to);
  if (!p) return null;
  return dre(g.ctx, p.from, p.to);
}

export async function dreEntriesAction(from: string, to: string, line: string) {
  const g = await gate(true);
  const p = periodo(from, to);
  if (!g || 'locked' in g || !p || !isDreLine(line)) return [];
  return dreEntries(g.ctx, p.from, p.to, line);
}

export async function agingAction() {
  const g = await gate();
  if (!g || 'locked' in g) return null;
  return aging(g.ctx, clinicToday() as Day);
}

export async function proceduresAction(from: string, to: string) {
  const g = await gate();
  const p = periodo(from, to);
  if (!g || 'locked' in g || !p) return null;
  return proceduresReport(g.ctx, p.from, p.to);
}

export async function costCentersAction(from: string, to: string) {
  const g = await gate(true);
  if (!g) return null;
  if ('locked' in g) return g;
  const p = periodo(from, to);
  if (!p) return null;
  return costCenterReport(g.ctx, p.from, p.to);
}
