'use client';

import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { addDays, addMonths, format, isValid, parse, startOfMonth, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Campo de data no visual do DreamClin, no lugar do calendário do navegador
 * (que não segue o tema). Dá para digitar ("26112026" vira 26/11/2026; colar
 * 2026-11-26 também vale) ou escolher no calendário do botão.
 *
 * Por fora funciona como o `<input type="date">`: o valor é "AAAA-MM-DD" (ou
 * vazio), e com `name` vai num campo escondido para o formulário.
 */
export interface DateFieldProps {
  id?: string;
  name?: string;
  /** "AAAA-MM-DD" ou vazio. Com `value`, quem usa guarda o estado. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  /** Classes do campo de texto (as mesmas que o input usava). */
  className?: string;
  /** Classes da caixa que envolve campo e botão (largura fixa e margem vão aqui). */
  wrapperClassName?: string;
  placeholder?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  autoFocus?: boolean;
  title?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function toDate(iso: string): Date | null {
  if (!ISO.test(iso)) return null;
  const d = parse(iso, 'yyyy-MM-dd', new Date(2000, 0, 1));
  return isValid(d) ? d : null;
}
const toIso = (d: Date) => format(d, 'yyyy-MM-dd');
const toBr = (iso: string) => (ISO.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** O que a pessoa digitou, já com as barras: "2611" → "26/11". */
function mask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "26/11/2026" ou "2026-11-26" → "2026-11-26"; incompleto ou inexistente → null. */
export function parseTypedDate(text: string): string | null {
  const t = text.trim();
  if (ISO.test(t)) return toDate(t) ? t : null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = toDate(iso);
  // 31/02 vira 03/03 no parse frouxo: confere que o dia voltou igual.
  return d && toIso(d) === iso ? iso : null;
}

/** Setas andam um dia ou uma semana; Page Up/Down, um mês. */
const PASSOS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [-7, 0],
  ArrowDown: [7, 0],
  PageUp: [0, -1],
  PageDown: [0, 1],
};

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  {
    id,
    name,
    value,
    defaultValue = '',
    onChange,
    min,
    max,
    required,
    disabled,
    className = '',
    wrapperClassName = '',
    placeholder = 'dd/mm/aaaa',
    'aria-label': ariaLabel,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    autoFocus,
    title,
  },
  ref,
) {
  const controlado = value !== undefined;
  const [interno, setInterno] = useState(defaultValue);
  const atual = controlado ? (value ?? '') : interno;
  const [texto, setTexto] = useState(toBr(atual));
  const [aberto, setAberto] = useState(false);

  // O valor mudou por fora (outro dia escolhido, formulário limpo): o texto acompanha.
  const ultimo = useRef(atual);
  useEffect(() => {
    if (atual === ultimo.current) return;
    ultimo.current = atual;
    setTexto(toBr(atual));
  }, [atual]);

  const emitir = (iso: string) => {
    ultimo.current = iso;
    if (!controlado) setInterno(iso);
    onChange?.(iso);
  };

  return (
    // A caixa acompanha o campo: larga quando ele é largo, do tamanho dele quando não é
    // (senão o botão do calendário ficaria longe do campo).
    <div className={`relative ${wrapperClassName || (/(^|\s)w-full(\s|$)/.test(className) ? 'w-full' : 'inline-block align-middle')}`}>
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={texto}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={ariaInvalid}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        title={title}
        onChange={(e) => {
          const bruto = e.target.value;
          // Colou ou o teste preencheu "2026-11-26": aceita como está.
          const t = ISO.test(bruto.trim()) ? toBr(bruto.trim()) : mask(bruto);
          setTexto(t);
          const iso = parseTypedDate(t);
          if (iso) emitir(iso);
          else if (t === '') emitir('');
        }}
        onBlur={() => {
          // Ficou pela metade: volta ao último valor que valia.
          if (texto && !parseTypedDate(texto)) setTexto(toBr(atual));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && e.altKey) {
            e.preventDefault();
            setAberto(true);
          }
        }}
        className={`${className} pr-9 tabular-nums`}
      />
      {name && <input type="hidden" name={name} value={atual} />}
      <Popover.Root open={aberto} onOpenChange={setAberto}>
        <Popover.Trigger
          type="button"
          disabled={disabled}
          aria-label="Escolher no calendário"
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="z-[60] w-[17.5rem] rounded-xl border border-border bg-surface p-3 text-foreground shadow-xl shadow-black/10 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 dark:shadow-black/40"
          >
            <Calendar
              value={atual}
              min={min}
              max={max}
              clearable={!required}
              onPick={(iso) => {
                setTexto(toBr(iso));
                emitir(iso);
                setAberto(false);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
});

function Calendar({
  value,
  min,
  max,
  clearable,
  onPick,
}: {
  value: string;
  min?: string;
  max?: string;
  clearable: boolean;
  onPick: (iso: string) => void;
}) {
  const hoje = toIso(new Date());
  const inicial = toDate(value) ?? toDate(hoje)!;
  const [mes, setMes] = useState(startOfMonth(inicial));
  // O dia com o foco do teclado.
  const [foco, setFoco] = useState(toIso(inicial));
  const grade = useRef<HTMLDivElement>(null);
  // Só o teclado (e a abertura) puxam o foco para o dia; as setas do topo não.
  const focarDia = useRef(true);
  const uid = useId();

  const dias = useMemo(() => {
    const primeiro = startOfWeek(mes, { weekStartsOn: 0 });
    return Array.from({ length: 42 }, (_, i) => addDays(primeiro, i));
  }, [mes]);

  // O dia que entra pelo Tab: o do foco, se está no mês à vista; senão o dia 1.
  const tabDia = dias.some((d) => toIso(d) === foco && d.getMonth() === mes.getMonth()) ? foco : toIso(mes);

  const fora = (iso: string) => Boolean((min && iso < min) || (max && iso > max));

  // Abriu ou andou pelo teclado: o botão do dia recebe o foco.
  useEffect(() => {
    if (!focarDia.current) return;
    focarDia.current = false;
    grade.current?.querySelector<HTMLButtonElement>(`[data-dia="${foco}"]`)?.focus();
  }, [foco]);

  const moverFoco = (n: number, meses = 0) => {
    // Parte do dia com foco se ele está na grade; senão, do dia que entra pelo Tab.
    const base = toDate(dias.some((d) => toIso(d) === foco) ? foco : tabDia)!;
    const novo = meses ? addMonths(base, meses) : addDays(base, n);
    focarDia.current = true;
    setFoco(toIso(novo));
    if (novo.getMonth() !== mes.getMonth() || novo.getFullYear() !== mes.getFullYear()) setMes(startOfMonth(novo));
  };

  const anoAtual = new Date().getFullYear();
  const anoMin = Math.min(min ? Number(min.slice(0, 4)) : 1900, mes.getFullYear());
  const anoMax = Math.max(max ? Number(max.slice(0, 4)) : anoAtual + 10, mes.getFullYear());
  const anos = Array.from({ length: anoMax - anoMin + 1 }, (_, i) => anoMax - i);
  const irPara = (ano: number, m: number) => {
    const novo = new Date(ano, m, 1);
    setMes(novo);
    setFoco(toIso(novo));
  };
  const seletor =
    'h-8 cursor-pointer rounded-md border border-transparent bg-transparent px-1.5 text-sm font-semibold capitalize hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring';

  return (
    <div>
      <div className="flex items-center gap-1">
        <label htmlFor={`${uid}-mes`} className="sr-only">
          Mês
        </label>
        <select id={`${uid}-mes`} value={mes.getMonth()} onChange={(e) => irPara(mes.getFullYear(), Number(e.target.value))} className={seletor}>
          {Array.from({ length: 12 }, (_, m) => (
            <option key={m} value={m}>
              {format(new Date(2000, m, 1), 'MMMM', { locale: ptBR })}
            </option>
          ))}
        </select>
        <label htmlFor={`${uid}-ano`} className="sr-only">
          Ano
        </label>
        <select id={`${uid}-ano`} value={mes.getFullYear()} onChange={(e) => irPara(Number(e.target.value), mes.getMonth())} className={`${seletor} tabular-nums`}>
          {anos.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <div className="ml-auto flex">
          <button
            type="button"
            onClick={() => setMes((m) => addMonths(m, -1))}
            aria-label="Mês anterior"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-alt hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setMes((m) => addMonths(m, 1))}
            aria-label="Próximo mês"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-alt hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-muted-foreground" aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div
        ref={grade}
        role="group"
        aria-label={format(mes, "MMMM 'de' yyyy", { locale: ptBR })}
        className="grid grid-cols-7 gap-0.5"
      >
        {dias.map((d) => {
          const iso = toIso(d);
          const doMes = d.getMonth() === mes.getMonth();
          const escolhido = iso === value;
          const eHoje = iso === hoje;
          const bloqueado = fora(iso);
          return (
            <button
              key={iso}
              type="button"
              data-dia={iso}
              tabIndex={iso === tabDia ? 0 : -1}
              disabled={bloqueado}
              aria-pressed={escolhido}
              aria-current={eHoje ? 'date' : undefined}
              aria-label={`${WEEKDAY_NAMES[d.getDay()]}, ${format(d, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}`}
              onClick={() => onPick(iso)}
              onKeyDown={(e) => {
                const p = PASSOS[e.key];
                if (!p) return;
                e.preventDefault();
                moverFoco(p[0], p[1]);
              }}
              onFocus={() => iso !== foco && setFoco(iso)}
              className={[
                'flex h-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-30',
                escolhido
                  ? 'bg-primary font-semibold text-primary-foreground hover:bg-primary-hover'
                  : eHoje
                    ? 'font-semibold text-primary ring-1 ring-inset ring-primary/50 hover:bg-primary/10'
                    : doMes
                      ? 'text-foreground hover:bg-surface-alt'
                      : 'text-muted-foreground/60 hover:bg-surface-alt',
              ].join(' ')}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        {clearable ? (
          <button type="button" onClick={() => onPick('')} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-alt hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            Limpar
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={fora(hoje)}
          onClick={() => onPick(hoje)}
          className="rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
        >
          Hoje
        </button>
      </div>
    </div>
  );
}

/**
 * Um botão qualquer (o dia no topo da agenda) que abre o mesmo calendário.
 */
export function DatePickerButton({
  value,
  onPick,
  label,
  className = '',
  children,
}: {
  value: string;
  onPick: (iso: string) => void;
  /** Nome para leitor de tela, se o conteúdo não basta. */
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger type="button" aria-label={label} className={className}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={6}
          collisionPadding={12}
          className="z-[60] w-[17.5rem] rounded-xl border border-border bg-surface p-3 text-foreground shadow-xl shadow-black/10 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 dark:shadow-black/40"
        >
          <Calendar
            value={value}
            clearable={false}
            onPick={(iso) => {
              if (iso) onPick(iso);
              setAberto(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
