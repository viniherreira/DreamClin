import { describe, expect, it } from 'vitest';
import { billingFromProcedure, billingOf, itemTotal, owesMoney, startBlocked, type BillingItem, type BillingTitle } from './billing';

const item = (unitPrice: number, extra: Partial<BillingItem> = {}): BillingItem => ({ quantity: 1, unitPrice, discount: 0, covered: false, ...extra });
const titulo = (amount: number, paid = 0, status: BillingTitle['status'] = paid >= amount ? 'PAID' : paid > 0 ? 'PARTIAL' : 'OPEN'): BillingTitle => ({ amount, paid, status });
const base = { type: 'PARTICULAR' as const, noCharge: false };

describe('situação financeira do agendamento', () => {
  it('total do item: quantidade vezes preço menos desconto, nunca negativo', () => {
    expect(itemTotal({ quantity: 2, unitPrice: 15000, discount: 5000 })).toBe(25000);
    expect(itemTotal({ quantity: 1, unitPrice: 1000, discount: 5000 })).toBe(0);
  });

  it('sem valor: cortesia, valor zero ou tudo coberto por orçamento', () => {
    expect(billingOf({ ...base, type: 'CORTESIA', items: [item(20000)], titles: [] })).toMatchObject({ status: 'NONE', total: 20000, chargeable: 0 });
    expect(billingOf({ ...base, items: [item(0)], titles: [] }).status).toBe('NONE');
    expect(billingOf({ ...base, items: [], titles: [] }).status).toBe('NONE');
    expect(billingOf({ ...base, items: [item(50000, { covered: true })], titles: [] })).toMatchObject({ status: 'NONE', total: 50000, chargeable: 0, unbilled: 0 });
  });

  it('item coberto por orçamento não gera cobrança; o resto gera', () => {
    const b = billingOf({ ...base, items: [item(50000, { covered: true }), item(12000)], titles: [] });
    expect(b).toMatchObject({ status: 'TO_RECEIVE', chargeable: 12000, unbilled: 12000 });
  });

  it('a receber, faturado, pago em parte e pago', () => {
    const items = [item(20000)];
    expect(billingOf({ ...base, items, titles: [] }).status).toBe('TO_RECEIVE');
    expect(billingOf({ ...base, items, titles: [titulo(20000)] })).toMatchObject({ status: 'BILLED', open: 20000, unbilled: 0 });
    expect(billingOf({ ...base, items, titles: [titulo(20000, 5000)] })).toMatchObject({ status: 'PARTIAL', paid: 5000, open: 15000 });
    expect(billingOf({ ...base, items, titles: [titulo(20000, 20000)] })).toMatchObject({ status: 'PAID', open: 0 });
    // Parcelado: uma parcela paga e outra aberta é "pago em parte".
    expect(billingOf({ ...base, items, titles: [titulo(10000, 10000), titulo(10000)] }).status).toBe('PARTIAL');
  });

  it('título cancelado não conta; item acrescentado depois deixa parte sem faturar', () => {
    const items = [item(20000)];
    expect(billingOf({ ...base, items, titles: [titulo(20000, 0, 'CANCELLED')] })).toMatchObject({ status: 'TO_RECEIVE', billed: 0, unbilled: 20000 });
    const mais = billingOf({ ...base, items: [item(20000), item(8000)], titles: [titulo(20000, 20000)] });
    expect(mais).toMatchObject({ status: 'PARTIAL', unbilled: 8000, open: 0 });
  });

  it('não cobrar: sai da cobrança e não deixa nada por faturar', () => {
    expect(billingOf({ type: 'PARTICULAR', noCharge: true, items: [item(20000)], titles: [] })).toMatchObject({ status: 'NO_CHARGE', unbilled: 0 });
  });

  it('agendamento sem itens gravados: sai do preço do procedimento', () => {
    expect(billingFromProcedure('PARTICULAR', 15000)).toBe('TO_RECEIVE');
    expect(billingFromProcedure('PARTICULAR', 0)).toBe('NONE');
    expect(billingFromProcedure('PARTICULAR', null)).toBe('NONE');
    expect(billingFromProcedure('CORTESIA', 15000)).toBe('NONE');
  });

  it('filtro "só quem falta pagar"', () => {
    expect(['TO_RECEIVE', 'BILLED', 'PARTIAL'].every((s) => owesMoney(s as never))).toBe(true);
    expect(['NONE', 'PAID', 'NO_CHARGE', null].some((s) => owesMoney(s as never))).toBe(false);
  });

  it('bloqueio do início do atendimento', () => {
    expect(startBlocked('OFF', 'TO_RECEIVE')).toBeNull();
    expect(startBlocked('BILLED', 'TO_RECEIVE')).toBeTruthy();
    expect(startBlocked('BILLED', 'BILLED')).toBeNull();
    expect(startBlocked('PAID', 'BILLED')).toBeTruthy();
    expect(startBlocked('PAID', 'PARTIAL')).toBeTruthy();
    expect(startBlocked('PAID', 'PAID')).toBeNull();
    expect(startBlocked('PAID', 'NONE')).toBeNull();
    expect(startBlocked('PAID', 'NO_CHARGE')).toBeNull();
  });
});
