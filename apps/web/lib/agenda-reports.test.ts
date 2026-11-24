import { describe, expect, it, vi } from 'vitest';
import { countBy, daysBetween, daysDiff, pct, reportDef, tableToRows, workMinutes, REPORTS } from './agenda-reports';

vi.mock('server-only', () => ({}));

describe('relatórios da agenda (puro)', () => {
  it('conta por chave, do maior para o menor, com "sem informação" para vazio', () => {
    expect(countBy([{ c: 'Recife' }, { c: ' ' }, { c: 'Olinda' }, { c: 'Recife' }, { c: null }], (x) => x.c)).toEqual([
      { label: 'Recife', total: 2 },
      { label: 'Sem informação', total: 2 },
      { label: 'Olinda', total: 1 },
    ]);
  });

  it('percentual com uma casa e zero sem total', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(5, 0)).toBe(0);
  });

  it('minutos de atendimento tiram o almoço', () => {
    expect(workMinutes({ start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' })).toBe(540);
    expect(workMinutes({ start: '08:00', end: '12:00' })).toBe(240);
    expect(workMinutes({ start: '14:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' })).toBe(240);
    expect(workMinutes(null)).toBe(0);
  });

  it('dias entre datas, inclusive, e diferença em dias', () => {
    expect(daysBetween('2027-02-27', '2027-03-02')).toEqual(['2027-02-27', '2027-02-28', '2027-03-01', '2027-03-02']);
    expect(daysDiff('2027-01-01T10:00:00Z', '2027-01-11T09:00:00Z')).toBe(9);
  });

  it('relatório desconhecido cai no primeiro; os de pessoa marcam exportação restrita', () => {
    expect(reportDef('nao-existe').key).toBe('situacao');
    expect(REPORTS.filter((r) => r.personal).map((r) => r.key).sort()).toEqual(['cadastro', 'lista-de-espera', 'remarcacoes', 'sem-agendar']);
  });

  it('tabela vira linhas com cabeçalho e total', () => {
    expect(tableToRows({ columns: ['A', 'B'], rows: [['x', 1]], total: ['Total', 1] })).toEqual([['A', 'B'], ['x', 1], ['Total', 1]]);
  });
});
