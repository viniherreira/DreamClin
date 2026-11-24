'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SCHEDULE_REPEATS, type RepeatKind } from '@/lib/schedule-rules';
import { clinicToday, wallDateBR } from '@/lib/tz';
import { archiveScheduleRule, listSchedules, removeScheduleException, saveScheduleException, saveScheduleRule } from '../schedule-actions';

type Data = NonNullable<Awaited<ReturnType<typeof listSchedules>>>;
const field = 'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm';
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const novaRegra = (professionalId: string) => ({
  professionalId,
  unitId: '',
  careTypeId: '',
  startsOn: clinicToday(),
  endsOn: '',
  repeat: 'WEEKLY' as RepeatKind,
  weekdays: [1, 2, 3, 4, 5],
  everyDays: 2,
  monthDay: 1,
  start1: '08:00',
  end1: '12:00',
  start2: '14:00',
  end2: '18:00',
});

/** Escalas: em que dias e horários cada profissional atende, com vigência, folgas e plantões. */
export function SchedulesPanel() {
  const titulo = useId();
  const [data, setData] = useState<Data | null>(null);
  const [prof, setProf] = useState('');
  const [form, setForm] = useState<ReturnType<typeof novaRegra> | null>(null);
  const [choques, setChoques] = useState<{ id: string; text: string }[] | null>(null);
  const [exc, setExc] = useState({ date: clinicToday(), kind: 'OFF' as 'OFF' | 'EXTRA', start: '08:00', end: '12:00', reason: '' });
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [pending, start] = useTransition();

  const carregar = useCallback(async () => {
    const d = await listSchedules();
    setData(d);
    if (d && !prof && d.professionals[0]) setProf(d.professionals[0].id);
  }, [prof]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const regras = data.rules.filter((r) => r.professionalId === prof);
  const excecoes = data.exceptions.filter((e) => e.professionalId === prof);

  const salvar = (escolha?: 'keep' | 'replace') =>
    start(async () => {
      if (!form) return;
      setErro('');
      setAviso('');
      const r = await saveScheduleRule(
        {
          ...form,
          unitId: form.unitId || null,
          careTypeId: form.careTypeId || null,
          endsOn: form.endsOn || null,
          start2: form.start2 || null,
          end2: form.end2 || null,
        },
        escolha,
      );
      if (!r.ok) {
        if ('conflicts' in r) return setChoques(r.conflicts);
        return setErro(r.message);
      }
      setChoques(null);
      setForm(null);
      setAviso('Escala salva. A agenda, os horários livres e o agendamento online já seguem ela.');
      await carregar();
    });

  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, ok: string) =>
    start(async () => {
      setErro('');
      setAviso('');
      const r = await fn();
      if (!r.ok) return setErro(r.message);
      setAviso(ok);
      await carregar();
    });

  return (
    <section aria-labelledby={titulo} className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-card">
      <div>
        <h2 id={titulo} className="text-base font-semibold">
          Escalas
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Em que dias e horários cada profissional atende, por período. Enquanto o profissional não tiver escala aqui, vale o horário de atendimento do cadastro dele.
        </p>
      </div>

      <label className="block max-w-sm text-xs">
        <span className="text-muted-foreground">Profissional</span>
        <select
          value={prof}
          onChange={(e) => {
            setProf(e.target.value);
            setForm(null);
            setChoques(null);
          }}
          className={field}
        >
          {data.professionals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div>
        <h3 className="text-sm font-semibold">Regras</h3>
        {regras.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Sem escala: usa o horário de atendimento do cadastro.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {regras.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">
                  {r.text}
                  {(r.unitId || r.careTypeId) && (
                    <span className="block text-xs text-muted-foreground">
                      {[data.units.find((u) => u.id === r.unitId)?.name, data.careTypes.find((c) => c.id === r.careTypeId)?.name ? `só ${data.careTypes.find((c) => c.id === r.careTypeId)?.name}` : null].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <button type="button" disabled={pending} onClick={() => run(() => archiveScheduleRule(r.id), 'Escala tirada.')} className="btn-ghost btn-sm text-destructive" aria-label={`Tirar a escala ${r.text}`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!form && prof && (
          <button type="button" onClick={() => setForm(novaRegra(prof))} className="btn-outline btn-sm mt-2">
            <Plus className="h-4 w-4" aria-hidden="true" /> Nova regra
          </button>
        )}
      </div>

      {form && (
        <form
          className="space-y-3 rounded-lg border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">
              <span className="text-muted-foreground">Vale a partir de</span>
              <input type="date" required value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} className={field} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Até (vazio = sem fim)</span>
              <input type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} className={field} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Repetição</span>
              <select value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value as RepeatKind })} className={field}>
                {SCHEDULE_REPEATS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            {form.repeat === 'EVERY_N_DAYS' && (
              <label className="text-xs">
                <span className="text-muted-foreground">A cada quantos dias</span>
                <input type="number" min={1} max={60} value={form.everyDays} onChange={(e) => setForm({ ...form, everyDays: Number(e.target.value) })} className={field} />
              </label>
            )}
            {form.repeat === 'MONTH_DAY' && (
              <label className="text-xs">
                <span className="text-muted-foreground">Dia do mês</span>
                <input type="number" min={1} max={31} value={form.monthDay} onChange={(e) => setForm({ ...form, monthDay: Number(e.target.value) })} className={field} />
              </label>
            )}
          </div>
          {(form.repeat === 'WEEKLY' || form.repeat === 'BIWEEKLY') && (
            <fieldset>
              <legend className="text-xs text-muted-foreground">Dias da semana</legend>
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                {DIAS.map((d, i) => (
                  <label key={d} className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.weekdays.includes(i)}
                      onChange={(e) => setForm({ ...form, weekdays: e.target.checked ? [...form.weekdays, i] : form.weekdays.filter((x) => x !== i) })}
                      className="h-4 w-4 accent-primary"
                    />
                    {d}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">
              <span className="text-muted-foreground">1º período: início</span>
              <input type="time" required value={form.start1} onChange={(e) => setForm({ ...form, start1: e.target.value })} className={field} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">1º período: fim</span>
              <input type="time" required value={form.end1} onChange={(e) => setForm({ ...form, end1: e.target.value })} className={field} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">2º período: início (opcional)</span>
              <input type="time" value={form.start2} onChange={(e) => setForm({ ...form, start2: e.target.value })} className={field} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">2º período: fim</span>
              <input type="time" value={form.end2} onChange={(e) => setForm({ ...form, end2: e.target.value })} className={field} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.units.length > 1 && (
              <label className="text-xs">
                <span className="text-muted-foreground">Unidade</span>
                <select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} className={field}>
                  <option value="">A principal</option>
                  {data.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {data.careTypes.length > 0 && (
              <label className="text-xs">
                <span className="text-muted-foreground">Tipo de atendimento</span>
                <select value={form.careTypeId} onChange={(e) => setForm({ ...form, careTypeId: e.target.value })} className={field}>
                  <option value="">Todos</option>
                  {data.careTypes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {choques && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="font-medium">Essa escala se choca com:</p>
              <ul className="mt-1 list-disc pl-5">
                {choques.map((c) => (
                  <li key={c.id}>{c.text}</li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={pending} onClick={() => salvar('replace')} className="btn-primary btn-sm">
                  Substituir a antiga
                </button>
                <button type="button" disabled={pending} onClick={() => salvar('keep')} className="btn-outline btn-sm">
                  Manter as duas
                </button>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setForm(null);
                setChoques(null);
              }}
              className="btn-outline btn-sm"
            >
              Cancelar
            </button>
            <button type="submit" disabled={pending} className="btn-primary btn-sm">
              Salvar regra
            </button>
          </div>
        </form>
      )}

      <div>
        <h3 className="text-sm font-semibold">Folgas e plantões</h3>
        {excecoes.length > 0 && (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {excecoes.map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-24 tabular-nums">{wallDateBR(e.date)}</span>
                <span className="flex-1">
                  {e.kind === 'OFF' ? 'Folga' : `Plantão ${e.start}–${e.end}`}
                  {e.reason && <span className="text-muted-foreground"> · {e.reason}</span>}
                </span>
                <button type="button" disabled={pending} onClick={() => run(() => removeScheduleException(e.id), 'Tirado.')} className="btn-ghost btn-sm text-destructive" aria-label={`Tirar ${e.kind === 'OFF' ? 'folga' : 'plantão'} de ${wallDateBR(e.date)}`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            run(() => saveScheduleException({ professionalId: prof, ...exc }), exc.kind === 'OFF' ? 'Folga marcada.' : 'Plantão marcado.');
          }}
        >
          <label className="text-xs">
            <span className="block text-muted-foreground">Dia</span>
            <input type="date" required value={exc.date} onChange={(e) => setExc({ ...exc, date: e.target.value })} className={field} />
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">Tipo</span>
            <select value={exc.kind} onChange={(e) => setExc({ ...exc, kind: e.target.value as 'OFF' | 'EXTRA' })} className={field}>
              <option value="OFF">Folga (o dia todo)</option>
              <option value="EXTRA">Plantão (horário a mais)</option>
            </select>
          </label>
          {exc.kind === 'EXTRA' && (
            <>
              <label className="text-xs">
                <span className="block text-muted-foreground">Início</span>
                <input type="time" value={exc.start} onChange={(e) => setExc({ ...exc, start: e.target.value })} className={field} />
              </label>
              <label className="text-xs">
                <span className="block text-muted-foreground">Fim</span>
                <input type="time" value={exc.end} onChange={(e) => setExc({ ...exc, end: e.target.value })} className={field} />
              </label>
            </>
          )}
          <label className="min-w-[10rem] flex-1 text-xs">
            <span className="block text-muted-foreground">Motivo (opcional)</span>
            <input value={exc.reason} onChange={(e) => setExc({ ...exc, reason: e.target.value })} className={field} />
          </label>
          <button type="submit" disabled={pending || !prof} className="btn-outline btn-md">
            Marcar
          </button>
        </form>
      </div>

      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {aviso}
        </p>
      )}
    </section>
  );
}
