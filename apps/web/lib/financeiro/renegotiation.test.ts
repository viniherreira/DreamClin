import { describe, expect, it } from 'vitest';
import { correctTitles, planRenegotiation, type PlanInput } from './renegotiation';

const base: PlanInput = { correctedTotal: 100000, discount: 0, downPayment: 0, installments: 4, monthlyInterestPercent: 0, mode: 'SIMPLE', firstDueDate: '2026-12-10', interval: { kind: 'monthly' } };

describe('renegociação: valor corrigido', () => {
  it('soma multa e juros ao dia nas vencidas; as em dia ficam como estão', () => {
    const r = correctTitles(
      [
        { id: 'a', openCents: 50000, dueDate: '2026-11-07' },
        { id: 'b', openCents: 30000, dueDate: '2026-12-01' },
      ],
      '2026-11-17',
      { finePercent: 2, dailyInterestPercent: 0.033 },
    );
    // 500 vencidos há 10 dias: multa de 10,00 e juros de 1,65.
    expect(r[0]).toMatchObject({ daysLate: 10, fine: 1000, interest: 165, corrected: 51165 });
    expect(r[1]).toMatchObject({ daysLate: 0, corrected: 30000 });
  });

  it('sem regra de atraso, o corrigido é o em aberto', () => {
    expect(correctTitles([{ id: 'a', openCents: 50000, dueDate: '2026-01-01' }], '2026-11-17', null)[0].corrected).toBe(50000);
  });
});

describe('renegociação: parcelas novas', () => {
  it('R$ 1.000 em 3x sem juros: centavos na última', () => {
    const r = planRenegotiation({ ...base, installments: 3 });
    expect(r.ok && r.lines.map((l) => l.amount)).toEqual([33333, 33333, 33334]);
    expect(r.ok && r.lines.map((l) => l.dueDate)).toEqual(['2026-12-10', '2027-01-10', '2027-02-10']);
  });

  it('desconto e entrada saem antes de parcelar', () => {
    const r = planRenegotiation({ ...base, discount: 10000, downPayment: 30000, installments: 2 });
    expect(r).toMatchObject({ ok: true, financed: 60000, total: 90000, interest: 0 });
    expect(r.ok && r.lines.map((l) => l.amount)).toEqual([30000, 30000]);
  });

  it('juros simples e Price', () => {
    const simples = planRenegotiation({ ...base, installments: 4, monthlyInterestPercent: 2 });
    // 1.000 + 2% × 4 meses = 1.080, em 4 de 270.
    expect(simples).toMatchObject({ ok: true, total: 108000, interest: 8000 });
    const price = planRenegotiation({ ...base, installments: 4, monthlyInterestPercent: 2, mode: 'PRICE' });
    expect(price.ok && price.lines[0].amount).toBe(26262);
    expect(price.ok && price.interest).toBe(26262 * 4 - 100000);
  });

  it('a cada tantos dias', () => {
    const r = planRenegotiation({ ...base, installments: 3, interval: { kind: 'days', days: 15 } });
    expect(r.ok && r.lines.map((l) => l.dueDate)).toEqual(['2026-12-10', '2026-12-25', '2027-01-09']);
  });

  it('tudo de entrada: sem parcelas', () => {
    expect(planRenegotiation({ ...base, downPayment: 100000 })).toMatchObject({ ok: true, financed: 0, lines: [] });
  });

  it('recusa desconto igual ao total, entrada maior que o total e parcelas fora da faixa', () => {
    expect(planRenegotiation({ ...base, discount: 100000 }).ok).toBe(false);
    expect(planRenegotiation({ ...base, downPayment: 100001 }).ok).toBe(false);
    expect(planRenegotiation({ ...base, installments: 0 }).ok).toBe(false);
    expect(planRenegotiation({ ...base, installments: 61 }).ok).toBe(false);
    expect(planRenegotiation({ ...base, correctedTotal: 0 }).ok).toBe(false);
  });
});
