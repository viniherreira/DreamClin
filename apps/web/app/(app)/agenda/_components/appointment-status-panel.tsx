'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { CalendarClock } from 'lucide-react';
import { STATUS_CHOICES } from '@/lib/appointment-status';
import { cancelAppointmentFull, cancelOptionsAction, rescheduleAppointmentAction, setStatusDirectAction } from '../actions';

import { DateField } from '@/components/ui/date-field';
const field = 'h-9 w-full rounded-md border border-border bg-surface px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring';

/**
 * Situação do agendamento com o paciente e a agenda novos: trocar pela lista,
 * cancelar dizendo quem cancelou e o motivo da lista da clínica, e remarcar
 * para outro dia, hora ou profissional (fica o registro de onde veio).
 */
export function AppointmentStatusPanel({
  appointmentId,
  status,
  date,
  startTime,
  endTime,
  professionalId,
  professionals,
  inSeries = false,
  onDone,
}: {
  /** Faz parte de uma repetição: cancelar pergunta se é só este, este e os próximos ou todos. */
  inSeries?: boolean;
  appointmentId: string;
  status: string;
  date: string;
  startTime: string;
  endTime: string;
  professionalId: string;
  professionals: { id: string; name: string }[];
  onDone: (r: { closed?: boolean; message: string; openCents?: number }) => void;
}) {
  const id = useId();
  const [modo, setModo] = useState<'' | 'cancelar' | 'remarcar'>('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const [opcoes, setOpcoes] = useState<{ reasons: { id: string; name: string }[]; required: boolean } | null>(null);
  const [cancel, setCancel] = useState({ cancelledBy: '', reasonId: '', reasonText: '', scope: 'one' as 'one' | 'next' | 'all' });
  const [rem, setRem] = useState({ date, startTime, endTime, professionalId, reason: '' });

  useEffect(() => {
    if (modo === 'cancelar' && !opcoes) void cancelOptionsAction().then((o) => setOpcoes(o ?? { reasons: [], required: false }));
  }, [modo, opcoes]);

  const encerrado = status === 'CANCELLED' || status === 'ATTENDED' || status === 'MISSED';
  const outro = opcoes?.reasons.find((r) => r.id === cancel.reasonId)?.name === 'Outro';

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="block min-w-[12rem] flex-1 text-sm">
          <label htmlFor={`${id}-situacao`} className="text-xs font-medium text-muted-foreground">
            Situação
          </label>
          <select
            id={`${id}-situacao`}
            className={field}
            value={status === 'RESCHEDULED' ? 'SCHEDULED' : status}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              setErro('');
              if (v === 'CANCELLED') return setModo('cancelar');
              start(async () => {
                const r = await setStatusDirectAction(appointmentId, v as 'SCHEDULED' | 'CONFIRMED' | 'ATTENDED' | 'MISSED');
                if (!r.ok) return setErro(r.message);
                onDone({ message: 'Situação alterada.', closed: v === 'MISSED', openCents: r.openCents });
              });
            }}
          >
            {STATUS_CHOICES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {!encerrado && (
          <button type="button" onClick={() => setModo(modo === 'remarcar' ? '' : 'remarcar')} aria-expanded={modo === 'remarcar'} className="btn-outline btn-sm h-9">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Remarcar
          </button>
        )}
      </div>

      {modo === 'cancelar' && (
        <form
          className="space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/30"
          onSubmit={(e) => {
            e.preventDefault();
            setErro('');
            start(async () => {
              const r = await cancelAppointmentFull(appointmentId, { cancelledBy: cancel.cancelledBy, reasonId: cancel.reasonId || null, reasonText: cancel.reasonText, scope: cancel.scope });
              if (!r.ok) return setErro(r.message);
              onDone({ message: 'Agendamento cancelado.', closed: true });
            });
          }}
        >
          <fieldset>
            <legend className="text-sm font-medium">Quem cancelou</legend>
            <div className="mt-1 flex gap-4 text-sm">
              {[
                { v: 'PATIENT', l: 'O paciente' },
                { v: 'CLINIC', l: 'A clínica' },
              ].map((o) => (
                <label key={o.v} className="inline-flex items-center gap-2">
                  <input type="radio" name={`${id}-quem`} checked={cancel.cancelledBy === o.v} onChange={() => setCancel({ ...cancel, cancelledBy: o.v })} className="h-4 w-4 accent-primary" />
                  {o.l}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="block text-sm">
            <label htmlFor={`${id}-motivo`} className="font-medium">
              Motivo {opcoes && !opcoes.required && <span className="font-normal text-muted-foreground">(opcional)</span>}
            </label>
            <select id={`${id}-motivo`} value={cancel.reasonId} onChange={(e) => setCancel({ ...cancel, reasonId: e.target.value })} className={`${field} mt-1`}>
              <option value="">{opcoes ? 'Escolha' : 'Carregando…'}</option>
              {opcoes?.reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {inSeries && (
            <fieldset>
              <legend className="text-sm font-medium">Este agendamento se repete. Cancelar</legend>
              <div className="mt-1 flex flex-wrap gap-4 text-sm">
                {[
                  { v: 'one', l: 'Só este' },
                  { v: 'next', l: 'Este e os próximos' },
                  { v: 'all', l: 'Todos da repetição' },
                ].map((o) => (
                  <label key={o.v} className="inline-flex items-center gap-2">
                    <input type="radio" name={`${id}-escopo`} checked={cancel.scope === o.v} onChange={() => setCancel({ ...cancel, scope: o.v as 'one' | 'next' | 'all' })} className="h-4 w-4 accent-primary" />
                    {o.l}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Os já atendidos não mudam.</p>
            </fieldset>
          )}
          <label className="block text-sm">
            <span className="font-medium">{outro ? 'Qual o motivo' : 'Detalhe'}</span> {!outro && <span className="text-muted-foreground">(opcional)</span>}
            <input value={cancel.reasonText} onChange={(e) => setCancel({ ...cancel, reasonText: e.target.value })} maxLength={200} className={`${field} mt-1`} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-sm inline-flex items-center rounded-md bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">
              Confirmar cancelamento
            </button>
            <button type="button" onClick={() => setModo('')} className="btn-ghost btn-sm">
              Voltar
            </button>
          </div>
        </form>
      )}

      {modo === 'remarcar' && (
        <form
          className="space-y-2 rounded-lg border border-border bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setErro('');
            start(async () => {
              const r = await rescheduleAppointmentAction(appointmentId, rem);
              if (!r.ok) return setErro(r.message);
              setModo('');
              onDone({ message: 'Agendamento remarcado.' });
            });
          }}
        >
          <p className="text-sm font-medium">Remarcar para</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block text-xs">
              <span className="text-muted-foreground">Data</span>
              <DateField value={rem.date} onChange={(v) => setRem({ ...rem, date: v })} className={field} />
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">Início</span>
              <input type="time" value={rem.startTime} onChange={(e) => setRem({ ...rem, startTime: e.target.value })} className={field} />
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">Fim</span>
              <input type="time" value={rem.endTime} onChange={(e) => setRem({ ...rem, endTime: e.target.value })} className={field} />
            </label>
          </div>
          <div className="block text-xs">
            <label htmlFor={`${id}-prof`} className="text-muted-foreground">
              Profissional
            </label>
            <select id={`${id}-prof`} value={rem.professionalId} onChange={(e) => setRem({ ...rem, professionalId: e.target.value })} className={field}>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <label className="block text-xs">
            <span className="text-muted-foreground">Motivo (opcional)</span>
            <input value={rem.reason} onChange={(e) => setRem({ ...rem, reason: e.target.value })} maxLength={200} className={field} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary btn-sm">
              {pending ? 'Remarcando…' : 'Confirmar remarcação'}
            </button>
            <button type="button" onClick={() => setModo('')} className="btn-ghost btn-sm">
              Voltar
            </button>
          </div>
        </form>
      )}
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}
