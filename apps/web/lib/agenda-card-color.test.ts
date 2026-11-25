import { describe, expect, it } from 'vitest';
import { cardColor, readableOn } from './agenda-card-color';

describe('cardColor', () => {
  it('rótulo vence procedimento, que vence profissional', () => {
    expect(cardColor({ label: 'violet', procedure: '#EF4444', professional: '#0D9488' })).toBe('#7C3AED');
    expect(cardColor({ procedure: '#EF4444', professional: '#0D9488' })).toBe('#EF4444');
    expect(cardColor({ professional: '#0D9488' })).toBe('#0D9488');
  });
  it('cor estranha é ignorada', () => {
    expect(cardColor({ label: 'xadrez', procedure: 'vermelho', professional: null })).toBe('#64748B');
  });
});

describe('readableOn', () => {
  it('escuro sobre cor clara, branco sobre cor forte', () => {
    expect(readableOn('#FDE68A')).toBe('dark');
    expect(readableOn('#06B6D4')).toBe('dark');
    expect(readableOn('#7C3AED')).toBe('light');
    expect(readableOn('#DB2777')).toBe('light');
  });
});
