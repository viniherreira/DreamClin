'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { clinicToday } from '@/lib/tz';

import { DateField } from '@/components/ui/date-field';
interface Option { id: string; name: string }

interface Props {
  from: string;
  to: string;
  professionalId: string;
  procedureId: string;
  professionals: Option[];
  procedures: Option[];
}

/**
 * Os períodos rápidos, a partir do dia da clínica. As contas são em UTC sobre
 * AAAA-MM-DD: dão o mesmo no servidor e no navegador, a qualquer hora.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);
function periodos(hoje: string) {
  const [y, m, d] = hoje.split('-').map(Number);
  const dia = (yy: number, mm: number, dd: number) => iso(new Date(Date.UTC(yy, mm, dd)));
  return {
    today: { from: hoje, to: hoje },
    '7d': { from: dia(y, m - 1, d - 6), to: hoje },
    month: { from: dia(y, m - 1, 1), to: hoje },
    lastMonth: { from: dia(y, m - 2, 1), to: dia(y, m - 1, 0) },
  } as const;
}

export function FinanceFilters({ from, to, professionalId, procedureId, professionals, procedures }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  function preset(kind: 'today' | '7d' | 'month' | 'lastMonth') {
    setParams(periodos(clinicToday())[kind]);
  }

  const isActive = (() => {
    const p = periodos(clinicToday());
    return (['today', '7d', 'month', 'lastMonth'] as const).find((k) => p[k].from === from && p[k].to === to) ?? 'custom';
  })();

  const presets = [
    { k: 'today', l: 'Hoje' },
    { k: '7d', l: '7 dias' },
    { k: 'month', l: 'Este mês' },
    { k: 'lastMonth', l: 'Mês passado' },
  ] as const;

  const dateCls = 'h-9 rounded-md border border-border bg-background px-2.5 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-3 shadow-card sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="segmented" role="group" aria-label="Período rápido">
          {presets.map((p) => (
            <button
              key={p.k}
              type="button"
              onClick={() => preset(p.k)}
              aria-pressed={isActive === p.k}
              className="segmented-item"
            >
              {p.l}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <DateField value={from} max={to} onChange={(v) => v && setParams({ from: v })} aria-label="Data inicial" className={dateCls} />
          <span className="text-sm text-muted-foreground">até</span>
          <DateField value={to} min={from} onChange={(v) => v && setParams({ to: v })} aria-label="Data final" className={dateCls} />
        </div>

        {isPending && <span aria-live="polite" className="text-xs text-muted-foreground">Atualizando…</span>}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={professionalId || '__all__'} onValueChange={(v) => setParams({ professionalId: v === '__all__' ? null : v })}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Filtrar por profissional"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os profissionais</SelectItem>
            {professionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={procedureId || '__all__'} onValueChange={(v) => setParams({ procedureId: v === '__all__' ? null : v })}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Filtrar por procedimento"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os procedimentos</SelectItem>
            {procedures.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
