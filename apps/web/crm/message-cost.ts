/**
 * Quanto a Meta cobra, por cima, para mandar um modelo do WhatsApp a muita
 * gente. A cobrança é da Meta, no cartão da clínica, por mensagem entregue;
 * o DreamClin não cobra nada. Valores arredondados para cima da tabela da Meta
 * para o Brasil (cobrança em reais, tabela de 1º/10/2026). A Meta só muda a
 * tabela no 1º dia de um trimestre: conferir em
 * developers.facebook.com/docs/whatsapp/pricing e atualizar aqui.
 */
export const REAIS_POR_MENSAGEM = {
  MARKETING: 0.35,
  UTILITY: 0.04,
} as const;

export type CostCategory = keyof typeof REAIS_POR_MENSAGEM;

export const CATEGORY_LABEL: Record<CostCategory, string> = {
  MARKETING: 'marketing',
  UTILITY: 'utilidade',
};

/** Custo estimado em reais para `pessoas` mensagens da categoria. */
export function estimateCost(category: string, pessoas: number): number | null {
  const preco = REAIS_POR_MENSAGEM[category as CostCategory];
  if (preco === undefined || !Number.isFinite(pessoas) || pessoas <= 0) return null;
  return Math.round(preco * pessoas * 100) / 100;
}

/** "R$ 77,35" (abaixo de R$ 1, com centavos; o resto também). */
export const formatReais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
