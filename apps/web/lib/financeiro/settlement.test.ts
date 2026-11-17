import { describe, expect, it } from 'vitest';
import { discountPercent, planSettlement } from './settlement';

const dinheiro = (amount: number) => ({ amount, isCash: true });
const pix = (amount: number) => ({ amount, isCash: false });

describe('a conta do recebimento', () => {
  it('quita com um meio só', () => {
    const p = planSettlement({ open: 10000, lines: [pix(10000)] });
    expect(p).toMatchObject({ ok: true, settled: 10000, remaining: 0, change: 0, walletCredit: 0 });
  });

  it('baixa parcial: fica o resto em aberto', () => {
    const p = planSettlement({ open: 10000, lines: [pix(4000)] });
    expect(p).toMatchObject({ ok: true, settled: 4000, remaining: 6000 });
  });

  it('vários meios no mesmo recebimento', () => {
    const p = planSettlement({ open: 100000, lines: [pix(20000), { amount: 80000, isCash: false }] });
    if (!p.ok) throw new Error(p.message);
    expect(p.lines.map((l) => l.principal)).toEqual([20000, 80000]);
    expect(p.remaining).toBe(0);
  });

  it('desconto diminui o total a receber e conta como quitado', () => {
    const p = planSettlement({ open: 10000, lines: [pix(9000)], discount: 1000 });
    if (!p.ok) throw new Error(p.message);
    expect(p.totalDue).toBe(9000);
    expect(p.settled).toBe(10000);
    expect(p.lines[0]).toMatchObject({ principal: 9000, discount: 1000 });
  });

  it('juros e multa saem primeiro; o resto abate o título', () => {
    const p = planSettlement({ open: 50000, lines: [pix(51165)], interest: 165, fine: 1000 });
    if (!p.ok) throw new Error(p.message);
    expect(p.lines[0]).toMatchObject({ kept: 51165, principal: 50000, interest: 165, fine: 1000 });
    expect(p.remaining).toBe(0);
  });

  it('juros repartidos quando o primeiro meio é pequeno', () => {
    const p = planSettlement({ open: 10000, lines: [pix(500), pix(10500)], interest: 1000 });
    if (!p.ok) throw new Error(p.message);
    expect(p.lines.map((l) => l.interest)).toEqual([500, 500]);
    expect(p.lines.map((l) => l.principal)).toEqual([0, 10000]);
    expect(p.remaining).toBe(0);
  });

  it('não recebe mais que o em aberto fora do dinheiro', () => {
    const p = planSettlement({ open: 10000, lines: [pix(12000)] });
    expect(p.ok).toBe(false);
  });

  it('dinheiro a mais volta de troco', () => {
    const p = planSettlement({ open: 8500, lines: [dinheiro(10000)] });
    if (!p.ok) throw new Error(p.message);
    expect(p).toMatchObject({ change: 1500, walletCredit: 0, settled: 8500, remaining: 0 });
    expect(p.lines[0].kept).toBe(8500);
  });

  it('ou vira crédito na carteira, se for paciente', () => {
    const p = planSettlement({ open: 8500, lines: [dinheiro(10000)], change: 'WALLET', walletAvailable: true });
    if (!p.ok) throw new Error(p.message);
    expect(p).toMatchObject({ change: 0, walletCredit: 1500, settled: 8500 });
    expect(planSettlement({ open: 8500, lines: [dinheiro(10000)], change: 'WALLET', walletAvailable: false }).ok).toBe(false);
  });

  it('o troco sai do dinheiro mesmo com outro meio junto', () => {
    const p = planSettlement({ open: 10000, lines: [pix(6000), dinheiro(5000)] });
    if (!p.ok) throw new Error(p.message);
    expect(p.change).toBe(1000);
    expect(p.lines.map((l) => l.kept)).toEqual([6000, 4000]);
    expect(p.excessLine).toBe(1);
  });

  it('recusa valor que não cobre nem os juros, desconto maior que a dívida e linha zerada', () => {
    expect(planSettlement({ open: 10000, lines: [pix(500)], interest: 1000 }).ok).toBe(false);
    expect(planSettlement({ open: 10000, lines: [pix(100)], discount: 20000 }).ok).toBe(false);
    expect(planSettlement({ open: 10000, lines: [pix(0)] }).ok).toBe(false);
    expect(planSettlement({ open: 10000, lines: [] }).ok).toBe(false);
    expect(planSettlement({ open: 0, lines: [pix(100)] }).ok).toBe(false);
  });

  it('desconto em porcentagem do em aberto', () => {
    expect(discountPercent(1000, 10000)).toBe(10);
    expect(discountPercent(1, 0)).toBe(0);
  });
});
