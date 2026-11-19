/**
 * Regras puras do cadastro completo do paciente (spec 2026-11-18, F1):
 * listas fixas, campos obrigatórios que a clínica escolhe e as informações
 * adicionais (campos próprios da clínica). Sem banco: a tela e o servidor
 * validam com as mesmas funções.
 */

// ─── Listas fixas ────────────────────────────────────────────────────────────

export const SEX_OPTIONS = [
  { value: 'F', label: 'Feminino' },
  { value: 'M', label: 'Masculino' },
  { value: 'O', label: 'Outro' },
  { value: 'N', label: 'Prefiro não informar' },
] as const;

export const MARITAL_OPTIONS = [
  { value: 'solteiro', label: 'Solteiro(a)' },
  { value: 'casado', label: 'Casado(a)' },
  { value: 'uniao', label: 'União estável' },
  { value: 'divorciado', label: 'Divorciado(a)' },
  { value: 'viuvo', label: 'Viúvo(a)' },
] as const;

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const EDUCATION_OPTIONS = [
  'Fundamental incompleto',
  'Fundamental completo',
  'Médio incompleto',
  'Médio completo',
  'Superior incompleto',
  'Superior completo',
  'Pós-graduação',
] as const;

export const PRIORITY_TYPES = [
  { value: 'IDOSO_60', label: 'Idoso 60+' },
  { value: 'IDOSO_80', label: 'Idoso 80+' },
  { value: 'PCD', label: 'Pessoa com deficiência' },
  { value: 'GESTANTE', label: 'Gestante' },
  { value: 'LACTANTE', label: 'Lactante' },
  { value: 'CRIANCA_COLO', label: 'Criança de colo' },
  { value: 'TEA', label: 'TEA' },
  { value: 'OUTRO', label: 'Outro' },
] as const;

export function priorityLabel(type: string | null | undefined): string {
  return PRIORITY_TYPES.find((p) => p.value === type)?.label ?? 'Prioritário';
}

export const CONTACT_KINDS = ['Celular', 'Telefone', 'Trabalho', 'Recado', 'Outro'] as const;

/** Origens que toda clínica ganha na primeira vez (dá para renomear, apagar e criar outras). */
export const DEFAULT_ORIGINS = ['Instagram', 'Facebook', 'Google', 'Indicação', 'WhatsApp', 'Fachada', 'Convênio', 'Campanha', 'Site'] as const;

// ─── Campos obrigatórios ─────────────────────────────────────────────────────

/** Nome, nascimento e celular são sempre obrigatórios. Estes a clínica pode tornar. */
export const OPTIONAL_REQUIRABLE = [
  { key: 'cpf', label: 'CPF' },
  { key: 'email', label: 'E-mail' },
  { key: 'sex', label: 'Sexo' },
  { key: 'zipCode', label: 'CEP' },
  { key: 'address', label: 'Endereço (rua e número)' },
  { key: 'origin', label: 'Origem do paciente' },
  { key: 'rg', label: 'RG' },
  { key: 'motherName', label: 'Nome da mãe' },
] as const;

export type RequirableKey = (typeof OPTIONAL_REQUIRABLE)[number]['key'];

export interface PatientSettings {
  required: RequirableKey[];
  receptionCanExport: boolean;
}

export const PATIENT_SETTINGS_DEFAULTS: PatientSettings = { required: [], receptionCanExport: false };

/** Lê `Tenant.settings.patients` sem confiar no formato. */
export function readPatientSettings(settings: unknown): PatientSettings {
  const raw = (settings as { patients?: unknown } | null)?.patients as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return { ...PATIENT_SETTINGS_DEFAULTS, required: [] };
  const keys = new Set<string>(OPTIONAL_REQUIRABLE.map((o) => o.key));
  const required = Array.isArray(raw.required) ? (raw.required.filter((k) => typeof k === 'string' && keys.has(k)) as RequirableKey[]) : [];
  return { required: [...new Set(required)], receptionCanExport: raw.receptionCanExport === true };
}

export interface RequirableValues {
  cpf?: string | null;
  foreigner?: boolean;
  foreignDoc?: string | null;
  email?: string | null;
  sex?: string | null;
  zipCode?: string | null;
  street?: string | null;
  addressNumber?: string | null;
  originId?: string | null;
  rg?: string | null;
  motherName?: string | null;
}

/**
 * Os obrigatórios da clínica que ficaram em branco: { campo: mensagem }.
 * `cpfLater` é o "Preencher depois" do passo do CPF: deixa salvar sem ele.
 * Estrangeiro troca o CPF pelo documento.
 */
export function missingRequired(required: readonly RequirableKey[], v: RequirableValues, opts: { cpfLater?: boolean } = {}): Record<string, string> {
  const vazio = (x: string | null | undefined) => !x || !x.trim();
  const faltam: Record<string, string> = {};
  for (const k of required) {
    if (k === 'cpf') {
      if (opts.cpfLater) continue;
      if (v.foreigner ? vazio(v.foreignDoc) : vazio(v.cpf)) faltam[v.foreigner ? 'foreignDoc' : 'cpf'] = 'Obrigatório nesta clínica';
    } else if (k === 'address') {
      if (vazio(v.street)) faltam.street = 'Obrigatório nesta clínica';
      if (vazio(v.addressNumber)) faltam.addressNumber = 'Obrigatório nesta clínica';
    } else if (k === 'sex') {
      if (vazio(v.sex)) faltam.gender = 'Obrigatório nesta clínica';
    } else if (k === 'origin') {
      if (vazio(v.originId)) faltam.originId = 'Obrigatório nesta clínica';
    } else if (vazio(v[k])) {
      faltam[k] = 'Obrigatório nesta clínica';
    }
  }
  return faltam;
}

