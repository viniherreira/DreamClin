import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildXlsx } from '../xlsx';
import { bucketIndex, buckets, competencesBetween, defaultRate, granularityFor, presetRange, previousRange } from './reports';

describe('relatórios: períodos prontos', () => {
  const hoje = '2026-11-17';
  it('mês, trimestre, semestre e ano', () => {
    expect(presetRange('month', hoje)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetRange('prev-month', hoje)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('next-month', hoje)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(presetRange('quarter', hoje)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(presetRange('prev-quarter', hoje)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(presetRange('next-quarter', hoje)).toEqual({ from: '2027-01-01', to: '2027-03-31' });
    expect(presetRange('semester', hoje)).toEqual({ from: '2026-07-01', to: '2026-12-31' });
    expect(presetRange('prev-year', hoje)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(presetRange('prev-month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('last-30', hoje)).toEqual({ from: '2026-10-19', to: '2026-11-17' });
  });

  it('período anterior: mês cheio vira o mês anterior; outros, o mesmo tamanho antes', () => {
    expect(previousRange('2026-11-01', '2026-11-30')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(previousRange('2026-10-01', '2026-12-31')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(previousRange('2026-11-10', '2026-11-19')).toEqual({ from: '2026-10-31', to: '2026-11-09' });
  });
});

describe('relatórios: colunas do fluxo de caixa', () => {
  it('dia até 31 dias, semana até 92, mês acima', () => {
    expect(granularityFor('2026-11-01', '2026-11-30')).toBe('day');
    expect(granularityFor('2026-10-01', '2026-12-31')).toBe('week');
    expect(granularityFor('2026-01-01', '2026-12-31')).toBe('month');
    expect(granularityFor('2026-11-01', '2026-11-30', true)).toBe('week');
  });

  it('semanas começam na segunda e meses cortam no período', () => {
    const s = buckets('2026-11-01', '2026-11-17', 'week');
    // 01/11/2026 é domingo: a primeira "semana" é só ele.
    expect(s.map((b) => [b.from, b.to])).toEqual([
      ['2026-11-01', '2026-11-01'],
      ['2026-11-02', '2026-11-08'],
      ['2026-11-09', '2026-11-15'],
      ['2026-11-16', '2026-11-17'],
    ]);
    const m = buckets('2026-10-15', '2026-12-10', 'month');
    expect(m.map((b) => b.label)).toEqual(['out/26', 'nov/26', 'dez/26']);
    expect(bucketIndex(m, '2026-11-30')).toBe(1);
    expect(bucketIndex(m, '2027-01-01')).toBe(-1);
    expect(buckets('2026-11-01', '2026-11-03', 'day')).toHaveLength(3);
  });

  it('competências do período e inadimplência', () => {
    expect(competencesBetween('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(defaultRate(2500, 10000)).toBe(25);
    expect(defaultRate(1, 3)).toBe(33.3);
    expect(defaultRate(10, 0)).toBeNull();
  });
});

describe('planilha xlsx', () => {
  it('monta um arquivo que abre: abas, textos com acento e números', () => {
    const bytes = buildXlsx([{ name: 'Fluxo: nov/26', rows: [['Categoria', 'Valor'], ['Aluguel & condomínio', 1234.5]], moneyColumns: [1] }]);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain('xl/worksheets/sheet1.xml');
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('Aluguel &amp; condomínio');
    expect(sheet).toContain('<v>1234.5</v>');
    expect(strFromU8(files['xl/workbook.xml'])).toContain('name="Fluxo  nov/26"'.replace('/', ' '));
  });
});
