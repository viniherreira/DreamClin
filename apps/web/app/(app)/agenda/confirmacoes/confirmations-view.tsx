'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, MessageCircle, Phone, Send } from 'lucide-react';
import { wallClockTime, wallDateBR } from '@/lib/tz';
import { setStatusDirectAction } from '../actions';
import { resendReminders, type listConfirmations } from '../operacao-actions';

type Row = Awaited<ReturnType<typeof listConfirmations>>[number];

const WA: Record<string, { label: string; cls: string }> = {
  nenhum: { label: 'Sem lembrete', cls: 'text-muted-foreground' },
  enviado: { label: 'Enviado', cls: 'text-muted-foreground' },
  entregue: { label: 'Entregue', cls: 'text-sky-700 dark:text-sky-300' },
  lido: { label: 'Lido', cls: 'text-emerald-700 dark:text-emerald-300' },
  respondeu: { label: 'Respondeu', cls: 'font-medium text-emerald-700 dark:text-emerald-300' },
  falhou: { label: 'Não enviado', cls: 'text-destructive' },
};

const field = 'h-9 rounded-lg border border-border bg-background px-2 text-sm';
const tel = (p: string) => p.replace(/\D/g, '');

export function ConfirmationsView({ rows, filters, professionals }: { rows: Row[]; filters: { from: string; to: string; professionalId: string; status: string }; professionals: { id: string; name: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState(filters);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const grupos = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.startTime.slice(0, 10)}|${r.professional.name}`;
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }
  const aplicar = () => router.push(`/agenda/confirmacoes?${new URLSearchParams({ de: f.from, ate: f.to, ...(f.professionalId ? { profissional: f.professionalId } : {}), situacao: f.status })}`);
  const reenviar = (ids: string[]) =>
    start(async () => {
      const r = await resendReminders(ids);
      setMsg(r.ok ? `Lembretes: ${r.sent} enviados${r.failed ? `, ${r.failed} não saíram` : ''}.` : r.message);
      setSel(new Set());
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
        <label className="text-xs">
          <span className="block text-muted-foreground">De</span>
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={field} />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Até</span>
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={field} />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Profissional</span>
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
          <span className="block text-muted-foreground">Situação</span>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={field}>
            <option value="pendentes">A confirmar</option>
            <option value="CONFIRMED">Confirmados</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        <button type="button" onClick={aplicar} className="btn-primary btn-md">
          Mostrar
        </button>
        {sel.size > 0 && (
          <button type="button" disabled={pending} onClick={() => reenviar([...sel])} className="btn-outline btn-md ml-auto">
            <Send className="h-4 w-4" aria-hidden="true" /> Reenviar lembrete ({sel.size})
          </button>
        )}
      </div>
      {msg && (
        <p role="status" className="text-sm">
          {msg}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">Ninguém para confirmar nesse período.</p>
      ) : (
        [...grupos.entries()].map(([k, lista]) => {
          const [d, prof] = k.split('|');
          return (
            <section key={k} aria-label={`${wallDateBR(d)} · ${prof}`} className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
              <h2 className="border-b border-border bg-surface-alt/50 px-4 py-2 text-sm font-semibold">
                {wallDateBR(d)} · {prof} <span className="font-normal text-muted-foreground">({lista.length})</span>
              </h2>
              <ul className="divide-y divide-border">
                {lista.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${r.patient.name}`}
                      checked={sel.has(r.id)}
                      onChange={(e) => {
                        const n = new Set(sel);
                        if (e.target.checked) n.add(r.id);
                        else n.delete(r.id);
                        setSel(n);
                      }}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="w-12 font-medium tabular-nums">{wallClockTime(r.startTime)}</span>
                    <Link href={`/pacientes/${r.patient.id}`} className="min-w-[10rem] flex-1 truncate font-medium hover:underline">
                      {r.patient.name}
                    </Link>
                    <span className="text-xs">{r.statusText}</span>
                    <span className={`text-xs ${WA[r.whatsapp]?.cls ?? ''}`}>WhatsApp: {WA[r.whatsapp]?.label ?? r.whatsapp}</span>
                    {r.label && <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[11px]">{r.label.name}</span>}
                    <span className="flex gap-1">
                      {r.patient.phone && (
                        <>
                          <a href={`tel:${tel(r.patient.phone)}`} className="btn-ghost btn-sm" aria-label={`Ligar para ${r.patient.name}`}>
                            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                          </a>
                          <a href={`https://wa.me/55${tel(r.patient.phone)}`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" aria-label={`Abrir o WhatsApp de ${r.patient.name}`}>
                            <MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                          </a>
                        </>
                      )}
                      <button type="button" disabled={pending} onClick={() => reenviar([r.id])} className="btn-ghost btn-sm" aria-label={`Reenviar lembrete para ${r.patient.name}`}>
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      {r.status !== 'CONFIRMED' && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const x = await setStatusDirectAction(r.id, 'CONFIRMED');
                              setMsg(x.ok ? `${r.patient.name}: confirmado.` : x.message);
                              router.refresh();
                            })
                          }
                          className="btn-outline btn-sm"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Confirmar
                        </button>
                      )}
                      <Link href={`/agenda?date=${d}`} className="btn-ghost btn-sm">
                        Remarcar ou cancelar
                      </Link>
                    </span>
                    {r.notes && <p className="w-full pl-[4.5rem] text-xs text-muted-foreground">{r.notes}</p>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
