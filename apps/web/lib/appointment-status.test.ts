import { describe, expect, it } from 'vitest';
import { cancelError, cancelReasonText, confirmedByPatient, directStatusChange, isReschedule, statusLabel } from './appointment-status';

describe('situação do agendamento', () => {
  it('confirmado pelo paciente vem do WhatsApp ou do link', () => {
    expect(statusLabel('CONFIRMED', { confirmationSource: 'WHATSAPP' })).toBe('Confirmado pelo paciente');
    expect(statusLabel('CONFIRMED', { confirmationSource: 'LINK' })).toBe('Confirmado pelo paciente');
    expect(statusLabel('CONFIRMED', { confirmationSource: 'RECEPTION' })).toBe('Confirmado');
    expect(statusLabel('CONFIRMED')).toBe('Confirmado');
    expect(confirmedByPatient('PHONE')).toBe(false);
  });

  it('cancelado diz quem cancelou; remarcado é "pediu para remarcar"', () => {
    expect(statusLabel('CANCELLED', { cancelledBy: 'PATIENT' })).toBe('Cancelado pelo paciente');
    expect(statusLabel('CANCELLED', { cancelledBy: 'CLINIC' })).toBe('Cancelado pela clínica');
    expect(statusLabel('CANCELLED')).toBe('Cancelado');
    expect(statusLabel('RESCHEDULED')).toBe('Pediu para remarcar');
  });

  it('troca direta mantém as horas coerentes', () => {
    const now = new Date('2026-11-19T12:00:00Z');
    const atendendo = { status: 'CONFIRMED', arrivedAt: now, startedAt: now, finishedAt: null };
    expect(directStatusChange(atendendo, 'CONFIRMED', now)).toBeNull();
    expect(directStatusChange(atendendo, 'ATTENDED', now)).toEqual({ status: 'ATTENDED', finishedAt: now });
    expect(directStatusChange({ ...atendendo, finishedAt: now }, 'ATTENDED', now)).toEqual({ status: 'ATTENDED' });
    expect(directStatusChange(atendendo, 'SCHEDULED', now)).toEqual({ status: 'SCHEDULED', arrivedAt: null, startedAt: null, finishedAt: null });
    expect(directStatusChange(atendendo, 'MISSED', now)).toMatchObject({ status: 'MISSED', arrivedAt: null });
  });

  it('cancelamento pede quem cancelou e, se a clínica exige, o motivo', () => {
    expect(cancelError({}, { required: false, otherSelected: false })).toMatch(/quem cancelou/);
    expect(cancelError({ cancelledBy: 'PATIENT' }, { required: true, otherSelected: false })).toMatch(/motivo/);
    expect(cancelError({ cancelledBy: 'PATIENT' }, { required: false, otherSelected: false })).toBeNull();
    expect(cancelError({ cancelledBy: 'CLINIC', reasonId: 'r1' }, { required: true, otherSelected: true })).toBe('Escreva o motivo.');
    expect(cancelError({ cancelledBy: 'CLINIC', reasonId: 'r1', reasonText: 'Chuva' }, { required: true, otherSelected: true })).toBeNull();
  });

  it('texto do motivo gravado', () => {
    expect(cancelReasonText('Paciente doente', '', false)).toBe('Paciente doente');
    expect(cancelReasonText('Paciente doente', 'gripe', false)).toBe('Paciente doente: gripe');
    expect(cancelReasonText('Outro', 'chuva forte', true)).toBe('chuva forte');
    expect(cancelReasonText(null, 'sem lista', false)).toBe('sem lista');
  });

  it('remarcação: mudou dia, hora ou profissional', () => {
    const a = { startTime: '2026-12-01T10:00:00Z', endTime: '2026-12-01T10:30:00Z', professionalId: 'p1' };
    expect(isReschedule(a, { ...a })).toBe(false);
    expect(isReschedule(a, { ...a, startTime: '2026-12-02T10:00:00Z' })).toBe(true);
    expect(isReschedule(a, { ...a, professionalId: 'p2' })).toBe(true);
  });
});
