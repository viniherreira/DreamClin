'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { AutoRefresh } from '@/components/auto-refresh';
import { ACTION_LABELS, STAGE_LABELS, actionsFor, stageOf, waitingMinutes, type FlowAction } from '@/lib/appointment-flow';
import { ageFromBirth, clinicToday, wallClockTime, wallDateBR } from '@/lib/tz';
import { advanceAppointment } from '../actions';
import type { myDay } from '../operacao-actions';

type Data = NonNullable<Awaited<ReturnType<typeof myDay>>>;

const COR: Record<string, string> = {
  SCHEDULED: 'bg-surface-alt text-foreground',
  CONFIRMED: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100',
  ARRIVED: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  IN_PROGRESS: 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100',
  ATTENDED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
  MISSED: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
  CANCELLED: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
  RESCHEDULED: 'bg-surface-alt text-muted-foreground',
};

// Só os passos do dia do profissional; cancelar e voltar ficam na agenda.
const ACOES_DO_DIA: FlowAction[] = ['arrive', 'start', 'finish', 'miss'];

export function MyDayView({ data }: { data: Data }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState('');
  const atendidos = data.items.filter((i) => i.status === 'ATTENDED').length;

  return (
    <div className="space-y-4">
      <AutoRefresh every={30_000} paused={pending} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meu dia</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {wallDateBR(clinicToday())} · {data.items.length} {data.items.length === 1 ? 'paciente' : 'pacientes'} · {atendidos} atendidos
          </p>
        </div>
        {data.professionals.length > 1 && (
          <label className="text-xs">
            <span className="block text-muted-foreground">Profissional</span>
            <select
              value={data.professional?.id ?? ''}
              onChange={(e) => router.push(`/agenda/meu-dia?profissional=${e.target.value}`)}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            >
              {data.professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      {!data.professional ? (
        <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">Seu usuário não está ligado a um profissional. Peça ao responsável para ligar em Configurações, Profissionais.</p>
      ) : data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">Nenhum paciente hoje.</p>
      ) : (
        <ol className="space-y-2">
          {data.items.map((i) => {
            const etapa = stageOf(i);
            const acoes = actionsFor(etapa).filter((a) => ACOES_DO_DIA.includes(a));
            const espera = etapa === 'ARRIVED' ? waitingMinutes(i) : null;
            const idade = ageFromBirth(i.patient.birthDate);
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-card">
                <span className="w-12 text-lg font-semibold tabular-nums">{wallClockTime(i.startTime)}</span>
                <div className="min-w-[12rem] flex-1">
                  <Link href={`/pacientes/${i.patient.id}`} className="font-medium hover:underline">
                    {i.patient.name}
                  </Link>
                  {idade !== null && <span className="ml-1 text-xs text-muted-foreground">{idade} anos</span>}
                  <p className="text-xs text-muted-foreground">{[i.careType, i.procedures.join(', '), i.room].filter(Boolean).join(' · ') || 'Consulta'}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COR[etapa] ?? ''}`}>
                  {STAGE_LABELS[etapa]}
                  {espera !== null ? ` há ${espera} min` : ''}
                </span>
                <span className="flex flex-wrap gap-1">
                  {acoes.map((a, idx) => (
                    <button
                      key={a}
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          setErro('');
                          const r = await advanceAppointment(i.id, a);
                          if (!r.ok) setErro(r.message);
                          router.refresh();
                        })
                      }
                      className={idx === 0 ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                    >
                      {ACTION_LABELS[a]}
                    </button>
                  ))}
                  {data.canRecord && (
                    <Link href={`/pacientes/${i.patient.id}?aba=evolucoes`} className="btn-outline btn-sm">
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Prontuário
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
