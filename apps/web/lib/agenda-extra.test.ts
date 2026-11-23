import { describe, expect, it } from 'vitest';
import { easterSunday, holidayOn, holidaysBetween, nationalHolidays } from './holidays';
import { occurrences } from './recurrence';

describe('feriados', () => {
  it('Páscoa e os feriados que dependem dela', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    const n = nationalHolidays(2026);
    expect(n.find((h) => h.name === 'Sexta-feira Santa')?.date).toBe('2026-04-03');
    expect(n.find((h) => h.name === 'Corpus Christi')?.date).toBe('2026-06-04');
    expect(n.filter((h) => h.name === 'Carnaval').map((h) => h.date)).toEqual(['2026-02-16', '2026-02-17']);
  });

  it('o feriado da clínica vale no lugar do nacional, e acha no período', () => {
    expect(holidayOn('2026-11-20')?.name).toBe('Dia da Consciência Negra');
    expect(holidayOn('2026-01-25', [{ date: '2026-01-25', name: 'Aniversário de São Paulo' }])).toEqual({ date: '2026-01-25', name: 'Aniversário de São Paulo', national: false });
    expect(holidayOn('2026-03-10')).toBeNull();
    expect(holidaysBetween('2026-12-20', '2027-01-02').map((h) => h.date)).toEqual(['2026-12-25', '2027-01-01']);
  });
});

describe('repetição', () => {
  it('toda semana por 10 vezes', () => {
    const d = occurrences('2026-12-01', { kind: 'weekly', count: 10 });
    expect(d).toHaveLength(10);
    expect(d[1]).toBe('2026-12-08');
    expect(d[9]).toBe('2027-02-02');
  });

  it('todo mês no dia 31 cai no último dia do mês curto', () => {
    expect(occurrences('2027-01-31', { kind: 'monthly', count: 3 })).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('seg/qua/sex até uma data', () => {
    expect(occurrences('2026-12-07', { kind: 'mwf', until: '2026-12-14' })).toEqual(['2026-12-07', '2026-12-09', '2026-12-11', '2026-12-14']);
  });

  it('sem quantidade nem data final, só o primeiro; teto de 104', () => {
    expect(occurrences('2026-12-07', { kind: 'weekly' })).toEqual(['2026-12-07']);
    expect(occurrences('2026-12-07', { kind: 'daily', count: 999 })).toHaveLength(104);
    expect(occurrences('2026-12-07', { kind: 'every', everyDays: 3, count: 3 })).toEqual(['2026-12-07', '2026-12-10', '2026-12-13']);
  });
});
