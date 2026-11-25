'use client';

import { useState, useTransition } from 'react';
import { clinicToday, wallClockTime, wallDateBR } from '@/lib/tz';
import type { BulkChange } from '@/lib/bulk-change';
import { STATUS_LABEL } from '@/lib/appointment-audit';
import { bulkApply, bulkSearch } from '../operacao-actions';

import { DateField } from '@/components/ui/date-field';
type Opt = { id: string; name: string };
type Row = Awaited<ReturnType<typeof bulkSearch>>[number];
const field = 'h-9 w-full rounded-lg border border-border bg-background px-2 text-sm';

export function BulkView({ professionals, rooms, labels }: { professionals: Opt[]; rooms: Opt[]; labels: Opt[] }) {
  const hoje = clinicToday();
  const [f, setF] = useState({ from: hoje, to: hoje, professionalId: '', agendaId: '', status: '', labelId: '' });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ch, setCh] = useState({ professionalId: '', agendaId: '', mover: 'nao', shiftDays: '1', moveToDate: '', status: '', labelId: '' });
  const [previa, setPrevia] = useState<{ changed: number; conflicts: { id: string; reason: string }[] } | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pending, start] = useTransition();

  const mudanca = (): BulkChange => ({
    ...(ch.professionalId ? { professionalId: ch.professionalId } : {}),
    ...(ch.agendaId ? { agendaId: ch.agendaId === 'nenhuma' ? null : ch.agendaId } : {}),
    ...(ch.mover === 'dias' ? { shiftDays: Number(ch.shiftDays) || 0 } : {}),
    ...(ch.mover === 'data' && ch.moveToDate ? { moveToDate: ch.moveToDate } : {}),
    ...(ch.status ? { status: ch.status as 'SCHEDULED' | 'CONFIRMED' } : {}),
    ...(ch.labelId ? { labelId: ch.labelId === 'nenhum' ? null : ch.labelId } : {}),
  });
  const temMudanca = Object.keys(mudanca()).length > 0;

  const buscar = () =>
    start(async () => {
      setMsg(null);
      setPrevia(null);
      const r = await bulkSearch({ ...f, professionalId: f.professionalId || undefined, agendaId: f.agendaId || undefined, status: f.status || undefined, labelId: f.labelId || undefined });
      setRows(r);
      setSel(new Set(r.map((x) => x.id)));
    });

  const rodar = (dryRun: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await bulkApply([...sel], mudanca(), { dryRun });
      if (!r.ok) return setMsg({ tipo: 'erro', texto: r.message });
      if (dryRun) return setPrevia({ changed: r.changed, conflicts: r.conflicts });
      if (r.conflicts.length) {
        setPrevia({ changed: 0, conflicts: r.conflicts });
        return setMsg({ tipo: 'erro', texto: 'Nada foi alterado: há conflitos de horário. Tire esses agendamentos da seleção ou mude a alteração.' });
      }
      setMsg({ tipo: 'ok', texto: `${r.changed} ${r.changed === 1 ? 'agendamento alterado' : 'agendamentos alterados'}.` });
      setPrevia(null);
      buscar();
    });

  const conflito = new Map((previa?.conflicts ?? []).map((c) => [c.id, c.reason]));

  return (
    <div className="space-y-4">
      <section aria-labelledby="bulk-1" className="rounded-xl border border-border bg-surface p-4">
        <h2 id="bulk-1" className="text-sm font-semibold">1. Quais agendamentos</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <label className="text-xs">
            <span className="text-muted-foreground">De</span>
            <DateField value={f.from} onChange={(v) => setF({ ...f, from: v })} className={field} />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Até</span>
            <DateField value={f.to} onChange={(v) => setF({ ...f, to: v })} className={field} />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Profissional</span>
            <select value={f.professionalId} onChange={(e) => setF({ ...f, professionalId: e.target.value })} className={field}>
              <option value="">Todos</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Sala</span>
            <select value={f.agendaId} onChange={(e) => setF({ ...f, agendaId: e.target.value })} className={field}>
              <option value="">Todas</option>
              {rooms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Situação</span>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={field}>
              <option value="">A acontecer</option>
              <option value="SCHEDULED">Agendado</option>
              <option value="CONFIRMED">Confirmado</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Rótulo</span>
            <select value={f.labelId} onChange={(e) => setF({ ...f, labelId: e.target.value })} className={field}>
              <option value="">Qualquer</option>
              {labels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" disabled={pending} onClick={buscar} className="btn-primary btn-sm mt-3">
          Buscar agendamentos
        </button>
      </section>

      {rows && (
        <section aria-labelledby="bulk-lista" className="overflow-hidden rounded-xl border border-border bg-surface">
          <h2 id="bulk-lista" className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm font-semibold">
            {rows.length} encontrados · {sel.size} escolhidos
            {rows.length > 0 && (
              <button type="button" onClick={() => setSel(sel.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))} className="btn-ghost btn-sm ml-auto font-normal">
                {sel.size === rows.length ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
            )}
          </h2>
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum agendamento com esses filtros.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {rows.map((r) => (
                <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-2 text-sm ${conflito.has(r.id) ? 'bg-red-50 dark:bg-red-950/30' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label={`Escolher ${r.patient} em ${wallDateBR(r.startTime)} ${wallClockTime(r.startTime)}`}
                    checked={sel.has(r.id)}
                    onChange={(e) => {
                      const n = new Set(sel);
                      if (e.target.checked) n.add(r.id);
                      else n.delete(r.id);
                      setSel(n);
                      setPrevia(null);
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="w-28 tabular-nums">
                    {wallDateBR(r.startTime)} {wallClockTime(r.startTime)}
                  </span>
                  <span className="flex-1 font-medium">{r.patient}</span>
                  <span className="text-xs text-muted-foreground">{r.professional}</span>
                  <span className="text-xs">{STATUS_LABEL[r.status] ?? r.status}</span>
                  {conflito.has(r.id) && <span className="w-full pl-7 text-xs text-destructive">{conflito.get(r.id)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {rows && rows.length > 0 && (
        <section aria-labelledby="bulk-2" className="rounded-xl border border-border bg-surface p-4">
          <h2 id="bulk-2" className="text-sm font-semibold">2. O que muda</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs">
              <span className="text-muted-foreground">Passar para o profissional</span>
              <select value={ch.professionalId} onChange={(e) => setCh({ ...ch, professionalId: e.target.value })} className={field}>
                <option value="">Não mudar</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Sala</span>
              <select value={ch.agendaId} onChange={(e) => setCh({ ...ch, agendaId: e.target.value })} className={field}>
                <option value="">Não mudar</option>
                <option value="nenhuma">Sem sala</option>
                {rooms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Situação</span>
              <select value={ch.status} onChange={(e) => setCh({ ...ch, status: e.target.value })} className={field}>
                <option value="">Não mudar</option>
                <option value="SCHEDULED">Agendado</option>
                <option value="CONFIRMED">Confirmado</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Rótulo</span>
              <select value={ch.labelId} onChange={(e) => setCh({ ...ch, labelId: e.target.value })} className={field}>
                <option value="">Não mudar</option>
                <option value="nenhum">Tirar o rótulo</option>
                {labels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="mt-3">
            <legend className="text-xs text-muted-foreground">Data (a hora fica a mesma)</legend>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" name="mover" checked={ch.mover === 'nao'} onChange={() => setCh({ ...ch, mover: 'nao' })} className="accent-primary" /> Não mudar
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" name="mover" checked={ch.mover === 'dias'} onChange={() => setCh({ ...ch, mover: 'dias' })} className="accent-primary" /> Empurrar
                <input
                  type="number"
                  min={-60}
                  max={60}
                  value={ch.shiftDays}
                  onChange={(e) => setCh({ ...ch, shiftDays: e.target.value, mover: 'dias' })}
                  aria-label="Quantos dias"
                  className="h-8 w-16 rounded-md border border-border bg-background px-2"
                />
                dias
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" name="mover" checked={ch.mover === 'data'} onChange={() => setCh({ ...ch, mover: 'data' })} className="accent-primary" /> Mover para o dia
                <DateField value={ch.moveToDate} onChange={(v) => setCh({ ...ch, moveToDate: v, mover: 'data' })} aria-label="Novo dia" className="h-8 rounded-md border border-border bg-background px-2" />
              </label>
            </div>
          </fieldset>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending || !temMudanca || sel.size === 0} onClick={() => rodar(true)} className="btn-outline btn-sm">
              Ver prévia
            </button>
            <button type="button" disabled={pending || !temMudanca || sel.size === 0 || !previa || previa.conflicts.length > 0} onClick={() => rodar(false)} className="btn-primary btn-sm">
              Aplicar em {previa?.changed ?? sel.size}
            </button>
            {previa && (
              <p role="status" className="text-sm">
                {previa.conflicts.length > 0
                  ? `${previa.conflicts.length} com conflito de horário (em vermelho na lista).`
                  : `${previa.changed} ${previa.changed === 1 ? 'agendamento vai mudar' : 'agendamentos vão mudar'}. Atendidos, faltas e cancelados não mudam.`}
              </p>
            )}
          </div>
        </section>
      )}

      {msg && (
        <p role={msg.tipo === 'erro' ? 'alert' : 'status'} className={`text-sm ${msg.tipo === 'erro' ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {msg.texto}
        </p>
      )}
    </div>
  );
}
