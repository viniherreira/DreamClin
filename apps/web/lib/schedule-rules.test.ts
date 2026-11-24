import { describe, expect, it } from 'vitest';
import { describeRule, ruleAppliesOn, ruleConflicts, ruleDay, ruleError, workingDay, type RuleLike } from './schedule-rules';

const base: RuleLike = { startsOn: '2027-03-01', repeat: 'WEEKLY', weekdays: [1, 3], start1: '08:00', end1: '12:00', start2: '14:00', end2: '18:00' };

describe('escalas', () => {
  it('semanal respeita dias e vigência', () => {
    expect(ruleAppliesOn(base, '2027-03-01')).toBe(true); // segunda
    expect(ruleAppliesOn(base, '2027-03-02')).toBe(false); // terça
    expect(ruleAppliesOn(base, '2027-02-22')).toBe(false); // antes
    expect(ruleAppliesOn({ ...base, endsOn: '2027-03-31' }, '2027-04-05')).toBe(false);
  });

  it('quinzenal alterna as semanas a partir do início', () => {
    const r = { ...base, repeat: 'BIWEEKLY', weekdays: [1] };
    expect(ruleAppliesOn(r, '2027-03-01')).toBe(true);
    expect(ruleAppliesOn(r, '2027-03-08')).toBe(false);
    expect(ruleAppliesOn(r, '2027-03-15')).toBe(true);
  });

  it('a cada N dias e dia do mês', () => {
    expect(ruleAppliesOn({ ...base, repeat: 'EVERY_N_DAYS', everyDays: 3 }, '2027-03-04')).toBe(true);
    expect(ruleAppliesOn({ ...base, repeat: 'EVERY_N_DAYS', everyDays: 3 }, '2027-03-05')).toBe(false);
    expect(ruleAppliesOn({ ...base, repeat: 'MONTH_DAY', monthDay: 15 }, '2027-04-15')).toBe(true);
  });

  it('dois períodos viram dia com almoço', () => {
    expect(ruleDay(base)).toEqual({ start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '14:00' });
    expect(ruleDay({ start1: '08:00', end1: '12:00' })).toEqual({ start: '08:00', end: '12:00' });
  });

  it('sem regra vale o horário antigo; folga apaga; plantão abre o dia', () => {
    const antigo = [null, { start: '09:00', end: '17:00' }, null, null, null, null, null];
    expect(workingDay({ rules: [], exceptions: [], fallback: antigo, date: '2027-03-01' })).toEqual({ start: '09:00', end: '17:00' });
    expect(workingDay({ rules: [base], exceptions: [], fallback: antigo, date: '2027-03-02' })).toBeNull();
    expect(workingDay({ rules: [base], exceptions: [{ date: '2027-03-01', kind: 'OFF' }], fallback: antigo, date: '2027-03-01' })).toBeNull();
    expect(workingDay({ rules: [base], exceptions: [{ date: '2027-03-02', kind: 'EXTRA', start: '18:00', end: '22:00' }], fallback: antigo, date: '2027-03-02' })).toEqual({ start: '18:00', end: '22:00' });
  });

  it('regra só de um tipo de atendimento não abre o dia para outro tipo', () => {
    const r = { ...base, careTypeId: 'laser' };
    expect(workingDay({ rules: [r], exceptions: [], fallback: undefined, date: '2027-03-01', careTypeId: 'consulta' })).toBeNull();
    expect(workingDay({ rules: [r], exceptions: [], fallback: undefined, date: '2027-03-01', careTypeId: 'laser' })).not.toBeNull();
  });

  it('choque: mesmo dia e horário que se cruza; sem dia em comum não choca', () => {
    const outra = { ...base, id: 'b', weekdays: [3], start1: '10:00', end1: '11:00', start2: null, end2: null };
    expect(ruleConflicts(base, [outra]).map((r) => r.id)).toEqual(['b']);
    expect(ruleConflicts(base, [{ ...outra, weekdays: [5] }])).toEqual([]);
    expect(ruleConflicts(base, [{ ...outra, start1: '12:30', end1: '13:30' }])).toEqual([]);
    expect(ruleConflicts(base, [{ ...outra, endsOn: '2027-02-28', startsOn: '2027-01-01' }])).toEqual([]);
  });

  it('confere a regra e descreve em português', () => {
    expect(ruleError(base)).toBeNull();
    expect(ruleError({ ...base, weekdays: [] })).toMatch(/dia da semana/);
    expect(ruleError({ ...base, start2: '11:00' })).toMatch(/segundo período/);
    expect(describeRule(base)).toBe('Seg, Qua · 08:00–12:00 e 14:00–18:00 · a partir de 01/03/2027');
  });
});
