'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarPlus, MessageCircle, Plus, Search, X } from 'lucide-react';
import { PERIODS, WAITLIST_STATUS, waitingFor } from '@/lib/waitlist';
import { ageFromBirth, wallClockTime, wallDateBR } from '@/lib/tz';
import { pickPatientsAction } from '../../pacientes/actions';
import { addToWaitlist, setWaitlistStatus, type listWaitlist, type waitlistForSlot } from '../operacao-actions';

import { DateField } from '@/components/ui/date-field';
type Data = NonNullable<Awaited<ReturnType<typeof listWaitlist>>>;
type Slot = Awaited<ReturnType<typeof waitlistForSlot>>;
const field = 'h-9 w-full rounded-lg border border-border bg-background px-2 text-sm';
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const tel = (p: string) => p.replace(/\D/g, '');

export function WaitlistView({ data, history, slot }: { data: Data; history: boolean; slot: Slot }) {
  const router = useRouter();
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [achados, setAchados] = useState<{ id: string; name: string; controlNumber: number }[]>([]);
  const [form, setForm] = useState({ patient: null as null | { id: string; name: string }, professionalId: '', careTypeId: '', period: 'ANY', weekdays: [] as number[], fromDate: '', notes: '', priority: false });

  useEffect(() => {
    if (q.trim().length < 2) return setAchados([]);
    const t = setTimeout(() => void pickPatientsAction(q).then(setAchados), 250);
    return () => clearTimeout(t);
  }, [q]);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, depois?: () => void) =>
    start(async () => {
      setErro('');
      const r = await fn();
      if (!r.ok) return setErro(r.message);
      depois?.();
      router.refresh();
    });

  const textoVaga = slot ? `Olá! Abriu um horário na clínica em ${wallDateBR(slot.slot.start)} às ${wallClockTime(slot.slot.start)} com ${slot.slot.professional}. Quer ficar com ele?` : '';

  return (
    <div className="space-y-4">
      {slot && (
        <section aria-labelledby="vaga" className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <h2 id="vaga" className="text-sm font-semibold">
            Horário que vagou: {wallDateBR(slot.slot.start)} às {wallClockTime(slot.slot.start)} · {slot.slot.professional}
          </h2>
          {slot.suggestions.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Ninguém da lista combina com esse horário.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
              {slot.suggestions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="flex-1 font-medium">{s.patientName}</span>
                  <span className="text-xs text-muted-foreground">espera {waitingFor(s.createdAt)}</span>
                  {s.phone && (
                    <a href={`https://wa.me/55${tel(s.phone)}?text=${encodeURIComponent(textoVaga)}`} target="_blank" rel="noreferrer" className="btn-outline btn-sm">
                      <MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> Oferecer pelo WhatsApp
                    </a>
                  )}
                  <Link href={`/agenda?date=${slot.slot.start.slice(0, 10)}&novo=1&paciente=${s.patientId}`} className="btn-ghost btn-sm" onClick={() => void setWaitlistStatus(s.id, 'SCHEDULED')}>
                    <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" /> Agendar
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setNovo(!novo)} aria-expanded={novo} className="btn-primary btn-md">
          <Plus className="h-4 w-4" aria-hidden="true" /> Colocar na lista
        </button>
        <Link href={history ? '/agenda/lista-de-espera' : '/agenda/lista-de-espera?historico=1'} className="btn-ghost btn-md">
          {history ? 'Só quem espera' : 'Mostrar histórico'}
        </Link>
      </div>

      {novo && (
        <form
          className="space-y-3 rounded-xl border border-border bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.patient) return setErro('Escolha o paciente.');
            run(
              () =>
                addToWaitlist({
                  patientId: form.patient!.id,
                  professionalId: form.professionalId || null,
                  careTypeId: form.careTypeId || null,
                  period: form.period,
                  weekdays: form.weekdays,
                  fromDate: form.fromDate || null,
                  notes: form.notes,
                  priority: form.priority ? 1 : 0,
                }),
              () => setNovo(false),
            );
          }}
        >
          <div>
            <label htmlFor="wl-pac" className="text-xs font-medium text-muted-foreground">
              Paciente
            </label>
            {form.patient ? (
              <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="flex-1">{form.patient.name}</span>
                <button type="button" onClick={() => setForm({ ...form, patient: null })} aria-label="Trocar paciente" className="text-muted-foreground">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input id="wl-pac" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou nº" className={`${field} pl-8`} autoComplete="off" />
                {achados.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-lg">
                    {achados.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => setForm({ ...form, patient: { id: a.id, name: a.name } })} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-surface-alt">
                          {a.name} <span className="text-xs text-muted-foreground">nº {a.controlNumber}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">
              <span className="text-muted-foreground">Profissional</span>
              <select value={form.professionalId} onChange={(e) => setForm({ ...form, professionalId: e.target.value })} className={field}>
                <option value="">Qualquer</option>
                {data.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Tipo de atendimento</span>
              <select value={form.careTypeId} onChange={(e) => setForm({ ...form, careTypeId: e.target.value })} className={field}>
                <option value="">Qualquer</option>
                {data.careTypes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Período</span>
              <select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} className={field}>
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Pode a partir de</span>
              <DateField value={form.fromDate} onChange={(v) => setForm({ ...form, fromDate: v })} className={field} />
            </label>
          </div>
          <fieldset>
            <legend className="text-xs text-muted-foreground">Dias da semana (nenhum = qualquer dia)</legend>
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
          <label className="block text-xs">
            <span className="text-muted-foreground">Observações</span>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={field} />
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.checked })} className="h-4 w-4 accent-primary" /> Prioridade alta
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNovo(false)} className="btn-outline btn-sm">
              Cancelar
            </button>
            <button type="submit" disabled={pending} className="btn-primary btn-sm">
              Colocar na lista
            </button>
          </div>
        </form>
      )}
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}

      {data.entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">Ninguém na lista de espera.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Lista de espera</caption>
            <thead className="bg-surface-alt/60 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Entrou</th>
                <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
                <th scope="col" className="px-3 py-2 font-medium">Profissional e tipo</th>
                <th scope="col" className="px-3 py-2 font-medium">Preferência</th>
                <th scope="col" className="px-3 py-2 font-medium">Situação</th>
                <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.entries.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2 tabular-nums">
                    {wallDateBR(e.createdAt.slice(0, 10))}
                    <span className="block text-xs text-muted-foreground">{waitingFor(e.createdAt)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/pacientes/${e.patientId}`} className="font-medium hover:underline">
                      {e.patientName}
                    </Link>
                    {e.priority > 0 && <span className="ml-1 rounded bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">prioridade</span>}
                    <span className="block text-xs text-muted-foreground">
                      {e.birthDate ? `${ageFromBirth(e.birthDate)} anos · ` : ''}
                      {e.phone}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {e.professionalName ?? 'Qualquer'}
                    {e.careTypeName && <span className="block text-xs text-muted-foreground">{e.careTypeName}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {PERIODS.find((p) => p.value === e.period)?.label}
                    {e.weekdays.length > 0 && <span className="block">{e.weekdays.map((d) => DIAS[d]).join(', ')}</span>}
                    {e.notes && <span className="block text-muted-foreground">{e.notes}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {WAITLIST_STATUS[e.status] ?? e.status}
                    {e.removedReason && <span className="block text-muted-foreground">{e.removedReason}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {e.status === 'WAITING' && (
                      <span className="flex flex-wrap gap-1">
                        <Link href={`/agenda/horarios-livres?profissional=${e.professionalId ?? ''}&tipo=${e.careTypeId ?? ''}`} className="btn-ghost btn-sm">
                          Horários livres
                        </Link>
                        <button type="button" disabled={pending} onClick={() => run(() => setWaitlistStatus(e.id, 'SCHEDULED'))} className="btn-ghost btn-sm">
                          Agendado
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            const m = prompt('Por que sai da lista? (opcional)');
                            if (m !== null) run(() => setWaitlistStatus(e.id, 'REMOVED', m));
                          }}
                          className="btn-ghost btn-sm text-destructive"
                        >
                          Remover
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
