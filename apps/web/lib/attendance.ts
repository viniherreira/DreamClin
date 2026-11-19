/**
 * Comparecimento do paciente: atendidos, faltas, cancelados pelo paciente e
 * pela clínica, e a taxa de falta. Puro e testado.
 *
 * Taxa de falta = faltas / (atendidos + faltas): o que já tinha que acontecer.
 * Cancelamento com antecedência não conta como falta. Cancelamento antigo,
 * sem `cancelledBy`, entra em "cancelados" sem dono (conta no total).
 */

export interface AttendanceLike {
  status: string;
  cancelledBy?: string | null;
}

export interface Attendance {
  attended: number;
  missed: number;
  cancelledByPatient: number;
  cancelledByClinic: number;
  cancelledUnknown: number;
  /** 0 a 1, ou null sem nada para medir. */
  missRate: number | null;
}

export function attendanceOf(list: readonly AttendanceLike[]): Attendance {
  const a: Attendance = { attended: 0, missed: 0, cancelledByPatient: 0, cancelledByClinic: 0, cancelledUnknown: 0, missRate: null };
  for (const x of list) {
    if (x.status === 'ATTENDED') a.attended++;
    else if (x.status === 'MISSED') a.missed++;
    else if (x.status === 'CANCELLED') {
      if (x.cancelledBy === 'PATIENT') a.cancelledByPatient++;
      else if (x.cancelledBy === 'CLINIC') a.cancelledByClinic++;
      else a.cancelledUnknown++;
    }
  }
  const base = a.attended + a.missed;
  a.missRate = base ? a.missed / base : null;
  return a;
}

/** "12%" ou "sem dados". */
export function missRateText(rate: number | null): string {
  return rate == null ? 'sem dados' : `${Math.round(rate * 100)}%`;
}
