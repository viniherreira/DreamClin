import { describe, expect, it } from 'vitest';
import { appointmentBadges, parsePrefs, sortAgendaList, DEFAULT_PREFS } from './agenda-view';

describe('visualizações da agenda', () => {
  const ag = (id: string, patientId: string, iso: string, extra: Record<string, unknown> = {}) => ({ id, patientId, startTime: `${iso}:00.000Z`, status: 'SCHEDULED', ...extra });

  it('1ª vez só no primeiro agendamento de quem nunca foi atendido; cancelado não conta', () => {
    const b = appointmentBadges(
      [ag('a', 'p1', '2027-03-02T09:00'), ag('b', 'p1', '2027-03-01T09:00', { status: 'CANCELLED' }), ag('c', 'p1', '2027-03-03T09:00'), ag('d', 'p2', '2027-03-01T10:00')],
      new Set(['p2']),
    );
    expect(b).toEqual({ a: ['primeira'] });
  });

  it('aniversário pelo dia e mês; confirmado pelo paciente só com WhatsApp ou link', () => {
    const b = appointmentBadges(
      [
        ag('a', 'p1', '2027-03-05T09:00', { birthDate: '1990-03-05T00:00:00.000Z', status: 'CONFIRMED', confirmationSource: 'WHATSAPP' }),
        ag('b', 'p2', '2027-03-05T09:00', { birthDate: '1990-03-06T00:00:00.000Z', status: 'CONFIRMED', confirmationSource: 'RECEPTION' }),
      ],
      new Set(['p1', 'p2']),
    );
    expect(b).toEqual({ a: ['aniversario', 'paciente'] });
  });

  it('lista ordena por horário, profissional ou paciente', () => {
    const l = [
      { id: '1', startTime: '2027-03-01T10:00:00Z', patient: { name: 'Bia' }, professional: { name: 'Zé Costa' } },
      { id: '2', startTime: '2027-03-01T09:00:00Z', patient: { name: 'Ana' }, professional: { name: 'Ana Lima' } },
      { id: '3', startTime: '2027-03-01T08:00:00Z', patient: { name: 'Caio' }, professional: { name: 'Zé Costa' } },
    ];
    expect(sortAgendaList(l, 'horario').map((x) => x.id)).toEqual(['3', '2', '1']);
    expect(sortAgendaList(l, 'profissional').map((x) => x.id)).toEqual(['2', '3', '1']);
    expect(sortAgendaList(l, 'paciente').map((x) => x.id)).toEqual(['2', '1', '3']);
  });

  it('preferências do navegador: lixo vira o padrão', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{quebrado')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ hidden: ['x', 3], layout: 'list', onlyOwing: true, sort: 'paciente' }))).toEqual({ hidden: ['x'], layout: 'list', onlyOwing: true, sort: 'paciente' });
    expect(parsePrefs(JSON.stringify({ layout: 'outro', sort: 'x' }))).toEqual(DEFAULT_PREFS);
  });
});
