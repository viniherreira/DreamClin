/**
 * Régua de cobrança: qual aviso sai hoje para cada conta (antes do
 * vencimento, no dia, depois) e o texto da clínica como modelo da Meta.
 * Puro e testado em `collection.test.ts`.
 */

import { daysBetween, type Day } from './dates';

export type CollectionPurpose = 'COLLECTION_REMINDER' | 'COLLECTION_OVERDUE';
export const COLLECTION_PURPOSES: CollectionPurpose[] = ['COLLECTION_REMINDER', 'COLLECTION_OVERDUE'];

export const COLLECTION_LABEL: Record<CollectionPurpose, string> = {
  COLLECTION_REMINDER: 'Lembrete de vencimento',
  COLLECTION_OVERDUE: 'Pagamento em atraso',
};

/** O começo do nome do modelo na Meta; a versão vai no fim (`dc_cobranca_atraso_2`). */
export const COLLECTION_TEMPLATE_PREFIX: Record<CollectionPurpose, string> = {
  COLLECTION_REMINDER: 'dc_cobranca_lembrete',
  COLLECTION_OVERDUE: 'dc_cobranca_atraso',
};

export const collectionTemplateName = (p: CollectionPurpose, version: number) => `${COLLECTION_TEMPLATE_PREFIX[p]}_${version}`;

export function collectionTemplateVersion(p: CollectionPurpose, name: string): number | null {
  const m = new RegExp(`^${COLLECTION_TEMPLATE_PREFIX[p]}_(\\d+)$`).exec(name);
  return m ? Number(m[1]) : null;
}

export const COLLECTION_KEYS = ['nome', 'valor', 'vencimento', 'clinica'] as const;
export type CollectionKey = (typeof COLLECTION_KEYS)[number];

const EXEMPLOS: Record<CollectionKey, string> = { nome: 'Ana', valor: 'R$ 150,00', vencimento: '20/11/2026', clinica: 'Clínica Sorriso' };

export const DEFAULT_COLLECTION_TEXT: Record<CollectionPurpose, string> = {
  COLLECTION_REMINDER: 'Olá, {nome}! Passando para lembrar que a parcela de {valor} com a {clinica} vence em {vencimento}. Se já pagou, desconsidere esta mensagem.',
  COLLECTION_OVERDUE: 'Olá, {nome}. Consta em aberto com a {clinica} o valor de {valor}, vencido em {vencimento}. Se precisar de ajuda para combinar o pagamento, responda esta mensagem. Se já pagou, desconsidere.',
};

export type CollectionDraft = { ok: true; body: string; varKeys: CollectionKey[]; examples: string[] } | { ok: false; message: string };

const VARIAVEL = /\{(nome|valor|vencimento|clinica)\}/gi;

/** O texto da clínica como modelo da Meta: cada {variável} vira {{n}} na ordem em que aparece. */
export function toCollectionTemplate(text: string): CollectionDraft {
  const limpo = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!limpo) return { ok: false, message: 'Escreva o texto da mensagem.' };
  if (limpo.length > 900) return { ok: false, message: 'O texto passa de 900 caracteres.' };
  const outras = limpo.match(/\{[^{}]*\}/g)?.filter((v) => !/^\{(nome|valor|vencimento|clinica)\}$/i.test(v)) ?? [];
  if (outras.length) return { ok: false, message: `Variável desconhecida: ${outras[0]}. Use {nome}, {valor}, {vencimento} e {clinica}.` };
  const varKeys: CollectionKey[] = [];
  const body = limpo.replace(VARIAVEL, (_, k: string) => {
    varKeys.push(k.toLowerCase() as CollectionKey);
    return `{{${varKeys.length}}}`;
  });
  // A Meta recusa modelo que começa ou termina com variável.
  if (/^\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}[.!?]?$/.test(body)) return { ok: false, message: 'A mensagem não pode começar nem terminar com uma variável.' };
  if (!varKeys.includes('valor') || !varKeys.includes('vencimento')) return { ok: false, message: 'Use {valor} e {vencimento} no texto.' };
  return { ok: true, body, varKeys, examples: varKeys.map((k) => EXEMPLOS[k]) };
}

export interface CollectionRule {
  enabled: boolean;
  daysBefore: number;
  onDueDay: boolean;
  daysAfter: number[];
}

/** O passo da régua que cabe hoje para uma conta, ou nulo. "B3" = 3 dias antes, "D0" = no dia, "A5" = 5 dias depois. */
export function stepFor(dueDate: Day, today: Day, rule: CollectionRule): { step: string; purpose: CollectionPurpose } | null {
  if (!rule.enabled) return null;
  const faltam = daysBetween(today, dueDate);
  if (rule.daysBefore > 0 && faltam === rule.daysBefore) return { step: `B${rule.daysBefore}`, purpose: 'COLLECTION_REMINDER' };
  if (rule.onDueDay && faltam === 0) return { step: 'D0', purpose: 'COLLECTION_REMINDER' };
  const atraso = -faltam;
  if (atraso > 0 && rule.daysAfter.includes(atraso)) return { step: `A${atraso}`, purpose: 'COLLECTION_OVERDUE' };
  return null;
}

/** As datas de vencimento que interessam hoje (para buscar só as contas certas). */
export function dueDatesFor(today: Day, rule: CollectionRule, addDays: (d: Day, n: number) => Day): Day[] {
  if (!rule.enabled) return [];
  const out: Day[] = [];
  if (rule.daysBefore > 0) out.push(addDays(today, rule.daysBefore));
  if (rule.onDueDay) out.push(today);
  for (const n of rule.daysAfter) out.push(addDays(today, -n));
  return [...new Set(out)];
}

/** Os valores das variáveis, na ordem do modelo. */
export function collectionParams(varKeys: readonly CollectionKey[], data: Record<CollectionKey, string>): string[] {
  return varKeys.map((k) => data[k]);
}

/** O texto como o paciente vai ler (para o histórico). */
export function fillCollection(body: string, params: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');
}
