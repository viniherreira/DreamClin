import { can, isRole, type Capability, type Role } from '../permissions';

/**
 * Quem pode o quê no financeiro novo: o perfil (`lib/permissions.ts`) e, por
 * cima, as permissões financeiras do usuário (`FinancialPermission`).
 * Puro e testado em `access.test.ts`.
 */

export type FinCapability = Extract<Capability, `fin_${string}`>;

export interface FinUserPermission {
  /** Limite de desconto em %. Nulo = o padrão da clínica. */
  maxDiscountPercent: number | null;
  operation: 'RECEIVE' | 'PAY' | 'BOTH';
  /** Contas liberadas. Vazio = todas. */
  accountIds: string[];
  /** Nulo = o que o perfil diz. */
  canReverse: boolean | null;
  canSeeReports: boolean | null;
}

export const NO_USER_PERMISSION: FinUserPermission = { maxDiscountPercent: null, operation: 'BOTH', accountIds: [], canReverse: null, canSeeReports: null };

export interface FinAccessInput {
  role: Role | string | null | undefined;
  permission?: FinUserPermission | null;
  /** A clínica liberou o profissional ver as próprias comissões. */
  professionalSeesCommissions?: boolean;
}

export function finCan(input: FinAccessInput, capability: FinCapability): boolean {
  const { role } = input;
  const p = input.permission ?? NO_USER_PERMISSION;
  // Perfil que não reconhecemos não entra no financeiro: aqui o menor privilégio é nenhum.
  if (!isRole(role)) return false;
  const dono = role === 'OWNER' || role === 'ADMIN';

  if (capability === 'fin_estornar' && p.canReverse !== null && !dono) return p.canReverse && can(role, 'fin_ver');
  if (capability === 'fin_relatorios' && p.canSeeReports !== null && !dono) return p.canSeeReports && can(role, 'fin_ver');
  if (capability === 'fin_comissoes_proprias' && role === 'PROFESSIONAL') return Boolean(input.professionalSeesCommissions);

  if (!can(role, capability)) return false;
  if (capability === 'fin_receber' && p.operation === 'PAY') return false;
  if (capability === 'fin_pagar' && p.operation === 'RECEIVE') return false;
  return true;
}

/** O limite de desconto de quem está operando, em %. Dono e administrador não têm limite. */
export function discountLimitPercent(input: FinAccessInput, clinicDefault: number): number {
  if (input.role === 'OWNER' || input.role === 'ADMIN') return 100;
  const proprio = input.permission?.maxDiscountPercent;
  return proprio == null ? clinicDefault : Math.min(100, Math.max(0, proprio));
}

/** A pessoa pode movimentar esta conta? */
export function accountAllowed(input: FinAccessInput, accountId: string): boolean {
  const ids = input.permission?.accountIds ?? [];
  if (input.role === 'OWNER' || input.role === 'ADMIN') return true;
  return ids.length === 0 || ids.includes(accountId);
}

const LABEL: Record<FinCapability, string> = {
  fin_ver: 'ver o financeiro',
  fin_receber: 'receber',
  fin_pagar: 'lançar e pagar contas',
  fin_caixa: 'operar o caixa',
  fin_caixas_outros: 'mexer no caixa de outra pessoa',
  fin_estornar: 'estornar ou cancelar',
  fin_renegociar: 'renegociar',
  fin_comissoes: 'faturar comissões',
  fin_comissoes_proprias: 'ver as comissões',
  fin_relatorios: 'ver os relatórios gerenciais',
  fin_config: 'mudar as configurações do financeiro',
};

export const finDeniedMessage = (capability: FinCapability): string => `Seu acesso não permite ${LABEL[capability]}. Peça a liberação ao responsável pela clínica.`;
