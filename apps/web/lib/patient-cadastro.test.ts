import { describe, expect, it } from 'vitest';
import { displayName, nameWithCivil, officialName } from './patient-name';
import {
  cleanCustomAnswers,
  highlightedAnswers,
  missingRequired,
  parseOptions,
  readCustomAnswers,
  readPatientSettings,
  type CustomFieldDef,
} from './patient-fields';
import { activeFilterCount, filtersToQuery, patientFiltersWhere, readPatientFilters } from './patient-filters';
import { birthdayDays, birthdayInRange, isBirthdayOn, turningAge } from './birthdays';

describe('nome social', () => {
  it('aparece na tela e nas mensagens; o civil fica nos documentos', () => {
    const p = { name: 'José da Silva', socialName: 'Maria da Silva' };
    expect(displayName(p)).toBe('Maria da Silva');
    expect(officialName(p)).toBe('José da Silva');
    expect(nameWithCivil(p)).toBe('Maria da Silva (nome civil: José da Silva)');
  });

  it('sem nome social (ou só espaços), vale o civil', () => {
    expect(displayName({ name: 'Ana', socialName: '  ' })).toBe('Ana');
    expect(displayName({ name: 'Ana' })).toBe('Ana');
    expect(nameWithCivil({ name: 'Ana', socialName: null })).toBe('Ana');
  });
});

describe('campos obrigatórios da clínica', () => {
  it('lê só chaves conhecidas, sem repetir', () => {
    expect(readPatientSettings({ patients: { required: ['cpf', 'cpf', 'xx', 3], receptionCanExport: true } })).toEqual({
      required: ['cpf'],
      receptionCanExport: true,
    });
    expect(readPatientSettings(null)).toEqual({ required: [], receptionCanExport: false });
  });

  it('"preencher depois" deixa salvar sem CPF; estrangeiro troca pelo documento', () => {
    expect(missingRequired(['cpf'], {})).toEqual({ cpf: 'Obrigatório nesta clínica' });
    expect(missingRequired(['cpf'], {}, { cpfLater: true })).toEqual({});
    expect(missingRequired(['cpf'], { foreigner: true })).toEqual({ foreignDoc: 'Obrigatório nesta clínica' });
    expect(missingRequired(['cpf'], { foreigner: true, foreignDoc: 'X123' })).toEqual({});
  });

  it('endereço pede rua e número; sexo vai no campo gender', () => {
    expect(missingRequired(['address', 'sex'], { street: 'Rua A' })).toEqual({
      addressNumber: 'Obrigatório nesta clínica',
      gender: 'Obrigatório nesta clínica',
    });
  });
});

const campo = (o: Partial<CustomFieldDef>): CustomFieldDef => ({
  id: 'c1',
  label: 'Campo',
  type: 'SHORT_TEXT',
  options: [],
  required: false,
  hasNote: false,
  highlight: false,
  active: true,
  ...o,
});

