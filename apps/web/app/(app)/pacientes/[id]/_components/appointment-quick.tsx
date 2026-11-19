'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { updateAppointmentStatus } from '../../../agenda/actions';

/** Ações rápidas de um próximo agendamento na ficha: confirmar, remarcar (abre a agenda no dia) e cancelar. */
export function AppointmentQuick({ id, status, day }: { id: string; status: string; day: string }) {
  const [pending, start] = useTransition();
  const [feito, setFeito] = useState('');
  if (feito) return <span className="text-xs text-muted-foreground">{feito}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {status !== 'CONFIRMED' && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await updateAppointmentStatus(id, 'CONFIRMED');
              setFeito('Confirmado');
            })
          }
          className="btn-ghost btn-sm"
        >
          Confirmar
        </button>
      )}
      <Link href={`/agenda?date=${day}`} className="btn-ghost btn-sm">
        Remarcar
      </Link>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const motivo = prompt('Motivo do cancelamento (opcional):');
          if (motivo === null) return;
          start(async () => {
            await updateAppointmentStatus(id, 'CANCELLED', motivo || undefined);
            setFeito('Cancelado');
          });
        }}
        className="btn-ghost btn-sm text-destructive"
      >
        Cancelar
      </button>
    </span>
  );
}
