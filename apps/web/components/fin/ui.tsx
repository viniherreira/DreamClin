'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Lock, X } from 'lucide-react';
import { formatCents, parseMoney } from '@/lib/financeiro/money';

/**
 * Peças pequenas que as telas do financeiro repetem: caixa da seção, campo com
 * rótulo, campo de dinheiro, chave liga/desliga e o carregador de listas.
 */

/** O campo sem largura, para quem define a própria (`w-24`, `w-56`). */
export const inputBaseCls =
  'h-9 rounded-lg border border-border bg-surface px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60';

export const inputCls = `${inputBaseCls} w-full`;

export function Panel({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-t`} className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-t`} className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: (id: string) => React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="mt-1">{children(id)}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Campo de dinheiro: a pessoa digita "1.234,56" e o valor sai em centavos. */
export function MoneyInput({
  id,
  value,
  onChange,
  disabled,
  allowNegative = false,
  ariaLabel,
  className = '',
}: {
  id?: string;
  value: number;
  onChange: (cents: number) => void;
  disabled?: boolean;
  allowNegative?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const mostra = (c: number) => (c === 0 ? '' : formatCents(c).replace(/^-?R\$\s?/, c < 0 ? '-' : ''));
  const [texto, setTexto] = useState(mostra(value));
  const [foco, setFoco] = useState(false);
  useEffect(() => {
    if (!foco) setTexto(mostra(value));
  }, [value, foco]);
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">
        R$
      </span>
      <input
        id={id}
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        value={texto}
        placeholder="0,00"
        onFocus={() => setFoco(true)}
        onBlur={() => {
          setFoco(false);
          setTexto(mostra(value));
        }}
        onChange={(e) => {
          setTexto(e.target.value);
          const c = parseMoney(e.target.value) ?? 0;
          onChange(allowNegative ? c : Math.abs(c));
        }}
        className={`${inputCls} pl-9 text-right tabular-nums`}
      />
    </div>
  );
}

/** Porcentagem com casas decimais ("4,5"). */
export function PercentInput({ id, value, onChange, ariaLabel, disabled }: { id?: string; value: number | null; onChange: (v: number | null) => void; ariaLabel?: string; disabled?: boolean }) {
  const [texto, setTexto] = useState(value == null ? '' : String(value).replace('.', ','));
  useEffect(() => {
    setTexto((t) => (Number(t.replace(',', '.')) === value ? t : value == null ? '' : String(value).replace('.', ',')));
  }, [value]);
  return (
    <div className="relative">
      <input
        id={id}
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        value={texto}
        placeholder="0"
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d,.]/g, '');
          setTexto(t);
          const n = Number(t.replace(',', '.'));
          onChange(t && Number.isFinite(n) ? n : null);
        }}
        className={`${inputCls} pr-7 text-right tabular-nums`}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">
        %
      </span>
    </div>
  );
}

/** Chave liga/desliga com rótulo e explicação. */
export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${checked ? 'bg-primary' : 'bg-border'}`}
      >
        <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} aria-hidden="true" />
      </button>
    </div>
  );
}

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue'; children: React.ReactNode }) {
  const cor = {
    gray: 'bg-surface-alt text-muted-foreground',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${cor}`}>{children}</span>;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

/** Aviso de recurso que não está no plano: aparece com cadeado, nunca some sem explicar. */
export function PlanLock({ what }: { what: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-surface-alt/50 p-4 text-sm">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p>
        <span className="font-medium">{what}</span> está disponível no plano Profissional.{' '}
        <a href="/configuracoes#plano" className="font-medium text-primary underline-offset-2 hover:underline">
          Ver planos
        </a>
      </p>
    </div>
  );
}

/** Carrega uma lista por Server Action ao abrir a tela e deixa recarregar depois de salvar. */
export function useLoader<T>(load: () => Promise<T>, empty: T) {
  const [data, setData] = useState<T>(empty);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    setData(await load());
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, loaded, reload };
}

/** Janela do financeiro (Radix Dialog), no mesmo desenho das outras janelas do sistema. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: 'md' | 'lg' | 'xl';
  children: React.ReactNode;
}) {
  const largura = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[92dvh] w-[calc(100vw-1.5rem)] ${largura} -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl focus:outline-none`}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">{description}</Dialog.Description>}
            </div>
            <Dialog.Close aria-label="Fechar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <X className="h-4 w-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
