/**
 * A DRE: em que linha cada subcategoria cai, o sinal de cada linha e onde
 * entram os subtotais. Puro e testado em `dre.test.ts`.
 */

export type DreLine =
  | 'RECEITA_BRUTA'
  | 'IMPOSTOS'
  | 'DEDUCOES_RECEITA'
  | 'OUTRAS_RECEITAS'
  | 'OUTRAS_DEDUCOES'
  | 'CUSTO_SERVICOS'
  | 'CUSTO_PRODUTOS'
  | 'OUTROS_CUSTOS'
  | 'DESPESAS_VARIAVEIS'
  | 'RECUPERACAO_VARIAVEIS'
  | 'DESPESAS_PESSOAL'
  | 'DESPESAS_ADMINISTRATIVAS'
  | 'DESPESAS_FINANCEIRAS'
  | 'RECUPERACAO_FIXAS'
  | 'OUTROS_TRIBUTOS'
  | 'INVESTIMENTOS_ATIVOS'
  | 'INVESTIMENTOS_SERVICOS'
  | 'PROVISAO_IR_CSLL'
  | 'PARTICIPACOES';

export type DreSubtotal = 'RECEITA_LIQUIDA' | 'RESULTADO_BRUTO' | 'TOTAL_DESPESAS' | 'RESULTADO_ANTES_IR' | 'LUCRO_ANTES_PARTICIPACOES' | 'RESULTADO_LIQUIDO';

export type DreRowDef =
  | { kind: 'line'; id: DreLine; label: string; sign: 1 | -1 }
  | { kind: 'subtotal'; id: DreSubtotal; label: string };

/** A estrutura, de cima para baixo. */
export const DRE_ROWS: readonly DreRowDef[] = [
  { kind: 'line', id: 'RECEITA_BRUTA', label: 'Receita bruta', sign: 1 },
  { kind: 'line', id: 'IMPOSTOS', label: 'Impostos', sign: -1 },
  { kind: 'line', id: 'DEDUCOES_RECEITA', label: 'Deduções de receita', sign: -1 },
  { kind: 'subtotal', id: 'RECEITA_LIQUIDA', label: 'Receita operacional líquida' },
  { kind: 'line', id: 'OUTRAS_RECEITAS', label: 'Outras receitas', sign: 1 },
  { kind: 'line', id: 'OUTRAS_DEDUCOES', label: 'Outras deduções de receita', sign: -1 },
  { kind: 'line', id: 'CUSTO_SERVICOS', label: 'Custo dos serviços prestados', sign: -1 },
  { kind: 'line', id: 'CUSTO_PRODUTOS', label: 'Custo dos produtos vendidos', sign: -1 },
  { kind: 'line', id: 'OUTROS_CUSTOS', label: 'Outros custos', sign: -1 },
  { kind: 'subtotal', id: 'RESULTADO_BRUTO', label: 'Resultado operacional bruto' },
  { kind: 'line', id: 'DESPESAS_VARIAVEIS', label: 'Despesas variáveis', sign: -1 },
  { kind: 'line', id: 'RECUPERACAO_VARIAVEIS', label: 'Recuperação de despesas variáveis', sign: 1 },
  { kind: 'line', id: 'DESPESAS_PESSOAL', label: 'Despesas com pessoal', sign: -1 },
  { kind: 'line', id: 'DESPESAS_ADMINISTRATIVAS', label: 'Despesas administrativas', sign: -1 },
  { kind: 'line', id: 'DESPESAS_FINANCEIRAS', label: 'Despesas financeiras', sign: -1 },
  { kind: 'line', id: 'RECUPERACAO_FIXAS', label: 'Recuperação de despesas fixas', sign: 1 },
  { kind: 'line', id: 'OUTROS_TRIBUTOS', label: 'Outros tributos', sign: -1 },
  { kind: 'subtotal', id: 'TOTAL_DESPESAS', label: 'Total de despesas' },
  { kind: 'line', id: 'INVESTIMENTOS_ATIVOS', label: 'Investimentos em ativos', sign: -1 },
  { kind: 'line', id: 'INVESTIMENTOS_SERVICOS', label: 'Investimentos em serviços', sign: -1 },
  { kind: 'subtotal', id: 'RESULTADO_ANTES_IR', label: 'Resultado antes do IR e da CSLL' },
  { kind: 'line', id: 'PROVISAO_IR_CSLL', label: 'Provisão para IR e CSLL', sign: -1 },
  { kind: 'subtotal', id: 'LUCRO_ANTES_PARTICIPACOES', label: 'Lucro líquido antes das participações' },
  { kind: 'line', id: 'PARTICIPACOES', label: 'Participações', sign: -1 },
  { kind: 'subtotal', id: 'RESULTADO_LIQUIDO', label: 'Resultado líquido do período' },
];

export const DRE_LINES: readonly DreLine[] = DRE_ROWS.filter((r): r is Extract<DreRowDef, { kind: 'line' }> => r.kind === 'line').map((r) => r.id);

export const DRE_LINE_LABEL = Object.fromEntries(DRE_ROWS.filter((r) => r.kind === 'line').map((r) => [r.id, r.label])) as Record<DreLine, string>;

export const isDreLine = (v: unknown): v is DreLine => typeof v === 'string' && (DRE_LINES as readonly string[]).includes(v);

/** As linhas que compõem o "Total de despesas" (do resultado bruto para baixo). */
const DESPESAS: readonly DreLine[] = ['DESPESAS_VARIAVEIS', 'RECUPERACAO_VARIAVEIS', 'DESPESAS_PESSOAL', 'DESPESAS_ADMINISTRATIVAS', 'DESPESAS_FINANCEIRAS', 'RECUPERACAO_FIXAS', 'OUTROS_TRIBUTOS'];

export interface DreRow {
  id: DreLine | DreSubtotal;
  label: string;
  kind: 'line' | 'subtotal';
  /** "+", "-" ou "=" na frente do rótulo. */
  symbol: '+' | '-' | '=';
  /** Valor com sinal: linha de dedução sai negativa; subtotal é o acumulado. */
  value: number;
}

/**
 * Monta a DRE a partir do total (positivo, em centavos) de cada linha.
 * "Total de despesas" soma só as despesas; os outros subtotais são o resultado
 * acumulado até ali.
 */
export function buildDre(totals: Partial<Record<DreLine, number>>): DreRow[] {
  let acumulado = 0;
  let despesas = 0;
  return DRE_ROWS.map((row) => {
    if (row.kind === 'line') {
      const value = row.sign * Math.abs(totals[row.id] ?? 0);
      acumulado += value;
      if (DESPESAS.includes(row.id)) despesas += value;
      return { id: row.id, label: row.label, kind: 'line', symbol: row.sign === 1 ? '+' : '-', value };
    }
    return { id: row.id, label: row.label, kind: 'subtotal', symbol: '=', value: row.id === 'TOTAL_DESPESAS' ? despesas : acumulado };
  });
}

/** Variação em % frente ao período anterior. Nulo quando não dá para comparar. */
export function variation(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
