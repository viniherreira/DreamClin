/**
 * Filtros da lista de pacientes, todos na URL (dá para voltar, recarregar e
 * mandar o link). Puro: lê os parâmetros e monta o `where` do Prisma. CPF e
 * telefone são cifrados e não entram aqui: a busca rápida cuida deles.
 */

export interface PatientFilters {
  q: string;
  sexo: string;
  nascDe: string;
  nascAte: string;
  cidade: string;
  email: string;
  convenio: string;
  atendidoPor: string;
  situacao: 'ativos' | 'inativos' | 'todos';
  origem: string;
  futuro: '' | 'com' | 'sem';
  unidade: string;
  prioritario: boolean;
}

export const EMPTY_FILTERS: PatientFilters = {
  q: '',
  sexo: '',
  nascDe: '',
  nascAte: '',
  cidade: '',
  email: '',
  convenio: '',
  atendidoPor: '',
  situacao: 'ativos',
  origem: '',
  futuro: '',
  unidade: '',
  prioritario: false,
};

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function readPatientFilters(params: Record<string, string | string[] | undefined>): PatientFilters {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const situacao = one('situacao');
  const futuro = one('futuro');
  const nascDe = str(one('nascDe'), 10);
  const nascAte = str(one('nascAte'), 10);
  return {
    q: str(one('q'), 120),
    sexo: ['F', 'M', 'O', 'N'].includes(str(one('sexo'))) ? str(one('sexo')) : '',
    nascDe: DIA.test(nascDe) ? nascDe : '',
    nascAte: DIA.test(nascAte) ? nascAte : '',
    cidade: str(one('cidade')),
    email: str(one('email')),
    convenio: str(one('convenio')),
    atendidoPor: str(one('atendidoPor'), 40),
    situacao: situacao === 'inativos' || situacao === 'todos' ? situacao : 'ativos',
    origem: str(one('origem'), 40),
    futuro: futuro === 'com' || futuro === 'sem' ? futuro : '',
    unidade: str(one('unidade'), 40),
    prioritario: one('prioritario') === '1',
  };
}

/** Quantos filtros (além da busca e da situação padrão) estão ligados, para o chip "Filtros aplicados". */
export function activeFilterCount(f: PatientFilters): number {
  return [
    f.sexo,
    f.nascDe || f.nascAte,
    f.cidade,
    f.email,
    f.convenio,
    f.atendidoPor,
    f.situacao !== 'ativos',
    f.origem,
    f.futuro,
    f.unidade,
    f.prioritario,
  ].filter(Boolean).length;
}

/** Os filtros de volta para a URL, sem os vazios. */
export function filtersToQuery(f: Partial<PatientFilters>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (k === 'situacao' && v === 'ativos') continue;
    if (k === 'prioritario') {
      if (v) out.set(k, '1');
      continue;
    }
    if (typeof v === 'string' && v) out.set(k, v);
  }
  return out.toString();
}

/**
 * O `where` do Prisma (sem a busca rápida, que depende do índice cego e dos
 * campos cifrados). `todayWall` é a meia-noite de hoje como data de parede,
 * para o "com agendamento futuro".
 */
export function patientFiltersWhere(f: PatientFilters, todayWall: Date): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  if (f.situacao === 'ativos') and.push({ active: true });
  if (f.situacao === 'inativos') and.push({ active: false });
  if (f.sexo) and.push({ gender: f.sexo });
  if (f.nascDe || f.nascAte) {
    and.push({
      birthDate: {
        ...(f.nascDe ? { gte: new Date(`${f.nascDe}T00:00:00.000Z`) } : {}),
        ...(f.nascAte ? { lte: new Date(`${f.nascAte}T23:59:59.999Z`) } : {}),
      },
    });
  }
  if (f.cidade) and.push({ city: { contains: f.cidade, mode: 'insensitive' } });
  if (f.email) and.push({ email: { contains: f.email, mode: 'insensitive' } });
  if (f.convenio) and.push({ insurances: { some: { active: true, insurerName: { contains: f.convenio, mode: 'insensitive' } } } });
  if (f.atendidoPor) and.push({ appointments: { some: { professionalId: f.atendidoPor, status: 'ATTENDED' } } });
  if (f.origem) and.push({ originId: f.origem });
  if (f.prioritario) and.push({ priority: true });
  const futuroWhere = { startTime: { gte: todayWall }, status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] } };
  if (f.futuro === 'com') and.push({ appointments: { some: futuroWhere } });
  if (f.futuro === 'sem') and.push({ appointments: { none: futuroWhere } });
  if (f.unidade) and.push({ appointments: { some: { unitId: f.unidade } } });
  return and.length ? { AND: and } : {};
}
