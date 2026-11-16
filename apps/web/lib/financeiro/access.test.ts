import { describe, expect, it } from 'vitest';
import { accountAllowed, discountLimitPercent, finCan, NO_USER_PERMISSION, type FinCapability } from './access';

const TODAS: FinCapability[] = ['fin_ver', 'fin_receber', 'fin_pagar', 'fin_caixa', 'fin_caixas_outros', 'fin_estornar', 'fin_renegociar', 'fin_comissoes', 'fin_comissoes_proprias', 'fin_relatorios', 'fin_config'];
const pode = (role: string, extra = {}) => TODAS.filter((c) => finCan({ role, ...extra }, c));

describe('quem pode o quê no financeiro', () => {
  it('dono e administrador alcançam tudo', () => {
    expect(pode('OWNER')).toEqual(TODAS);
    expect(pode('ADMIN')).toEqual(TODAS);
  });

  it('a recepção trabalha sozinha, mas não estorna, não vê relatórios e não configura', () => {
    expect(pode('RECEPTIONIST')).toEqual(['fin_ver', 'fin_receber', 'fin_pagar', 'fin_caixa', 'fin_renegociar', 'fin_comissoes_proprias']);
  });

  it('o profissional só vê as próprias comissões, e só se a clínica liberar', () => {
    expect(pode('PROFESSIONAL')).toEqual([]);
    expect(pode('PROFESSIONAL', { professionalSeesCommissions: true })).toEqual(['fin_comissoes_proprias']);
  });

  it('perfil desconhecido não alcança nada', () => {
    expect(pode('QUALQUER')).toEqual([]);
    expect(finCan({ role: null }, 'fin_ver')).toBe(false);
  });

  it('a permissão por usuário libera estorno e relatórios para a recepção', () => {
    const p = { ...NO_USER_PERMISSION, canReverse: true, canSeeReports: true };
    expect(finCan({ role: 'RECEPTIONIST', permission: p }, 'fin_estornar')).toBe(true);
    expect(finCan({ role: 'RECEPTIONIST', permission: p }, 'fin_relatorios')).toBe(true);
    // Mas não abre o que o perfil não vê de jeito nenhum.
    expect(finCan({ role: 'PROFESSIONAL', permission: p }, 'fin_estornar')).toBe(false);
    expect(finCan({ role: 'RECEPTIONIST', permission: p }, 'fin_config')).toBe(false);
  });

  it('a permissão por usuário não tira nada do dono', () => {
    const p = { ...NO_USER_PERMISSION, canReverse: false, canSeeReports: false, operation: 'PAY' as const };
    expect(finCan({ role: 'OWNER', permission: p }, 'fin_estornar')).toBe(true);
    expect(finCan({ role: 'OWNER', permission: p }, 'fin_relatorios')).toBe(true);
  });

  it('"só recebe" não paga e "só paga" não recebe', () => {
    expect(finCan({ role: 'RECEPTIONIST', permission: { ...NO_USER_PERMISSION, operation: 'RECEIVE' } }, 'fin_pagar')).toBe(false);
    expect(finCan({ role: 'RECEPTIONIST', permission: { ...NO_USER_PERMISSION, operation: 'RECEIVE' } }, 'fin_receber')).toBe(true);
    expect(finCan({ role: 'RECEPTIONIST', permission: { ...NO_USER_PERMISSION, operation: 'PAY' } }, 'fin_receber')).toBe(false);
  });

  it('limite de desconto: o do usuário, senão o da clínica; dono não tem limite', () => {
    expect(discountLimitPercent({ role: 'RECEPTIONIST' }, 10)).toBe(10);
    expect(discountLimitPercent({ role: 'RECEPTIONIST', permission: { ...NO_USER_PERMISSION, maxDiscountPercent: 25 } }, 10)).toBe(25);
    expect(discountLimitPercent({ role: 'RECEPTIONIST', permission: { ...NO_USER_PERMISSION, maxDiscountPercent: 0 } }, 10)).toBe(0);
    expect(discountLimitPercent({ role: 'OWNER', permission: { ...NO_USER_PERMISSION, maxDiscountPercent: 5 } }, 10)).toBe(100);
  });

  it('contas liberadas: vazio é todas', () => {
    expect(accountAllowed({ role: 'RECEPTIONIST' }, 'a')).toBe(true);
    expect(accountAllowed({ role: 'RECEPTIONIST', permission: { ...NO_USER_PERMISSION, accountIds: ['b'] } }, 'a')).toBe(false);
    expect(accountAllowed({ role: 'ADMIN', permission: { ...NO_USER_PERMISSION, accountIds: ['b'] } }, 'a')).toBe(true);
  });
});
