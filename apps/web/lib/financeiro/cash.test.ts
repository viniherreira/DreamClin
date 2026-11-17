import { describe, expect, it } from 'vitest';
import { cashSummary, closeCheck, countGroupOf, expectedCash, openTooLong, ZERO_COUNT, type CashMovement } from './cash';

const mov = (kind: CashMovement['kind'], methodKind: string | null, signedAmount: number): CashMovement => ({ kind, methodKind, signedAmount });

describe('caixa: esperado por meio', () => {
  it('o dinheiro começa com o troco e soma reforço, sangria, recebimento e estorno', () => {
    const e = expectedCash(10000, [
      mov('RECEIPT', 'CASH', 5000),
      mov('REINFORCEMENT', 'CASH', 2000),
      mov('WITHDRAWAL', 'CASH', -3000),
      mov('PAYMENT', 'CASH', -1500),
      mov('REVERSAL', 'CASH', -5000),
      mov('RECEIPT', 'PIX', 12000),
      mov('RECEIPT', 'CREDIT_CARD', 30000),
      mov('RECEIPT', 'DEBIT_CARD', 4000),
    ]);
    expect(e).toEqual({ CASH: 7500, PIX: 12000, CREDIT_CARD: 30000, DEBIT_CARD: 4000, OTHER: 0 });
  });

  it('cheque, boleto, transferência e convênio caem em Outros; a carteira não entra', () => {
    expect(countGroupOf('CHECK')).toBe('OTHER');
    expect(countGroupOf('BOLETO')).toBe('OTHER');
    expect(countGroupOf(null)).toBe('OTHER');
    const e = expectedCash(0, [mov('RECEIPT', 'CHECK', 1000), mov('RECEIPT', 'INSURANCE', 2000), mov('RECEIPT', 'WALLET', 0)]);
    expect(e.OTHER).toBe(3000);
  });
});

describe('caixa: fechamento', () => {
  const esperado = { ...ZERO_COUNT, CASH: 15000, PIX: 8000 };

  it('fecha sem justificativa quando tudo bate', () => {
    const r = closeCheck(esperado, { ...ZERO_COUNT, CASH: 15000, PIX: 8000 });
    expect(r.ok).toBe(true);
    expect(r.difference).toBe(0);
  });

  it('diferença pede justificativa, e com ela fecha guardando a diferença', () => {
    const contado = { ...ZERO_COUNT, CASH: 14000, PIX: 8000 };
    const sem = closeCheck(esperado, contado);
    expect(sem.ok).toBe(false);
    if (!sem.ok) expect(sem.code).toBe('NEEDS_JUSTIFICATION');
    expect(closeCheck(esperado, contado, 'ok').ok).toBe(false);
    const com = closeCheck(esperado, contado, 'Troco dado errado para um paciente');
    expect(com.ok).toBe(true);
    expect(com.difference).toBe(-1000);
    expect(com.rows.find((x) => x.group === 'CASH')?.diff).toBe(-1000);
  });

  it('não fecha com o dinheiro negativo, nem com justificativa', () => {
    const r = closeCheck({ ...ZERO_COUNT, CASH: -500 }, ZERO_COUNT, 'Faltou dinheiro no caixa');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NEGATIVE_CASH');
  });

  it('recusa valor contado negativo', () => {
    const r = closeCheck(esperado, { ...ZERO_COUNT, CASH: -1 }, 'Qualquer justificativa');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID');
  });
});

describe('caixa: resumo e aviso', () => {
  it('separa entradas, saídas, reforços, sangrias e estornos', () => {
    const s = cashSummary([mov('RECEIPT', 'CASH', 5000), mov('RECEIPT', 'PIX', 7000), mov('PAYMENT', 'CASH', -1200), mov('REINFORCEMENT', 'CASH', 2000), mov('WITHDRAWAL', 'CASH', -3000), mov('REVERSAL', 'PIX', -7000), mov('RECEIPT', 'WALLET', 0)]);
    expect(s).toEqual({ receipts: 12000, payments: 1200, reinforcements: 2000, withdrawals: 3000, reversals: -7000 });
  });

  it('avisa caixa aberto há mais dias que o limite; zero desliga', () => {
    expect(openTooLong(2, 1)).toBe(true);
    expect(openTooLong(1, 1)).toBe(false);
    expect(openTooLong(30, 0)).toBe(false);
  });
});