describe('informações adicionais', () => {
  it('limpa: tira campo inativo ou desconhecido e recusa opção que não existe', () => {
    const defs = [
      campo({ id: 'a', type: 'SINGLE', options: ['Sim', 'Não'] }),
      campo({ id: 'b', type: 'MULTI', options: ['X', 'Y'] }),
      campo({ id: 'c', active: false }),
      campo({ id: 'd', type: 'NUMBER' }),
      campo({ id: 'e', type: 'DATE' }),
    ];
    const r = cleanCustomAnswers(defs, {
      a: { v: 'Talvez' },
      b: { v: ['X', 'Z', 'X'] },
      c: { v: 'oculto' },
      d: { v: '12,5' },
      e: { v: '2026-02-30x' },
      z: { v: 'sobra' },
    });
    expect(r.answers).toEqual({ b: { v: ['X'] }, d: { v: '12.5' } });
    expect(r.errors).toEqual({ a: 'Escolha uma das opções', e: 'Data inválida' });
  });

  it('obrigatório em branco vira erro; observação só quando o campo tem', () => {
    const defs = [campo({ id: 'a', required: true }), campo({ id: 'b', hasNote: false }), campo({ id: 'c', hasNote: true })];
    const r = cleanCustomAnswers(defs, { a: { v: ' ' }, b: { v: 'ok', obs: 'não guarda' }, c: { v: 'ok', obs: 'guarda' } });
    expect(r.errors).toEqual({ a: 'Obrigatório' });
    expect(r.answers).toEqual({ b: { v: 'ok' }, c: { v: 'ok', obs: 'guarda' } });
  });

  it('resposta destacada vira alerta com a observação', () => {
    const defs = [campo({ id: 'a', label: 'Usa marca-passo', type: 'SINGLE', options: ['Sim', 'Não'], highlight: true, hasNote: true }), campo({ id: 'b', highlight: true })];
    expect(highlightedAnswers(defs, { a: { v: 'Sim', obs: 'desde 2020' } })).toEqual([{ id: 'a', label: 'Usa marca-passo', text: 'Sim (desde 2020)' }]);
  });

  it('lê do banco sem confiar no formato', () => {
    expect(readCustomAnswers({ a: { v: 'x' }, b: { v: 3 }, c: 'solto', d: { v: ['1'], obs: ' ' } })).toEqual({ a: { v: 'x' }, d: { v: ['1'] } });
    expect(readCustomAnswers([1, 2])).toEqual({});
  });

  it('opções uma por linha, sem repetir', () => {
    expect(parseOptions('Sim\n Não \n\nSim;Talvez')).toEqual(['Sim', 'Não', 'Talvez']);
  });
});

describe('filtros da lista de pacientes', () => {
  it('lê da URL e ignora o que não vale', () => {
    const f = readPatientFilters({ q: ' ana ', sexo: 'X', nascDe: '2000-01-01', nascAte: 'ontem', situacao: 'todos', futuro: 'com', prioritario: '1' });
    expect(f.q).toBe('ana');
    expect(f.sexo).toBe('');
    expect(f.nascDe).toBe('2000-01-01');
    expect(f.nascAte).toBe('');
    expect(f.situacao).toBe('todos');
    expect(f.futuro).toBe('com');
    expect(activeFilterCount(f)).toBe(4);
  });

  it('volta para a URL sem os vazios nem o padrão', () => {
    expect(filtersToQuery({ q: 'ana', situacao: 'ativos', cidade: '', prioritario: true })).toBe('q=ana&prioritario=1');
  });

  it('monta o where: ativos por padrão, convênio, futuro', () => {
    const hoje = new Date('2026-11-18T00:00:00.000Z');
    expect(patientFiltersWhere(readPatientFilters({}), hoje)).toEqual({ AND: [{ active: true }] });
    const w = patientFiltersWhere(readPatientFilters({ situacao: 'todos', convenio: 'Uniodonto', futuro: 'sem' }), hoje) as { AND: unknown[] };
    expect(w.AND).toHaveLength(2);
    expect(JSON.stringify(w)).toContain('"none"');
  });
});

describe('aniversariantes', () => {
  it('semana vai de segunda a domingo', () => {
    const dias = birthdayDays('2026-11-18', 'semana'); // quarta
    expect(dias[0].date).toBe('2026-11-16');
    expect(dias[6].date).toBe('2026-11-22');
    expect(birthdayDays('2026-02-10', 'mes')).toHaveLength(28);
  });

  it('29/02 comemora em 28/02 fora do bissexto', () => {
    const b = new Date('2000-02-29T00:00:00.000Z');
    expect(isBirthdayOn(b, '2027-02-28')).toBe(true);
    expect(isBirthdayOn(b, '2028-02-28')).toBe(false);
    expect(isBirthdayOn(b, '2028-02-29')).toBe(true);
    expect(turningAge(b, '2027-02-28')).toBe(27);
  });

  it('acha o dia do aniversário no período', () => {
    expect(birthdayInRange(new Date('1990-11-20T00:00:00.000Z'), birthdayDays('2026-11-18', 'semana'))).toBe('2026-11-20');
    expect(birthdayInRange(new Date('1990-12-20T00:00:00.000Z'), birthdayDays('2026-11-18', 'semana'))).toBeNull();
  });
});
