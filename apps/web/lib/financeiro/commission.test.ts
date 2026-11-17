import { describe, expect, it } from 'vitest';
import { baseFor, commissionAmount, commissionDisplay, proportional, ruleFor } from './commission';

const padrao = { mode: 'PERCENT' as const, value: 10 };

describe('comissão: regra', () => {
  it('a mais específica ganha: procedimento > profissional > cadastro > clínica', () => {
    const excecoes = [
      { procedureId: 'limpeza', mode: 'PERCENT' as const, value: 30 },
      { procedureId: null, mode: 'PERCENT' as const, value: 20 },
    ];
    expect(ruleFor({ procedureId: 'limpeza', exceptions: excecoes, professionalPercent: 15, clinicDefault: padrao })).toMatchObject({ mode: 'PERCENT', value: 30 });
    expect(ruleFor({ procedureId: 'canal', exceptions: excecoes, professionalPercent: 15, clinicDefault: padrao })).toMatchObject({ value: 20 });
    expect(ruleFor({ procedureId: 'canal', exceptions: [], professionalPercent: 15, clinicDefault: padrao }).label).toContain('cadastro do profissional');
    expect(ruleFor({ procedureId: 'canal', exceptions: [], professionalPercent: null, clinicDefault: padrao })).toMatchObject({ value: 10 });
  });

  it('valor fixo vira centavos por unidade', () => {
    const r = ruleFor({ procedureId: null, exceptions: [{ procedureId: null, mode: 'FIXED', value: 25.5 }], professionalPercent: null, clinicDefault: padrao });
    expect(r).toMatchObject({ mode: 'FIXED', value: 2550 });
    expect(commissionAmount(10000, 2, r)).toBe(5100);
  });
});

describe('comissão: base e valor', () => {
  const item = { quantity: 2, chargedCents: 30000, tablePriceCents: 20000, costCents: 3000 };
  it('cobrado ou tabela, com ou sem custo', () => {
    expect(baseFor(item, { base: 'CHARGED', deductCost: false })).toBe(30000);
    expect(baseFor(item, { base: 'TABLE', deductCost: false })).toBe(40000);
    expect(baseFor(item, { base: 'CHARGED', deductCost: true })).toBe(24000);
    expect(baseFor({ ...item, costCents: 50000 }, { base: 'CHARGED', deductCost: true })).toBe(0);
  });
  it('% da base; regra zerada não gera nada', () => {
    expect(commissionAmount(24000, 2, { mode: 'PERCENT', value: 12.5, label: '' })).toBe(3000);
    expect(commissionAmount(24000, 2, { mode: 'PERCENT', value: 0, label: '' })).toBe(0);
  });
});

describe('comissão: proporcional ao recebido', () => {
  it('R$ 30 de comissão em 3 recebimentos de 100 sobre 300: 10 + 10 + 10', () => {
    expect(proportional(3000, 10000, 30000)).toBe(1000);
    expect(proportional(3000, 20000, 30000, 1000)).toBe(1000);
    expect(proportional(3000, 30000, 30000, 2000)).toBe(1000);
  });
  it('centavos: a última parte fecha o total', () => {
    expect(proportional(1000, 10000, 30000)).toBe(333);
    expect(proportional(1000, 20000, 30000, 333)).toBe(333);
    expect(proportional(1000, 30000, 30000, 666)).toBe(334);
    // Recebido a mais (troco) não passa do total.
    expect(proportional(1000, 40000, 30000, 666)).toBe(334);
  });
  it('nada a dividir', () => {
    expect(proportional(0, 100, 100)).toBe(0);
    expect(proportional(100, 100, 0)).toBe(0);
  });
});

describe('comissão: situação', () => {
  it('estornada, paga, faturada, aprovada, pendente', () => {
    expect(commissionDisplay('REVERSED', 'PAID')).toBe('REVERSED');
    expect(commissionDisplay('APPROVED', 'PAID')).toBe('PAID');
    expect(commissionDisplay('APPROVED', 'OPEN')).toBe('BILLED');
    expect(commissionDisplay('APPROVED', 'CANCELLED')).toBe('APPROVED');
    expect(commissionDisplay('PENDING', null)).toBe('PENDING');
  });
});
