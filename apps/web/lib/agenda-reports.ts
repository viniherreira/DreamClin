/**
 * Relatórios da agenda e dos pacientes (spec 2026-11-18, F8): o catálogo e as
 * contas puras. O servidor busca as linhas (`agenda-reports-server.ts`) e a
 * tela e a exportação usam a mesma tabela.
 */
import { timeToMin, type DaySchedule } from './schedule';

export type ReportKey =
  | 'situacao'
  | 'criacao'
  | 'confirmacao'
  | 'dimensao'
  | 'cidade'
  | 'sem-agendar'
  | 'remarcacoes'
  | 'lista-de-espera'
  | 'cadastro'
  | 'informacoes'
  | 'ocupacao';

export interface ReportDef {
  key: ReportKey;
  group: 'Agenda' | 'Pacientes';
  title: string;
  description: string;
  /** Tem nome e telefone de paciente: exportar pede `pacientes_exportar`. */
  personal: boolean;
  /** Usa o período (de/até). */
  period: boolean;
}

export const REPORTS: ReportDef[] = [
  { key: 'situacao', group: 'Agenda', title: 'Por situação', description: 'Agendados, confirmados (e quem confirmou), atendidos, faltas e cancelados, por profissional.', personal: false, period: true },
  { key: 'confirmacao', group: 'Agenda', title: 'Origem da confirmação', description: 'Quantos confirmaram pelo WhatsApp, pelo link, por telefone ou na recepção.', personal: false, period: true },
  { key: 'criacao', group: 'Agenda', title: 'Quem marcou', description: 'Agendamentos criados no período, por quem marcou.', personal: false, period: true },
  { key: 'dimensao', group: 'Agenda', title: 'Por tipo, sala, procedimento ou convênio', description: 'Escolha como agrupar e veja quantos e quantos atendidos.', personal: false, period: true },
  { key: 'ocupacao', group: 'Agenda', title: 'Ocupação da agenda', description: 'Horas de atendimento disponíveis e ocupadas por profissional.', personal: false, period: true },
  { key: 'remarcacoes', group: 'Agenda', title: 'Remarcações', description: 'Cada remarcação do período: de quando, para quando, quem e o motivo.', personal: true, period: true },
  { key: 'lista-de-espera', group: 'Agenda', title: 'Lista de espera', description: 'Quem entrou na lista, há quanto tempo espera e como saiu.', personal: true, period: true },
  { key: 'sem-agendar', group: 'Pacientes', title: 'Pacientes sem agendar', description: 'Quem foi atendido e não tem nada marcado para frente há mais de N dias.', personal: true, period: false },
  { key: 'cadastro', group: 'Pacientes', title: 'Cadastros novos', description: 'Pacientes cadastrados no período, com a origem.', personal: true, period: true },
  { key: 'cidade', group: 'Pacientes', title: 'Por cidade e bairro', description: 'De onde vêm os pacientes atendidos no período.', personal: false, period: true },
  { key: 'informacoes', group: 'Pacientes', title: 'Informações adicionais', description: 'As respostas dos campos que a clínica criou no cadastro.', personal: false, period: false },
];

export const reportDef = (k: string | undefined): ReportDef => REPORTS.find((r) => r.key === k) ?? REPORTS[0];

export type Cell = string | number | null;

export interface ReportTable {
  columns: string[];
  rows: Cell[][];
  /** Colunas com percentual (0 a 100) para mostrar com "%". */
  percentColumns?: number[];
  /** Linha de total no fim. */
  total?: Cell[];
  note?: string;
}

/** Conta por chave, do maior para o menor; empate, pelo nome. */
export function countBy<T>(rows: readonly T[], keyOf: (r: T) => string | null | undefined, empty = 'Sem informação'): { label: string; total: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r)?.trim() || empty;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'));
}

/** Percentual com uma casa (0 quando o total é 0). */
export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Minutos de atendimento de um dia de expediente, sem o almoço. */
export function workMinutes(day: DaySchedule | null | undefined): number {
  if (!day) return 0;
  const ini = timeToMin(day.start);
  const fim = timeToMin(day.end);
  if (ini === null || fim === null || fim <= ini) return 0;
  let total = fim - ini;
  const a = timeToMin(day.lunchStart ?? null);
  const b = timeToMin(day.lunchEnd ?? null);
  if (a !== null && b !== null && b > a) total -= Math.max(0, Math.min(b, fim) - Math.max(a, ini));
  return Math.max(0, total);
}

/** Datas (AAAA-MM-DD) de `from` até `to`, inclusive. Para no máximo em 400 dias. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  const fim = Date.parse(`${to}T00:00:00Z`);
  while (t <= fim && out.length < 400) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

/** Dias inteiros entre duas datas (a segunda menos a primeira). */
export const daysDiff = (a: Date | string, b: Date | string): number => Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

/** A tabela vira linhas de planilha: cabeçalho, linhas e total. */
export function tableToRows(t: ReportTable): Cell[][] {
  return [t.columns, ...t.rows, ...(t.total ? [t.total] : [])];
}
