import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { cleanFinanceSettings } from './settings';
import { collectionParams, collectionTemplateVersion, DEFAULT_COLLECTION_TEXT, dueDatesFor, fillCollection, stepFor, toCollectionTemplate } from './collection';

const regra = { enabled: true, daysBefore: 3, onDueDay: true, daysAfter: [3, 10] };

describe('régua de cobrança: passo do dia', () => {
  it('antes, no dia e depois', () => {
    expect(stepFor('2026-11-20', '2026-11-17', regra)).toEqual({ step: 'B3', purpose: 'COLLECTION_REMINDER' });
    expect(stepFor('2026-11-17', '2026-11-17', regra)).toEqual({ step: 'D0', purpose: 'COLLECTION_REMINDER' });
    expect(stepFor('2026-11-14', '2026-11-17', regra)).toEqual({ step: 'A3', purpose: 'COLLECTION_OVERDUE' });
    expect(stepFor('2026-11-07', '2026-11-17', regra)).toEqual({ step: 'A10', purpose: 'COLLECTION_OVERDUE' });
    expect(stepFor('2026-11-15', '2026-11-17', regra)).toBeNull();
    expect(stepFor('2026-11-17', '2026-11-17', { ...regra, enabled: false })).toBeNull();
    expect(stepFor('2026-11-17', '2026-11-17', { ...regra, onDueDay: false })).toBeNull();
  });

  it('datas de vencimento que interessam hoje', () => {
    expect(dueDatesFor('2026-11-17', regra, addDays).sort()).toEqual(['2026-11-07', '2026-11-14', '2026-11-17', '2026-11-20']);
    expect(dueDatesFor('2026-11-17', { ...regra, enabled: false }, addDays)).toEqual([]);
  });

  it('regras salvas são limpas: até 3 dias depois, sem repetir, de 1 a 90', () => {
    const s = cleanFinanceSettings({ collectionDaysAfter: [10, 3, 3, 0, 200, 15, 30], collectionDaysBefore: 99 });
    expect(s.collectionDaysAfter).toEqual([3, 10, 15]);
    expect(s.collectionDaysBefore).toBe(30);
  });
});

describe('régua de cobrança: modelo da Meta', () => {
  it('o texto padrão vira modelo com as variáveis na ordem', () => {
    const r = toCollectionTemplate(DEFAULT_COLLECTION_TEXT.COLLECTION_REMINDER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.varKeys).toEqual(['nome', 'valor', 'clinica', 'vencimento']);
    expect(r.body).toContain('{{1}}');
    const params = collectionParams(r.varKeys, { nome: 'Maria', valor: 'R$ 100,00', vencimento: '20/11/2026', clinica: 'Clínica X' });
    expect(fillCollection(r.body, params)).toBe('Olá, Maria! Passando para lembrar que a parcela de R$ 100,00 com a Clínica X vence em 20/11/2026. Se já pagou, desconsidere esta mensagem.');
    expect(toCollectionTemplate(DEFAULT_COLLECTION_TEXT.COLLECTION_OVERDUE).ok).toBe(true);
  });

  it('recusa variável desconhecida, texto sem valor ou vencimento e variável na ponta', () => {
    expect(toCollectionTemplate('Olá {paciente}, vence {vencimento} o valor {valor}.').ok).toBe(false);
    expect(toCollectionTemplate('Olá {nome}, tudo bem?').ok).toBe(false);
    expect(toCollectionTemplate('{nome}, vence {vencimento} o valor {valor} hoje.').ok).toBe(false);
    expect(toCollectionTemplate('').ok).toBe(false);
  });

  it('versão do nome', () => {
    expect(collectionTemplateVersion('COLLECTION_OVERDUE', 'dc_cobranca_atraso_4')).toBe(4);
    expect(collectionTemplateVersion('COLLECTION_OVERDUE', 'dc_lembrete_4')).toBeNull();
  });
});
