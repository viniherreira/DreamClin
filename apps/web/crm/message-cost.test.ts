import { describe, expect, it } from 'vitest';
import { estimateCost, formatReais } from './message-cost';

describe('estimateCost', () => {
  it('multiplica as pessoas pelo preço da categoria', () => {
    expect(estimateCost('MARKETING', 221)).toBe(77.35);
    expect(estimateCost('UTILITY', 221)).toBe(8.84);
  });

  it('sem pessoas ou com categoria que não entra em transmissão, não estima', () => {
    expect(estimateCost('MARKETING', 0)).toBeNull();
    expect(estimateCost('AUTHENTICATION', 10)).toBeNull();
    expect(estimateCost('MARKETING', Number.NaN)).toBeNull();
  });

  it('mostra em reais', () => {
    expect(formatReais(77.35).replace(/\s/g, ' ')).toBe('R$ 77,35');
  });
});
