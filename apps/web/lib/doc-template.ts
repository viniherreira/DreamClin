/**
 * Modelos de documento (spec 2026-11-18, F3): tipos, variáveis e a limpeza do
 * texto formatado que vem do editor. Puro e testado: o mesmo código limpa no
 * servidor ao salvar e prepara o texto para o PDF.
 */

export const DOC_KINDS = [
  { value: 'CERTIFICATE', label: 'Atestado', clinical: true },
  { value: 'ATTENDANCE', label: 'Declaração de comparecimento', clinical: false },
  { value: 'PRESCRIPTION', label: 'Receita', clinical: true },
  { value: 'EXAM_REQUEST', label: 'Pedido de exame', clinical: true },
  { value: 'REPORT', label: 'Laudo', clinical: true },
  { value: 'CONSENT', label: 'Termo de consentimento (TCLE)', clinical: false },
  { value: 'POST_CARE', label: 'Orientação pós-procedimento', clinical: false },
  { value: 'FREE', label: 'Documento livre', clinical: false },
] as const;

export type DocKind = (typeof DOC_KINDS)[number]['value'];

export function isDocKind(v: unknown): v is DocKind {
  return typeof v === 'string' && DOC_KINDS.some((k) => k.value === v);
}

export function docKindLabel(v: string): string {
  return DOC_KINDS.find((k) => k.value === v)?.label ?? 'Documento';
}

/** Atestado, receita, pedido de exame e laudo são dado de saúde: seguem o prontuário. */
export function isClinicalKind(v: string): boolean {
  return DOC_KINDS.find((k) => k.value === v)?.clinical ?? false;
}

export const DOC_VARIABLES = [
  { key: 'paciente', label: 'Nome do paciente' },
  { key: 'cpf', label: 'CPF' },
  { key: 'nascimento', label: 'Data de nascimento' },
  { key: 'idade', label: 'Idade' },
  { key: 'endereco', label: 'Endereço' },
  { key: 'data', label: 'Data de hoje' },
  { key: 'hora', label: 'Hora de agora' },
  { key: 'profissional', label: 'Profissional' },
  { key: 'registro_profissional', label: 'Registro do profissional (CRO/CRM)' },
  { key: 'clinica', label: 'Nome da clínica' },
  { key: 'cidade', label: 'Cidade da clínica' },
  { key: 'procedimento', label: 'Procedimento' },
  { key: 'dias', label: 'Dias (atestado)' },
] as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Troca `{variavel}` e `{campo:Nome}` pelos valores (já escapados). Variável
 * sem valor vira uma linha para preencher à mão, para o papel não sair com
 * "{cpf}" impresso.
 */
export function renderTemplate(body: string, vars: Record<string, string | undefined>, fields: Record<string, string> = {}): string {
  return body.replace(/\{([a-z_]+)(?::([^{}]{1,60}))?\}/gi, (all, key: string, campo?: string) => {
    if (key.toLowerCase() === 'campo' && campo) {
      const v = fields[campo.trim().toLowerCase()];
      return v ? esc(v) : '__________';
    }
    const k = key.toLowerCase();
    if (!DOC_VARIABLES.some((d) => d.key === k)) return all;
    const v = vars[k];
    return v ? esc(v) : '__________';
  });
}

// ─── Limpeza do HTML ────────────────────────────────────────────────────────

const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span']);
const RENAME: Record<string, string> = { div: 'p', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3' };
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'head', 'title']);
const VOID = new Set(['br']);
const COLOR = /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;
const SIZE = /^(1[0-9]|2[0-8]|[8-9])px$/;

/** Só cor e tamanho da fonte sobrevivem no `style` de um `span`. */
function cleanStyle(attrs: string): string {
  const m = attrs.match(/style\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!m) return '';
  const css = (m[2] ?? m[3] ?? '').split(';');
  const ok: string[] = [];
  for (const decl of css) {
    const [prop, ...rest] = decl.split(':');
    const p = prop?.trim().toLowerCase();
    const v = rest.join(':').trim();
    if (p === 'color' && COLOR.test(v)) ok.push(`color: ${v}`);
    if (p === 'font-size' && SIZE.test(v)) ok.push(`font-size: ${v}`);
  }
  return ok.length ? ` style="${ok.join('; ')}"` : '';
}

/**
 * Deixa só as marcas da lista (negrito, itálico, sublinhado, listas, títulos,
 * tabela e `span` com cor e tamanho). Tira atributos, comentários, script e
 * qualquer coisa com evento ou endereço. Fecha o que ficou aberto.
 */
