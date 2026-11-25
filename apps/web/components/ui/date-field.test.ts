import { describe, expect, it } from 'vitest';
import { parseTypedDate } from './date-field';

describe('parseTypedDate', () => {
  it('lê o jeito brasileiro e o AAAA-MM-DD', () => {
    expect(parseTypedDate('26/11/2026')).toBe('2026-11-26');
    expect(parseTypedDate(' 2026-11-26 ')).toBe('2026-11-26');
    expect(parseTypedDate('29/02/2028')).toBe('2028-02-29');
  });

  it('pela metade ou dia que não existe não vale', () => {
    expect(parseTypedDate('26/11/20')).toBeNull();
    expect(parseTypedDate('31/02/2026')).toBeNull();
    expect(parseTypedDate('29/02/2026')).toBeNull();
    expect(parseTypedDate('2026-13-01')).toBeNull();
    expect(parseTypedDate('')).toBeNull();
  });
});
