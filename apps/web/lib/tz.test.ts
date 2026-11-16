import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ageFromBirth,
  clinicNowMinutes,
  clinicToday,
  instantDateTimeShortBR,
  instantTimeBR,
  wallDateShortBR,
  instantDateBR,
  instantDateLongBR,
  instantDateTimeBR,
  wallClockTime,
  wallClockMinutes,
  wallDateBR,
} from './tz';

describe('datas em documentos', () => {
  it('data de parede não volta um dia', () => {
    // Validade escolhida como 30/10 é gravada à meia-noite UTC. Formatar no
    // fuso de São Paulo daria 29/10 — o bug que este helper existe para evitar.
    expect(wallDateBR(new Date('2026-10-30T00:00:00.000Z'))).toBe('30/10/2026');
  });

  it('instante é lido no fuso da clínica', () => {
    // 01:30 UTC do dia 4 ainda é 22:30 do dia 3 em São Paulo.
    const d = new Date('2026-10-04T01:30:00.000Z');
    expect(instantDateBR(d)).toBe('03/10/2026');
    expect(instantDateLongBR(d)).toBe('3 de outubro de 2026');
    expect(instantDateTimeBR(d)).toBe('03/10/2026 às 22:30');
  });
});

describe('wallClockTime', () => {
  it('reads the wall-clock from UTC components, not local tz', () => {
    expect(wallClockTime(new Date('2026-07-06T14:00:00.000Z'))).toBe('14:00');
    expect(wallClockTime(new Date('2026-07-06T09:05:00.000Z'))).toBe('09:05');
    expect(wallClockTime('2026-07-06T23:30:00.000Z')).toBe('23:30');
  });
});

describe('wallClockMinutes', () => {
  it('returns minutes since midnight from UTC components', () => {
    expect(wallClockMinutes(new Date('2026-07-06T14:30:00.000Z'))).toBe(870);
    expect(wallClockMinutes(new Date('2026-07-06T00:00:00.000Z'))).toBe(0);
  });
});

describe('clinicToday', () => {
  afterEach(() => vi.useRealTimers());

  it('uses the São Paulo date even late at night in UTC', () => {
    // 02:00 UTC on the 7th is still 23:00 on the 6th in São Paulo (UTC-3)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T02:00:00.000Z'));
    expect(clinicToday()).toBe('2026-07-06');
  });

  it('rolls to the next day once São Paulo passes midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T12:00:00.000Z'));
    expect(clinicToday()).toBe('2026-07-07');
  });
});

describe('datas curtas e hora no fuso da clínica', () => {
  it('data de parede curta lê os componentes UTC', () => {
    expect(wallDateShortBR('2026-11-26T00:00:00.000Z')).toBe('26/11/26');
    expect(wallDateShortBR(new Date('2026-01-05T00:00:00.000Z'))).toBe('05/01/26');
  });

  it('instante vira hora de Brasília, onde quer que o servidor rode', () => {
    // 01:30 UTC do dia 16 ainda é 22:30 do dia 15 em São Paulo.
    expect(instantTimeBR('2026-11-16T01:30:00.000Z')).toBe('22:30');
    expect(instantDateTimeShortBR('2026-11-16T01:30:00.000Z')).toBe('15/11/26 22:30');
    expect(clinicNowMinutes(new Date('2026-11-16T01:30:00.000Z'))).toBe(22 * 60 + 30);
  });
});

describe('ageFromBirth', () => {
  it('conta anos completos pelo dia da clínica', () => {
    expect(ageFromBirth('1990-11-15T00:00:00.000Z', '2026-11-15')).toBe(36); // no aniversário já fez
    expect(ageFromBirth('1990-11-16T00:00:00.000Z', '2026-11-15')).toBe(35); // véspera
    expect(ageFromBirth(new Date('2000-02-29T00:00:00.000Z'), '2026-02-28')).toBe(25);
  });

  it('sem data, data inválida ou no futuro: null', () => {
    expect(ageFromBirth(null, '2026-11-15')).toBeNull();
    expect(ageFromBirth('', '2026-11-15')).toBeNull();
    expect(ageFromBirth('não é data', '2026-11-15')).toBeNull();
    expect(ageFromBirth('2030-01-01T00:00:00.000Z', '2026-11-15')).toBeNull();
  });
});
