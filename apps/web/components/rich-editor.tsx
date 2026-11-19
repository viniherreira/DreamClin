'use client';

import { useEffect, useRef } from 'react';
import { Bold, Italic, List, ListOrdered, Table, Underline } from 'lucide-react';
import { DOC_VARIABLES } from '@/lib/doc-template';

/**
 * Editor de texto simples dos modelos e documentos: negrito, itálico,
 * sublinhado, listas, título, tabela, tamanho e cor da fonte, e as variáveis
 * ({paciente}, {data}…). O HTML sai do jeito do navegador e é limpo no
 * servidor ao salvar (`sanitizeDocHtml`).
 */
export function RichEditor({
  value,
  onChange,
  label,
  variables = true,
  extraVariables = [],
}: {
  value: string;
  onChange: (html: string) => void;
  label: string;
  variables?: boolean;
  extraVariables?: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  // O conteúdo entra uma vez, à mão: deixar o React cuidar dos filhos de um
  // contentEditable apagava o que a pessoa digitava a cada tecla.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value && document.activeElement !== ref.current) ref.current.innerHTML = value;
  }, [value]);

  const cmd = (name: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    onChange(ref.current?.innerHTML ?? '');
  };
  const inserir = (html: string) => cmd('insertHTML', html);
  const btn = 'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-sm text-muted-foreground hover:bg-surface-alt hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div role="toolbar" aria-label={`Formatação de ${label}`} className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-alt/50 px-1.5 py-1">
        <button type="button" className={btn} onClick={() => cmd('bold')} aria-label="Negrito" title="Negrito">
          <Bold className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={btn} onClick={() => cmd('italic')} aria-label="Itálico" title="Itálico">
          <Italic className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={btn} onClick={() => cmd('underline')} aria-label="Sublinhado" title="Sublinhado">
          <Underline className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={btn} onClick={() => cmd('insertUnorderedList')} aria-label="Lista" title="Lista">
          <List className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={btn} onClick={() => cmd('insertOrderedList')} aria-label="Lista numerada" title="Lista numerada">
          <ListOrdered className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={btn} onClick={() => cmd('formatBlock', 'h2')} aria-label="Título" title="Título">
          T
        </button>
        <button type="button" className={btn} onClick={() => cmd('formatBlock', 'p')} aria-label="Texto normal" title="Texto normal">
          ¶
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => inserir('<table><tbody><tr><th>Coluna 1</th><th>Coluna 2</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p></p>')}
          aria-label="Tabela"
          title="Tabela"
        >
          <Table className="h-4 w-4" aria-hidden="true" />
        </button>
        <label className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          Tamanho
          <select
            className="h-7 rounded border border-border bg-background px-1 text-xs"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = '';
              if (v) inserir(`<span style="font-size: ${v}px">${window.getSelection()?.toString() || 'texto'}</span>`);
            }}
          >
            <option value="">—</option>
            {[10, 12, 14, 16, 20, 24].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          Cor
          <input type="color" defaultValue="#0f3b82" className="h-7 w-8 cursor-pointer rounded border border-border bg-background" onChange={(e) => cmd('foreColor', e.target.value)} />
        </label>
        {variables && (
          <label className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            Variável
            <select
              className="h-7 max-w-[11rem] rounded border border-border bg-background px-1 text-xs"
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = '';
                if (v) inserir(v);
              }}
            >
              <option value="">Inserir…</option>
              {DOC_VARIABLES.map((v) => (
                <option key={v.key} value={`{${v.key}}`}>
                  {v.label}
                </option>
              ))}
              {extraVariables.map((n) => (
                <option key={n} value={`{campo:${n}}`}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        className="doc-body min-h-[16rem] max-h-[32rem] overflow-y-auto bg-background p-4 text-sm leading-relaxed focus-visible:outline-none"
      />
    </div>
  );
}
