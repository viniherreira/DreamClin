import { cleanCustomAnswers, readCustomAnswers, type CustomAnswers, type CustomFieldDef } from './patient-fields';

/**
 * Questionários (spec 2026-11-18, F3): perguntas guardadas em JSON no
 * questionário, mesmos tipos das informações adicionais e mais "Sim ou não".
 * A pergunta pode apontar para uma da anamnese (`anamnesisKey`): a resposta do
 * paciente entra na anamnese dele.
 */

export const QUESTION_TYPES = [
  { value: 'YESNO', label: 'Sim ou não' },
  { value: 'SHORT_TEXT', label: 'Texto curto' },
  { value: 'LONG_TEXT', label: 'Texto longo' },
  { value: 'DATE', label: 'Data' },
  { value: 'NUMBER', label: 'Número' },
  { value: 'SINGLE', label: 'Escolha única' },
  { value: 'MULTI', label: 'Múltipla escolha' },
] as const;

export interface Question {
  id: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  /** Pergunta da anamnese padrão (`ANAMNESIS_QUESTIONS`), resposta sim/não com detalhe. */
  anamnesisKey?: string;
}

const TIPOS = new Set<string>(QUESTION_TYPES.map((t) => t.value));

export function readQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q) => q && typeof q === 'object' && typeof q.id === 'string' && typeof q.label === 'string' && TIPOS.has(q.type))
    .map((q) => ({
      id: String(q.id).slice(0, 40),
      label: String(q.label).trim().slice(0, 200),
      type: q.type,
      options: Array.isArray(q.options) ? q.options.filter((o: unknown) => typeof o === 'string').map((o: string) => o.slice(0, 80)).slice(0, 30) : [],
      required: q.required === true,
      ...(typeof q.anamnesisKey === 'string' && q.anamnesisKey ? { anamnesisKey: q.anamnesisKey.slice(0, 40) } : {}),
    }))
    .filter((q) => q.label)
    .slice(0, 80);
}

/** A pergunta como um campo, para reaproveitar a limpeza das informações adicionais. */
function asField(q: Question): CustomFieldDef {
  const yesno = q.type === 'YESNO';
  return {
    id: q.id,
    label: q.label,
    type: yesno ? 'SINGLE' : q.type,
    options: yesno ? ['Sim', 'Não'] : q.options,
    required: q.required,
    // Sim/não da anamnese tem detalhe ("qual alergia?").
    hasNote: yesno,
    highlight: false,
    active: true,
  };
}

export function cleanQuestionnaireAnswers(questions: readonly Question[], raw: unknown): { answers: CustomAnswers; errors: Record<string, string> } {
  return cleanCustomAnswers(questions.map(asField), readCustomAnswers(raw));
}

/**
 * O que vai para a anamnese do paciente: as perguntas ligadas a uma da
 * anamnese padrão, como `{ value: 'yes'|'no', detail }`.
 */
export function anamnesisItemsFrom(questions: readonly Question[], answers: CustomAnswers, validKeys: ReadonlySet<string>): Record<string, { value: 'yes' | 'no'; detail?: string }> {
  const out: Record<string, { value: 'yes' | 'no'; detail?: string }> = {};
  for (const q of questions) {
    if (!q.anamnesisKey || !validKeys.has(q.anamnesisKey) || q.type !== 'YESNO') continue;
    const a = answers[q.id];
    if (!a || Array.isArray(a.v)) continue;
    if (a.v !== 'Sim' && a.v !== 'Não') continue;
    out[q.anamnesisKey] = { value: a.v === 'Sim' ? 'yes' : 'no', ...(a.obs ? { detail: a.obs } : {}) };
  }
  return out;
}
