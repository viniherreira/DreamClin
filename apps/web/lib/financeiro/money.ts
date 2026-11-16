/**
 * Dinheiro em centavos inteiros. O banco guarda `Decimal(12,2)`; toda conta do
 * financeiro passa por aqui para nunca somar `0.1 + 0.2` em ponto flutuante.
 * Puro e testado em `money.test.ts`.
 */

/** Qualquer coisa que o banco ou um formulário devolva como valor. */
export type MoneyLike = number | string | { toString(): string } | null | undefined;

/** Reais (número, "12.34" ou Decimal do Prisma) → centavos inteiros. */
export function toCents(value: MoneyLike): number {
  if (value == null || value === '') return 0;
  const texto = typeof value === 'number' ? value.toFixed(4) : String(value).trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!m) {
    const n = Number(texto);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  const inteiro = Number(m[2]) * 100;
  const fracao = (m[3] ?? '').padEnd(3, '0');
  // Terceira casa arredonda para cima a partir de 5 (12.345 → 1235).
  const centavos = Number(fracao.slice(0, 2)) + (Number(fracao[2]) >= 5 ? 1 : 0);
  return (m[1] ? -1 : 1) * (inteiro + centavos);
}

/** Centavos → reais com duas casas, pronto para gravar num Decimal. */
export function fromCents(cents: number): string {
  const sinal = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Centavos → número em reais (para gráficos e telas que já usam `number`). */
export const centsToNumber = (cents: number): number => Math.round(cents) / 100;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 123456 → "R$ 1.234,56". */
export const formatCents = (cents: number): string => brl.format(centsToNumber(cents));

/** Texto digitado ("1.234,56", "R$ 50", "50,5") → centavos. Nulo se não for valor. */
export function parseMoney(text: string | null | undefined): number | null {
  if (text == null) return null;
  const limpo = text.replace(/[^\d,.-]/g, '').trim();
  if (!limpo || !/\d/.test(limpo)) return null;
  const negativo = limpo.startsWith('-');
  const semSinal = limpo.replace(/-/g, '');
  // A última vírgula ou ponto seguido de 1 ou 2 dígitos é o separador decimal.
  const m = /^(.*?)[,.](\d{1,2})$/.exec(semSinal);
  const inteiro = (m ? m[1] : semSinal).replace(/[,.]/g, '');
  const fracao = m ? m[2].padEnd(2, '0') : '00';
  if (!/^\d*$/.test(inteiro)) return null;
  const cents = Number(inteiro || '0') * 100 + Number(fracao);
  return negativo ? -cents : cents;
}

/**
 * Porcentagem de um valor, em centavos, arredondando meio centavo para cima.
 * `percent` aceita casas decimais (0.033). A conta é feita em inteiros.
 */
export function percentOf(cents: number, percent: number): number {
  // Até 6 casas na porcentagem, sem ponto flutuante na multiplicação.
  const escala = 1_000_000;
  const p = Math.round(percent * escala);
  const bruto = BigInt(Math.round(cents)) * BigInt(p);
  const divisor = BigInt(100) * BigInt(escala);
  const negativo = bruto < BigInt(0);
  const abs = negativo ? -bruto : bruto;
  const arred = (abs + divisor / BigInt(2)) / divisor;
  return Number(negativo ? -arred : arred);
}

export const sumCents = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0);

/** Limita entre um mínimo e um máximo. */
export const clampCents = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
