import { describe, expect, it } from 'vitest';
import { matchesSlot, periodOf, suggestForSlot, waitingFor } from './waitlist';
import { bulkPlan } from './bulk-change';

const e = (o: Partial<Parameters<typeof matchesSlot>[0]> & { id: string }) => ({
  professionalId: null,
  careTypeId: null,
  period: 'ANY',
  weekdays: [] as number[],
  fromDate: null,
  priority: 0,
  createdAt: new Date('2026-11-01T10:00:00Z'),
  status: 'WAITING',
  ...o,
});

describe('lista de espera', () => {
  const slot = { start: new Date('2026-12-02T14:00:00Z'), professionalId: 'p1' }; // quarta, tarde
  it('combina por profissional, período, dia da semana e desde quando', () => {
    expect(periodOf(slot.start)).toBe('AFTERNOON');
    expect(matchesSlot(e({ id: 'a' }), slot)).toBe(true);
    expect(matchesSlot(e({ id: 'b', professionalId: 'p2' }), slot)).toBe(false);
    expect(matchesSlot(e({ id: 'c', period: 'MORNING' }), slot)).toBe(false);
    expect(matchesSlot(e({ id: 'd', weekdays: [1, 5] }), slot)).toBe(false);
    expect(matchesSlot(e({ id: 'f', fromDate: new Date('2026-12-10T00:00:00Z') }), slot)).toBe(false);
    expect(matchesSlot(e({ id: 'g', status: 'SCHEDULED' }), slot)).toBe(false);
  });

  it('ordena por prioridade e depois quem espera há mais tempo', () => {
    const lista = [
      e({ id: 'novo', createdAt: new Date('2026-11-20T00:00:00Z') }),
      e({ id: 'antigo', createdAt: new Date('2026-10-01T00:00:00Z') }),
      e({ id: 'urgente', priority: 1, createdAt: new Date('2026-11-21T00:00:00Z') }),
    ];
    expect(suggestForSlot(lista, slot).map((x) => x.id)).toEqual(['urgente', 'antigo', 'novo']);
    expect(waitingFor(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-13T00:00:00Z'))).toBe('há 12 dias');
  });
});

describe('alterações em massa', () => {
  const t = (id: string, status = 'SCHEDULED') => ({ id, startTime: new Date('2026-12-02T14:00:00Z'), endTime: new Date('2026-12-02T14:30:00Z'), professionalId: 'p1', agendaId: null, status, labelId: null });
  it('troca o profissional e desloca a data mantendo a hora; não mexe em atendido', () => {
    const plano = bulkPlan([t('a'), t('b', 'ATTENDED')], { professionalId: 'p2', shiftDays: 7 });
    expect(plano).toHaveLength(1);
    expect(plano[0].data.professionalId).toBe('p2');
    expect(plano[0].data.startTime?.toISOString()).toBe('2026-12-09T14:00:00.000Z');
  });

  it('mover para um dia mantém hora e duração; sem mudança, nada entra', () => {
    const plano = bulkPlan([t('a')], { moveToDate: '2026-12-20' });
    expect(plano[0].data.startTime?.toISOString()).toBe('2026-12-20T14:00:00.000Z');
    expect(plano[0].data.endTime?.toISOString()).toBe('2026-12-20T14:30:00.000Z');
    expect(bulkPlan([t('a')], { professionalId: 'p1' })).toEqual([]);
  });
});
