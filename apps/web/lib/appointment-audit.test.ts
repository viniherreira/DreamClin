import { describe, expect, it } from 'vitest';
import { auditActionLabel, diffAppointment, initialValues, readAuditChanges, type AppointmentSnapshot } from './appointment-audit';

const base: AppointmentSnapshot = {
  startTime: '2026-12-15T14:30:00.000Z',
  endTime: '2026-12-15T15:00:00.000Z',
  professional: 'Dra. Ana',
  patient: 'Carla',
  procedure: 'Limpeza',
  status: 'SCHEDULED',
  type: 'PARTICULAR',
  notes: null,
  label: null,
  unit: null,
  cancelReason: null,
  cancelledBy: null,
  arrivedAt: null,
  startedAt: null,
  finishedAt: null,
  noChargeReason: null,
};

describe('auditoria do agendamento', () => {
  it('mostra só o que mudou, com antes e depois em português', () => {
    const depois = { ...base, startTime: '2026-12-16T09:00:00.000Z', endTime: '2026-12-16T09:30:00.000Z', professional: 'Dr. Bruno', status: 'CONFIRMED', notes: 'Trazer exame' };
    expect(diffAppointment(base, depois)).toEqual([
      { field: 'startTime', label: 'Início', before: '15/12/2026 14:30', after: '16/12/2026 09:00' },
      { field: 'endTime', label: 'Fim', before: '15/12/2026 15:00', after: '16/12/2026 09:30' },
      { field: 'professional', label: 'Profissional', before: 'Dra. Ana', after: 'Dr. Bruno' },
      { field: 'status', label: 'Situação', before: 'A confirmar', after: 'Confirmado' },
      { field: 'notes', label: 'Observações', before: '(vazio)', after: 'Trazer exame' },
    ]);
  });

  it('salvar sem mudar nada não gera alteração; vazio e nulo são iguais', () => {
    expect(diffAppointment(base, { ...base })).toEqual([]);
    expect(diffAppointment({ ...base, notes: '' }, { ...base, notes: null })).toEqual([]);
  });

  it('cancelamento mostra quem cancelou e o motivo', () => {
    const c = diffAppointment(base, { ...base, status: 'CANCELLED', cancelledBy: 'PATIENT', cancelReason: 'Pelo WhatsApp' });
    expect(c.map((x) => `${x.label}: ${x.after}`)).toEqual(['Situação: Cancelado', 'Motivo do cancelamento: Pelo WhatsApp', 'Quem cancelou: Paciente']);
  });

  it('o "criou" lista os valores iniciais preenchidos', () => {
    const i = initialValues(base);
    expect(i.map((x) => x.label)).toEqual(['Início', 'Fim', 'Profissional', 'Paciente', 'Procedimento', 'Situação', 'Quem paga']);
  });

  it('rótulos das ações e leitura segura do que foi gravado', () => {
    expect(auditActionLabel('APPOINTMENT_MOVED')).toContain('horário');
    expect(auditActionLabel('WHATSAPP_RESPONSE_CONFIRMED')).toBe('Confirmou pelo WhatsApp');
    expect(auditActionLabel('XYZ')).toBe('Alteração');
    expect(readAuditChanges(null)).toEqual([]);
    expect(readAuditChanges({ changes: [{ label: 'Início', before: 'a', after: 'b' }, 3] })).toEqual([{ field: '', label: 'Início', before: 'a', after: 'b' }]);
  });
});
