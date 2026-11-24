'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { LABEL_COLORS, LABEL_COLOR_NAMES, labelClasses } from '@/lib/label-colors';
import { holidaysBetween } from '@/lib/holidays';
import { wallDateBR } from '@/lib/tz';
import {
  archiveCareType,
  archiveResource,
  listAgendaConfig,
  removeHoliday,
  saveCareType,
  saveHoliday,
  saveResource,
  setBlockHolidays,
  type CareTypeInput,
} from '../agenda-config-actions';

type Data = NonNullable<Awaited<ReturnType<typeof listAgendaConfig>>>;
const field = 'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm';

function useConfig() {
  const [data, setData] = useState<Data | null>(null);
  const carregar = useCallback(async () => setData(await listAgendaConfig()), []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, ok: string, depois?: () => void) =>
    start(async () => {
      setErro('');
      setAviso('');
      const r = await fn();
      if (!r.ok) return setErro(r.message);
      setAviso(ok);
      depois?.();
      await carregar();
    });
  const msgs = (
    <>
      {erro && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
          {aviso}
        </p>
      )}
    </>
  );
  return { data, pending, run, msgs };
}

function Box({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ColorSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={field}>
      {LABEL_COLORS.map((c) => (
        <option key={c} value={c}>
          {LABEL_COLOR_NAMES[c]}
        </option>
      ))}
    </select>
  );
}

const VAZIO: CareTypeInput = { name: '', color: 'blue', durationMinutes: 30, allowOverlap: false, chargeable: true };

