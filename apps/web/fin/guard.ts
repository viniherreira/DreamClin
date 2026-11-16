import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getTenantClient, prisma, type TenantPrismaClient } from '@clinicaiq/db';
import { writeBlocked } from '@/lib/access';
import { currentAccess } from '@/lib/guard';
import type { Role } from '@/lib/permissions';
import { finCan, finDeniedMessage, NO_USER_PERMISSION, type FinCapability, type FinUserPermission } from '@/lib/financeiro/access';
import { readFinanceSettings, type FinanceSettings } from '@/lib/financeiro/settings';
import { financeEnabled } from './flag';

/**
 * A porta do financeiro novo. Toda página e toda Server Action passa por aqui:
 * confere o login, a bandeira da clínica, o perfil e as permissões financeiras
 * do usuário. As ações que gravam conferem também se a conta pode gravar.
 */

export interface FinContext {
  tenantId: string;
  userId: string;
  role: Role;
  db: TenantPrismaClient;
  permission: FinUserPermission;
  settings: FinanceSettings;
  can: (capability: FinCapability) => boolean;
}

const loadExtras = cache(async (tenantId: string, userId: string) => {
  const [perm, tenant] = await Promise.all([
    prisma.financialPermission.findFirst({ where: { tenantId, userId } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
  ]);
  const permission: FinUserPermission = perm
    ? {
        maxDiscountPercent: perm.maxDiscountPercent == null ? null : Number(perm.maxDiscountPercent),
        operation: perm.operation === 'RECEIVE' || perm.operation === 'PAY' ? perm.operation : 'BOTH',
        accountIds: perm.accountIds,
        canReverse: perm.canReverse,
        canSeeReports: perm.canSeeReports,
      }
    : NO_USER_PERMISSION;
  return { permission, settings: readFinanceSettings(tenant?.settings) };
});

/** Quem está logado, já com as permissões financeiras. Nulo sem login ou sem a bandeira. */
export async function finContext(): Promise<FinContext | null> {
  const acesso = await currentAccess();
  if (!acesso) return null;
  if (!(await financeEnabled(acesso.tenantId))) return null;
  const { permission, settings } = await loadExtras(acesso.tenantId, acesso.userId);
  const input = { role: acesso.role, permission, professionalSeesCommissions: settings.professionalSeesCommissions };
  return {
    ...acesso,
    db: getTenantClient(acesso.tenantId),
    permission,
    settings,
    can: (capability) => finCan(input, capability),
  };
}

/** Guarda das páginas: manda para o login, para o financeiro antigo ou para a tela de "sem acesso". */
export async function requireFinance(capability: FinCapability): Promise<FinContext> {
  const acesso = await currentAccess();
  if (!acesso) redirect('/sign-in');
  const ctx = await finContext();
  if (!ctx) redirect('/financeiro');
  if (!ctx.can(capability)) redirect(`/sem-acesso?modulo=financeiro`);
  return ctx;
}

export type FinGate = { ok: true; ctx: FinContext } | { ok: false; message: string };

/** Guarda das Server Actions que só leem. */
export async function finRead(capability: FinCapability): Promise<FinGate> {
  const ctx = await finContext();
  if (!ctx) return { ok: false, message: 'O financeiro completo não está disponível nesta conta.' };
  if (!ctx.can(capability)) return { ok: false, message: finDeniedMessage(capability) };
  return { ok: true, ctx };
}

/** Guarda das Server Actions que gravam: além do perfil, a conta precisa poder gravar. */
export async function finWrite(capability: FinCapability): Promise<FinGate> {
  const gate = await finRead(capability);
  if (!gate.ok) return gate;
  const bloqueio = await writeBlocked(gate.ctx.tenantId);
  if (bloqueio) return { ok: false, message: bloqueio };
  return gate;
}
