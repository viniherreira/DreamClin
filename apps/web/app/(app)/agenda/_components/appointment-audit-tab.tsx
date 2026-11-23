'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { auditActionLabel } from '@/lib/appointment-audit';
import { instantDateTimeBR } from '@/lib/tz';
import { getAppointmentAuditAction } from '../actions';

type Entry = NonNullable<Awaited<ReturnType<typeof getAppointmentAuditAction>>>[number];

/**
 * Aba Auditoria da janela do agendamento: quem criou e cada alteração, com o
 * campo, o valor de antes e o de depois, quem fez e quando. Do mais antigo
 * para o mais novo, como uma linha do tempo.
 */
export function AppointmentAuditTab({ appointmentId, version }: { appointmentId: string; version: number }) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  useEffect(() => {
    let vivo = true;
    void getAppointmentAuditAction(appointmentId).then((r) => vivo && setRows(r ?? []));
    return () => {
      vivo = false;
    };
  }, [appointmentId, version]);

  if (!rows) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nenhuma alteração registrada ainda. As próximas mudanças aparecem aqui.</p>;

  return (
    <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-border" aria-label="Auditoria do agendamento">
      {rows.map((r) => (
        <li key={r.id} className="relative flex gap-3">
          <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-primary">
            <History className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">{auditActionLabel(r.action)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {instantDateTimeBR(r.at)} · {r.who}
            </p>
            {r.changes.length > 0 && (
              <table className="mt-2 w-full text-xs">
                <caption className="sr-only">O que mudou</caption>
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-2 font-medium">Campo</th>
                    {r.action !== 'APPOINTMENT_CREATED' && r.action !== 'APPOINTMENT_DELETED' && (
                      <th scope="col" className="py-1 pr-2 font-medium">Antes</th>
                    )}
                    <th scope="col" className="py-1 font-medium">{r.action === 'APPOINTMENT_DELETED' ? 'Como estava' : r.action === 'APPOINTMENT_CREATED' ? 'Valor' : 'Depois'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {r.changes.map((c) => (
                    <tr key={c.field + c.after}>
                      <th scope="row" className="py-1 pr-2 text-left font-medium">{c.label}</th>
                      {r.action !== 'APPOINTMENT_CREATED' && r.action !== 'APPOINTMENT_DELETED' && (
                        <td className="py-1 pr-2 text-muted-foreground line-through decoration-muted-foreground/40">{c.before}</td>
                      )}
                      <td className="py-1">{c.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
