import { describe, expect, it } from 'vitest';
import { firstLetters, initials, leadingInitials } from './initials';

describe('iniciais do avatar', () => {
  it('primeira e última palavra', () => {
    expect(initials('Rita Campos')).toBe('RC');
    expect(initials('  ana  ')).toBe('A');
    expect(initials('Maria da Silva Souza')).toBe('MS');
  });

  it('emoji no nome não vira meio caractere', () => {
    // Antes: 'Ana 🦋' dava "A" + metade do emoji, e a tela Conversas quebrava ao carregar.
    expect(initials('Ana 🦋')).toBe('A');
    expect(initials('🙂')).toBe('?');
    expect(initials('angelica🦋 💫')).toBe('A');
    expect(initials('😄 Bruno Reis')).toBe('BR');
    for (const nome of ['Ana 🦋', '🙂', '💫 Zé 💫']) {
      // Nenhum substituto solto (U+D800 a U+DFFF) na saída.
      expect(/[\uD800-\uDFFF]/.test(initials(nome))).toBe(false);
    }
  });

  it('acento e número contam como letra', () => {
    expect(initials('Érica Ávila')).toBe('ÉÁ');
    expect(initials('+55 11 99999')).toBe('59');
    expect(initials('')).toBe('?');
  });

  it('duas primeiras palavras', () => {
    expect(leadingInitials('Maria da Silva')).toBe('MD');
    expect(leadingInitials('🦋 Carla')).toBe('C');
    expect(leadingInitials('')).toBe('?');
  });

  it('primeiras letras do nome', () => {
    expect(firstLetters('Odontologia Michele', 2)).toBe('OD');
    expect(firstLetters('Dra. Ana')).toBe('D');
    expect(firstLetters('🦷 Sorriso', 2)).toBe('SO');
    expect(firstLetters('🦷')).toBe('?');
  });
});