// ─── Informações adicionais ──────────────────────────────────────────────────

export const CUSTOM_FIELD_TYPES = [
  { value: 'SHORT_TEXT', label: 'Texto curto' },
  { value: 'LONG_TEXT', label: 'Texto longo' },
  { value: 'DATE', label: 'Data' },
  { value: 'NUMBER', label: 'Número' },
  { value: 'SINGLE', label: 'Escolha única' },
  { value: 'MULTI', label: 'Múltipla escolha' },
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]['value'];

export function isCustomFieldType(v: unknown): v is CustomFieldType {
  return typeof v === 'string' && CUSTOM_FIELD_TYPES.some((t) => t.value === v);
}

export interface CustomFieldDef {
  id: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  hasNote: boolean;
  highlight: boolean;
  active: boolean;
}

/** Uma resposta: o valor (texto, número em texto, data AAAA-MM-DD ou lista) e a observação. */
export interface CustomAnswer {
  v: string | string[];
  obs?: string;
}

export type CustomAnswers = Record<string, CustomAnswer>;

export function readCustomAnswers(raw: unknown): CustomAnswers {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: CustomAnswers = {};
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const { v, obs } = val as { v?: unknown; obs?: unknown };
    if (typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))) {
      out[k] = { v: v as string | string[], ...(typeof obs === 'string' && obs.trim() ? { obs: obs.trim().slice(0, 500) } : {}) };
    }
  }
  return out;
}

const vazioResposta = (a: CustomAnswer | undefined) => !a || (Array.isArray(a.v) ? a.v.length === 0 : !a.v.trim());

/**
 * Confere as respostas contra os campos ativos: tira o que não é campo ativo,
 * corta textos, recusa opção que não existe e número ou data inválidos.
 * Devolve as respostas limpas e os erros por campo.
 */
export function cleanCustomAnswers(defs: readonly CustomFieldDef[], raw: CustomAnswers): { answers: CustomAnswers; errors: Record<string, string> } {
  const answers: CustomAnswers = {};
  const errors: Record<string, string> = {};
  for (const d of defs) {
    if (!d.active) continue;
    const a = raw[d.id];
    if (vazioResposta(a)) {
      if (d.required) errors[d.id] = 'Obrigatório';
      continue;
    }
    const obs = d.hasNote && a!.obs ? a!.obs.slice(0, 500) : undefined;
    const keep = (v: string | string[]) => {
      answers[d.id] = obs ? { v, obs } : { v };
    };
    const texto = Array.isArray(a!.v) ? a!.v.join(', ') : a!.v.trim();
    switch (d.type) {
      case 'SHORT_TEXT':
        keep(texto.slice(0, 200));
        break;
      case 'LONG_TEXT':
        keep(texto.slice(0, 2000));
        break;
      case 'NUMBER': {
        const n = Number(texto.replace(',', '.'));
        if (!Number.isFinite(n)) errors[d.id] = 'Número inválido';
        else keep(String(n));
        break;
      }
      case 'DATE':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || Number.isNaN(new Date(`${texto}T00:00:00Z`).getTime())) errors[d.id] = 'Data inválida';
        else keep(texto);
        break;
      case 'SINGLE':
        if (!d.options.includes(texto)) errors[d.id] = 'Escolha uma das opções';
        else keep(texto);
        break;
      case 'MULTI': {
        const lista = (Array.isArray(a!.v) ? a!.v : [a!.v]).filter((x) => d.options.includes(x));
        if (!lista.length) {
          if (d.required) errors[d.id] = 'Obrigatório';
        } else keep([...new Set(lista)]);
        break;
      }
    }
  }
  return { answers, errors };
}

/** A resposta em texto para a tela e o relatório ("Sim", "12/03/2026", "A, B"). */
export function answerText(def: Pick<CustomFieldDef, 'type'>, a: CustomAnswer | undefined): string {
  if (!a) return '';
  if (Array.isArray(a.v)) return a.v.join(', ');
  if (def.type === 'DATE' && /^\d{4}-\d{2}-\d{2}$/.test(a.v)) {
    const [y, m, d] = a.v.split('-');
    return `${d}/${m}/${y}`;
  }
  return a.v;
}

/** As respostas destacadas viram alerta no cabeçalho do paciente e na janela do agendamento. */
export function highlightedAnswers(defs: readonly CustomFieldDef[], answers: CustomAnswers): { id: string; label: string; text: string }[] {
  return defs
    .filter((d) => d.active && d.highlight && !vazioResposta(answers[d.id]))
    .map((d) => {
      const a = answers[d.id];
      const texto = answerText(d, a);
      return { id: d.id, label: d.label, text: a?.obs ? `${texto} (${a.obs})` : texto };
    });
}

/** Opções digitadas uma por linha (ou por vírgula), sem repetir nem vazias. */
export function parseOptions(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\n|;/)
        .map((s) => s.trim().slice(0, 80))
        .filter(Boolean),
    ),
  ].slice(0, 30);
}
