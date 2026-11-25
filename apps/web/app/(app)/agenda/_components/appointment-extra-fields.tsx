'use client';

import { useState, useTransition } from 'react';
import { CalendarRange } from 'lucide-react';
import { REPEAT_OPTIONS } from '@/lib/recurrence';
import { wallDateBR } from '@/lib/tz';
import { previewSeriesAction } from '../actions';

import { DateField } from '@/components/ui/date-field';
export interface AgendaNewOptions {
  careTypes: { id: string; name: string; color: string; durationMinutes: number; allowOverlap: boolean }[];
  resources: { id: string; name: string; color: string }[];
  holidays: { date: string; name: string; national: boolean }[];
  blockHolidays: boolean;
}

const field = 'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm';

/**
 * Campos da agenda nova na janela de agendar: tipo de atendimento (preenche a
 * duração), sala ou equipamento e a repetição, com a lista das datas antes de
 * salvar (as que dão conflito são puladas).
 */
export function AppointmentExtraFields({
  options,
  editing,
  initialCareTypeId,
  initialAgendaId,
  date,
  startTime,
  endTime,
  professionalId,
  onDuration,
}: {
  options: AgendaNewOptions;
  editing: boolean;
  initialCareTypeId?: string | null;
  initialAgendaId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  professionalId: string;
  onDuration: (minutes: number) => void;
}) {
  const [careTypeId, setCareTypeId] = useState(initialCareTypeId ?? '');
  const [agendaId, setAgendaId] = useState(initialAgendaId ?? '');
  const [repeat, setRepeat] = useState('none');
  const [count, setCount] = useState('4');
  const [until, setUntil] = useState('');
  const [every, setEvery] = useState('7');
  const [preview, setPreview] = useState<{ date: string; problem: string | null }[] | null>(null);
  const [pending, start] = useTransition();
  const feriado = options.holidays.find((h) => h.date === date);

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atendimento</legend>
      {feriado && (
        <p role="note" className={`rounded-lg px-3 py-2 text-sm ${options.blockHolidays ? 'bg-destructive/10 text-destructive' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}`}>
          {wallDateBR(date)} é feriado ({feriado.name}){options.blockHolidays ? ': a clínica não marca em feriado.' : '.'}
        </p>
      )}
      <input type="hidden" name="careTypeId" value={careTypeId} />
      <input type="hidden" name="agendaId" value={agendaId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="care-type" className="text-xs font-medium text-foreground">
            Tipo de atendimento
          </label>
          <select
            id="care-type"
            value={careTypeId}
            onChange={(e) => {
              setCareTypeId(e.target.value);
              const t = options.careTypes.find((c) => c.id === e.target.value);
              if (t) onDuration(t.durationMinutes);
            }}
            className={field}
          >
            <option value="">Nenhum</option>
            {options.careTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.durationMinutes} min)
              </option>
            ))}
          </select>
        </div>
        {options.resources.length > 0 && (
          <div className="space-y-1.5">
            <label htmlFor="agenda-resource" className="text-xs font-medium text-foreground">
              Sala ou equipamento
            </label>
            <select id="agenda-resource" value={agendaId} onChange={(e) => setAgendaId(e.target.value)} className={field}>
              <option value="">Nenhum</option>
              {options.resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!editing && (
        <div className="space-y-2">
          <input type="hidden" name="repeat" value={repeat} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="repeat" className="text-xs font-medium text-foreground">
                Repetir
              </label>
              <select
                id="repeat"
                value={repeat}
                onChange={(e) => {
                  setRepeat(e.target.value);
                  setPreview(null);
                }}
                className={field}
              >
                {REPEAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {repeat !== 'none' && (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="repeat-count" className="text-xs font-medium text-foreground">
                    Quantas vezes
                  </label>
                  <input id="repeat-count" name="repeatCount" type="number" min={2} max={104} value={count} onChange={(e) => setCount(e.target.value)} className={field} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="repeat-until" className="text-xs font-medium text-foreground">
                    Ou até
                  </label>
                  <DateField id="repeat-until" name="repeatUntil" value={until} onChange={(v) => setUntil(v)} className={field} />
                </div>
              </>
            )}
            {repeat === 'every' && (
              <div className="space-y-1.5">
                <label htmlFor="repeat-every" className="text-xs font-medium text-foreground">
                  A cada quantos dias
                </label>
                <input id="repeat-every" name="repeatEvery" type="number" min={1} max={365} value={every} onChange={(e) => setEvery(e.target.value)} className={field} />
              </div>
            )}
          </div>
          {repeat !== 'none' && (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () =>
                    setPreview(
                      await previewSeriesAction({
                        date,
                        startTime,
                        endTime,
                        professionalId,
                        agendaId,
                        careTypeId,
                        repeat,
                        repeatCount: Number(count) || undefined,
                        repeatUntil: until || undefined,
                        repeatEvery: Number(every) || undefined,
                      }),
                    ),
                  )
                }
                className="btn-outline btn-sm"
              >
                <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" /> {pending ? 'Conferindo…' : 'Ver as datas'}
              </button>
              {preview && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    {preview.length} datas · {preview.filter((p) => p.problem).length} com problema (serão puladas)
                  </p>
                  <ul className="mt-2 grid max-h-40 gap-1 overflow-y-auto text-sm sm:grid-cols-2" aria-label="Datas da repetição">
                    {preview.map((p) => (
                      <li key={p.date} className={p.problem ? 'text-destructive' : ''}>
                        {wallDateBR(p.date)}
                        {p.problem && <span className="text-xs"> · {p.problem}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