export function CareTypesPanel() {
  const id = useId();
  const { data, pending, run, msgs } = useConfig();
  const [edit, setEdit] = useState<CareTypeInput | null>(null);
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return (
    <Box title="Tipos de atendimento" desc="Consulta, avaliação, retorno, procedimento, encaixe… Cada um com cor e duração. O tipo de pagamento (particular, convênio, cortesia) continua à parte.">
      {data.careTypes.length > 0 && (
        <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
          {data.careTypes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className={`h-3 w-3 rounded-full ${labelClasses(c.color).dot}`} aria-hidden="true" />
              <span className="flex-1 font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.durationMinutes} min</span>
              {c.allowOverlap && <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[11px]">encaixe</span>}
              {!c.chargeable && <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[11px]">sem cobrança</span>}
              <button type="button" onClick={() => setEdit({ ...c })} className="btn-ghost btn-sm" aria-label={`Editar ${c.name}`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Tirar "${c.name}" da lista? Os agendamentos que já têm continuam com ele.`)) run(() => archiveCareType(c.id), 'Tipo removido.');
                }}
                className="btn-ghost btn-sm"
                aria-label={`Tirar ${c.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`${id}-n`} className="text-xs font-medium text-muted-foreground">
                Nome
              </label>
              <input id={`${id}-n`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={field} />
            </div>
            <div>
              <label htmlFor={`${id}-c`} className="text-xs font-medium text-muted-foreground">
                Cor
              </label>
              <ColorSelect id={`${id}-c`} value={edit.color} onChange={(color) => setEdit({ ...edit, color })} />
            </div>
            <div>
              <label htmlFor={`${id}-d`} className="text-xs font-medium text-muted-foreground">
                Duração (min)
              </label>
              <input id={`${id}-d`} type="number" min={5} max={480} step={5} value={edit.durationMinutes} onChange={(e) => setEdit({ ...edit, durationMinutes: Number(e.target.value) })} className={field} />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={edit.allowOverlap} onChange={(e) => setEdit({ ...edit, allowOverlap: e.target.checked })} className="h-4 w-4 accent-primary" /> Permite horário sobreposto (encaixe)
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={edit.chargeable} onChange={(e) => setEdit({ ...edit, chargeable: e.target.checked })} className="h-4 w-4 accent-primary" /> Gera cobrança
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEdit(null)} className="btn-outline btn-sm">
              Cancelar
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => saveCareType(edit), 'Tipo salvo.', () => setEdit(null))} className="btn-primary btn-sm">
              Salvar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEdit({ ...VAZIO })} className="btn-outline btn-md">
          <Plus className="h-4 w-4" aria-hidden="true" /> Novo tipo
        </button>
      )}
      {msgs}
    </Box>
  );
}

export function ResourcesPanel() {
  const id = useId();
  const { data, pending, run, msgs } = useConfig();
  const [edit, setEdit] = useState<{ id?: string; name: string; color: string; allowOverlap: boolean } | null>(null);
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return (
    <Box title="Salas e equipamentos" desc="Agendas além do profissional: sala, cadeira, equipamento (laser, ultrassom) ou canal (avaliação online). A agenda confere o horário do profissional e o da sala.">
      {data.resources.length > 0 && (
        <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
          {data.resources.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className={`h-3 w-3 rounded-full ${labelClasses(r.color).dot}`} aria-hidden="true" />
              <span className="flex-1 font-medium">{r.name}</span>
              {r.allowOverlap && <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[11px]">aceita sobreposto</span>}
              <button type="button" onClick={() => setEdit({ ...r })} className="btn-ghost btn-sm" aria-label={`Editar ${r.name}`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Tirar "${r.name}" da lista?`)) run(() => archiveResource(r.id), 'Removido.');
                }}
                className="btn-ghost btn-sm"
                aria-label={`Tirar ${r.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-n`} className="text-xs font-medium text-muted-foreground">
                Nome
              </label>
              <input id={`${id}-n`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={field} placeholder="Sala 1" />
            </div>
            <div>
              <label htmlFor={`${id}-c`} className="text-xs font-medium text-muted-foreground">
                Cor
              </label>
              <ColorSelect id={`${id}-c`} value={edit.color} onChange={(color) => setEdit({ ...edit, color })} />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={edit.allowOverlap} onChange={(e) => setEdit({ ...edit, allowOverlap: e.target.checked })} className="h-4 w-4 accent-primary" /> Permite horário sobreposto
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEdit(null)} className="btn-outline btn-sm">
              Cancelar
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => saveResource(edit), 'Salvo.', () => setEdit(null))} className="btn-primary btn-sm">
              Salvar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEdit({ name: '', color: 'teal', allowOverlap: false })} className="btn-outline btn-md">
          <Plus className="h-4 w-4" aria-hidden="true" /> Nova sala ou equipamento
        </button>
      )}
      {msgs}
    </Box>
  );
}

export function HolidaysPanel() {
  const id = useId();
  const { data, pending, run, msgs } = useConfig();
  const [novo, setNovo] = useState({ date: '', name: '' });
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const ano = new Date().getFullYear();
  const nacionais = holidaysBetween(`${ano}-01-01`, `${ano + 1}-12-31`).filter((h) => h.national && h.date >= new Date().toISOString().slice(0, 10)).slice(0, 12);
  return (
    <Box title="Feriados" desc="Os nacionais já vêm todo ano. Cadastre os da sua cidade e os dias em que a clínica fecha. A agenda mostra o feriado no dia.">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={data.blockHolidays} disabled={pending} onChange={(e) => run(() => setBlockHolidays(e.target.checked), 'Regra salva.')} className="h-4 w-4 accent-primary" />
        Não deixar marcar em feriado
      </label>
      <h3 className="mt-4 text-sm font-semibold">Da clínica e da cidade</h3>
      {data.holidays.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Nenhum ainda.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {data.holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="w-24 tabular-nums">{wallDateBR(h.date)}</span>
              <span className="flex-1">{h.name}</span>
              <button type="button" onClick={() => run(() => removeHoliday(h.id), 'Feriado removido.')} className="btn-ghost btn-sm" aria-label={`Tirar ${h.name}`}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveHoliday(novo), 'Feriado salvo.', () => setNovo({ date: '', name: '' }));
        }}
      >
        <label className="sr-only" htmlFor={`${id}-d`}>
          Data do feriado
        </label>
        <input id={`${id}-d`} type="date" value={novo.date} onChange={(e) => setNovo({ ...novo, date: e.target.value })} className={`${field} w-44`} />
        <label className="sr-only" htmlFor={`${id}-n`}>
          Nome do feriado
        </label>
        <input id={`${id}-n`} value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} placeholder="Aniversário da cidade" className={`${field} min-w-[12rem] flex-1`} />
        <button type="submit" disabled={pending} className="btn-primary btn-md">
          <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar
        </button>
      </form>
      <h3 className="mt-5 text-sm font-semibold">Próximos nacionais</h3>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {nacionais.map((h) => (
          <li key={h.date + h.name} className="flex gap-2">
            <span className="w-24 tabular-nums text-muted-foreground">{wallDateBR(h.date)}</span>
            {h.name}
          </li>
        ))}
      </ul>
      {msgs}
    </Box>
  );
}