export function sanitizeDocHtml(input: string): string {
  const html = (input ?? '').slice(0, 100_000).replace(/<!--[\s\S]*?-->/g, '');
  const out: string[] = [];
  const stack: string[] = [];
  let skip: string | null = null;
  let last = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let m: RegExpExecArray | null;
  const text = (t: string) => {
    if (skip) return;
    // Texto solto: sem "<" ou ">" crus.
    out.push(t.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  };
  while ((m = re.exec(html))) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    const closing = m[1] === '/';
    let tag = m[2].toLowerCase();
    if (skip) {
      if (closing && tag === skip) skip = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !/\/\s*$/.test(m[3])) skip = tag;
      continue;
    }
    tag = RENAME[tag] ?? tag;
    if (!ALLOWED.has(tag)) continue;
    if (VOID.has(tag)) {
      if (!closing) out.push('<br>');
      continue;
    }
    if (closing) {
      const i = stack.lastIndexOf(tag);
      if (i === -1) continue;
      while (stack.length > i) out.push(`</${stack.pop()}>`);
    } else {
      stack.push(tag);
      out.push(`<${tag}${tag === 'span' ? cleanStyle(m[3]) : ''}>`);
    }
  }
  text(html.slice(last));
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('').replace(/&(?!(amp|lt|gt|quot|#39|nbsp|#\d{1,6});)/g, '&amp;');
}

// ─── Do HTML limpo para o PDF ───────────────────────────────────────────────

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  size?: number;
}

export type Block =
  | { type: 'p' | 'h2' | 'h3'; runs: Run[] }
  | { type: 'li'; ordered: boolean; index: number; runs: Run[] }
  | { type: 'table'; rows: { header: boolean; cells: Run[][] }[] };

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d{1,6});/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

/**
 * Transforma o HTML limpo em blocos (parágrafos, títulos, itens de lista e
 * tabelas) com trechos formatados, que o PDF desenha. Espera o que sai de
 * `sanitizeDocHtml`.
 */
export function docHtmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const fmt: { bold: number; italic: number; underline: number; color: string[]; size: number[] } = { bold: 0, italic: 0, underline: 0, color: [], size: [] };
  let runs: Run[] = [];
  const lists: { ordered: boolean; n: number }[] = [];
  let table: { header: boolean; cells: Run[][] }[] | null = null;
  let row: { header: boolean; cells: Run[][] } | null = null;
  let inCell = false;
  let current: 'p' | 'h2' | 'h3' | 'li' = 'p';
  const spanStack: { color?: boolean; size?: boolean }[] = [];

  const flush = () => {
    if (inCell) return;
    const limpos = runs.filter((r) => r.text.length);
    if (limpos.some((r) => r.text.trim())) {
      if (current === 'li') {
        const l = lists[lists.length - 1];
        blocks.push({ type: 'li', ordered: Boolean(l?.ordered), index: l ? ++l.n : 1, runs: limpos });
      } else blocks.push({ type: current, runs: limpos });
    }
    runs = [];
    current = 'p';
  };
  const push = (t: string) => {
    if (!t) return;
    runs.push({
      text: decode(t),
      ...(fmt.bold ? { bold: true } : {}),
      ...(fmt.italic ? { italic: true } : {}),
      ...(fmt.underline ? { underline: true } : {}),
      ...(fmt.color.length ? { color: fmt.color[fmt.color.length - 1] } : {}),
      ...(fmt.size.length ? { size: fmt.size[fmt.size.length - 1] } : {}),
    });
  };

  const re = /<(\/?)([a-z0-9]+)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    push(html.slice(last, m.index).replace(/\s+/g, ' '));
    last = re.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2];
    switch (tag) {
      case 'p':
      case 'h2':
      case 'h3':
        flush();
        if (!closing) current = tag;
        break;
      case 'li':
        flush();
        if (!closing) current = 'li';
        break;
      case 'ul':
      case 'ol':
        flush();
        if (closing) lists.pop();
        else lists.push({ ordered: tag === 'ol', n: 0 });
        break;
      case 'br':
        push('\n');
        break;
      case 'strong':
      case 'b':
        fmt.bold += closing ? -1 : 1;
        break;
      case 'em':
      case 'i':
        fmt.italic += closing ? -1 : 1;
        break;
      case 'u':
        fmt.underline += closing ? -1 : 1;
        break;
      case 'span':
        if (closing) {
          const s = spanStack.pop();
          if (s?.color) fmt.color.pop();
          if (s?.size) fmt.size.pop();
        } else {
          const color = m[3].match(/color:\s*([^;"]+)/)?.[1]?.trim();
          const size = m[3].match(/font-size:\s*(\d+)px/)?.[1];
          if (color) fmt.color.push(color);
          if (size) fmt.size.push(Number(size));
          spanStack.push({ color: !!color, size: !!size });
        }
        break;
      case 'table':
        flush();
        if (closing) {
          if (table?.length) blocks.push({ type: 'table', rows: table });
          table = null;
        } else table = [];
        break;
      case 'tr':
        if (closing) {
          if (row && table) table.push(row);
          row = null;
        } else row = { header: false, cells: [] };
        break;
      case 'td':
      case 'th':
        if (closing) {
          if (row) row.cells.push(runs.filter((r) => r.text.trim()));
          runs = [];
          inCell = false;
        } else {
          runs = [];
          inCell = true;
          if (row && tag === 'th') row.header = true;
        }
        break;
    }
  }
  push(html.slice(last).replace(/\s+/g, ' '));
  inCell = false;
  flush();
  return blocks;
}
