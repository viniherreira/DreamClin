import { describe, expect, it } from 'vitest';
import { attendanceOf, missRateText } from './attendance';
import { eventGroup, EVENT_TYPES, isEventType, typesOfGroup } from './patient-events';

describe('comparecimento', () => {
  it('conta atendidos, faltas e cancelados por quem cancelou', () => {
    const a = attendanceOf([
      { status: 'ATTENDED' },
      { status: 'ATTENDED' },
      { status: 'ATTENDED' },
      { status: 'MISSED' },
      { status: 'CANCELLED', cancelledBy: 'PATIENT' },
      { status: 'CANCELLED', cancelledBy: 'CLINIC' },
      { status: 'CANCELLED' },
      { status: 'SCHEDULED' },
    ]);
    expect(a).toMatchObject({ attended: 3, missed: 1, cancelledByPatient: 1, cancelledByClinic: 1, cancelledUnknown: 1 });
    expect(a.missRate).toBeCloseTo(0.25);
    expect(missRateText(a.missRate)).toBe('25%');
  });

  it('sem atendimento nem falta, a taxa fica sem dados', () => {
    const a = attendanceOf([{ status: 'SCHEDULED' }, { status: 'CANCELLED', cancelledBy: 'PATIENT' }]);
    expect(a.missRate).toBeNull();
    expect(missRateText(a.missRate)).toBe('sem dados');
  });
});

describe('tipos da linha do tempo', () => {
  it('todo tipo tem grupo e rótulo, e o filtro por grupo acha os tipos', () => {
    for (const [t, v] of Object.entries(EVENT_TYPES)) {
      expect(isEventType(t)).toBe(true);
      expect(eventGroup(t)).toBe(v.group);
      expect(v.label.length).toBeGreaterThan(2);
    }
    expect(typesOfGroup('agenda')).toContain('appointment.cancelled');
    expect(typesOfGroup('agenda')).not.toContain('quote.created');
    expect(isEventType('_backfill')).toBe(false);
  });
});
