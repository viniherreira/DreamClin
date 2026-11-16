import { describe, expect, it } from 'vitest';
import { allocateByPercent, checkAllocation, prorate } from './allocation';
import { accountBalance, expectedByMethod, signedAmount, walletBalance } from './balance';
import { cardReceivables, feeTierFor, settlementDate, settlementRule, totalFee, totalNet } from './card';
import { addDays, addMonths, competenceOf, dayBR, daysBetween, isCompetence, isDay, nextDayOfMonth } from './dates';
import { DEFAULT_CATEGORIES, DEFAULT_METHODS, guessMethodKind, SYSTEM_CATEGORY } from './defaults';
import { buildDre, DRE_LINES, isDreLine, variation } from './dre';
import { recurrenceDates, simulateInstallments, splitInstallments } from './installments';
import { financedInstallments, lateCharges } from './interest';
import { formatCents, fromCents, parseMoney, percentOf, toCents } from './money';
import { cleanFinanceSettings, DEFAULT_FINANCE_SETTINGS, readFinanceSettings } from './settings';
import { agingBucket, displayStatus, openCents, settledStatus } from './title-status';

describe('dinheiro em centavos', () => {
  it('converte reais para centavos sem erro de ponto flutuante', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('1234.56')).toBe(123456);
    expect(toCents({ toString: () => '333.33' })).toBe(33333);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents('-5.5')).toBe(-550);
    expect(toCents(null)).toBe(0);
    expect(toCents('12.345')).toBe(1235);
  });

  it('volta para reais com duas casas', () => {
    expect(fromCents(123456)).toBe('1234.56');
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(-150)).toBe('-1.50');
  });

  it('lê o que a pessoa digita', () => {
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('R$ 50')).toBe(5000);
    expect(parseMoney('50,5')).toBe(5050);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });

  it('calcula porcentagem arredondando meio centavo para cima', () => {
    expect(percentOf(50000, 2)).toBe(1000);
    expect(percentOf(50000, 0.33)).toBe(165);
    expect(percentOf(100, 0.5)).toBe(1);
    expect(percentOf(333, 10)).toBe(33);
    expect(formatCents(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
  });
});

describe('datas sem hora', () => {
  it('soma dias e meses sem pular mês', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-11-01', '2026-11-11')).toBe(10);
    expect(competenceOf('2026-11-16')).toBe('2026-11');
    expect(dayBR('2026-11-16')).toBe('16/11/2026');
  });

  it('reconhece dia e competência válidos', () => {
    expect(isDay('2026-02-30')).toBe(true); // o Date aceita e normaliza; a tela usa input de data
    expect(isDay('16/11/2026')).toBe(false);
    expect(isCompetence('2026-13')).toBe(false);
    expect(isCompetence('2026-01')).toBe(true);
  });

  it('acha o próximo dia fixo do mês', () => {
    expect(nextDayOfMonth('2026-11-16', 20)).toBe('2026-11-20');
    expect(nextDayOfMonth('2026-11-20', 20)).toBe('2026-12-20');
    expect(nextDayOfMonth('2026-01-31', 31)).toBe('2026-02-28');
  });
});

describe('parcelamento', () => {
  it('R$ 1.000 em 3x dá 333,33 + 333,33 + 333,34', () => {
    expect(splitInstallments(100000, 3)).toEqual([33333, 33333, 33334]);
  });

  it('a soma das parcelas sempre fecha com o total', () => {
    for (const [total, n] of [[100001, 7], [999, 4], [1, 3], [123457, 12]] as const) {
      const p = splitInstallments(total, n);
      expect(p.reduce((s, v) => s + v, 0)).toBe(total);
      expect(p).toHaveLength(n);
    }
  });

  it('simula as datas mês a mês ou a cada N dias', () => {
    expect(simulateInstallments(30000, 3, '2026-01-31').map((l) => l.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(simulateInstallments(30000, 3, '2026-11-16', { kind: 'days', days: 15 }).map((l) => l.dueDate)).toEqual(['2026-11-16', '2026-12-01', '2026-12-16']);
  });

  it('recorrência respeita o fim por data, por vezes e o que já foi gerado', () => {
    const mensal = { every: 1, unit: 'MONTH' as const, start: '2026-01-10' };
    expect(recurrenceDates(mensal, '2026-04-30')).toEqual(['2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10']);
    expect(recurrenceDates({ ...mensal, occurrences: 2 }, '2027-01-01')).toEqual(['2026-01-10', '2026-02-10']);
    expect(recurrenceDates({ ...mensal, end: '2026-02-28' }, '2027-01-01')).toEqual(['2026-01-10', '2026-02-10']);
    expect(recurrenceDates(mensal, '2026-04-30', '2026-02-10')).toEqual(['2026-03-10', '2026-04-10']);
    expect(recurrenceDates({ every: 2, unit: 'WEEK', start: '2026-11-02' }, '2026-12-01')).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
  });
});

describe('juros e multa', () => {
  it('R$ 500 vencido há 10 dias, multa 2% e juros 0,033% ao dia', () => {
    const r = lateCharges(50000, '2026-11-06', '2026-11-16', { finePercent: 2, dailyInterestPercent: 0.033 });
    expect(r).toEqual({ daysLate: 10, fine: 1000, interest: 165, total: 51165 });
  });

  it('não cobra nada de quem ainda não venceu', () => {
    expect(lateCharges(50000, '2026-11-16', '2026-11-16', { finePercent: 2, dailyInterestPercent: 0.033 })).toEqual({ daysLate: 0, fine: 0, interest: 0, total: 50000 });
    expect(lateCharges(50000, '2026-12-01', '2026-11-16', { finePercent: 2, dailyInterestPercent: 0.033 }).total).toBe(50000);
  });

  it('parcela da renegociação: sem juros, simples e Price', () => {
    expect(financedInstallments(100000, 3, 0, 'SIMPLE')).toEqual([33333, 33333, 33334]);
    // 2% ao mês por 3 meses, simples: 1.000 + 60 = 1.060 em 3x.
    expect(financedInstallments(100000, 3, 2, 'SIMPLE')).toEqual([35333, 35333, 35334]);
    // Price: 1.000 a 2% em 3x = 346,75 cada.
    expect(financedInstallments(100000, 3, 2, 'PRICE')).toEqual([34675, 34675, 34675]);
  });
});

describe('situação do título', () => {
  it('baixa parcial deixa PARCIAL e o resto vira PAGO', () => {
    expect(settledStatus(10000, 4000)).toBe('PARTIAL');
    expect(settledStatus(10000, 10000)).toBe('PAID');
    expect(settledStatus(10000, 0, 'PARTIAL')).toBe('OPEN');
    expect(openCents(10000, 4000)).toBe(6000);
  });

  it('cancelado e renegociado não mudam com baixa', () => {
    expect(settledStatus(10000, 10000, 'CANCELLED')).toBe('CANCELLED');
    expect(settledStatus(10000, 0, 'RENEGOTIATED')).toBe('RENEGOTIATED');
  });

  it('vencido é calculado na hora', () => {
    expect(displayStatus('OPEN', '2026-11-15', '2026-11-16')).toBe('OVERDUE');
    expect(displayStatus('PARTIAL', '2026-11-15', '2026-11-16')).toBe('OVERDUE');
    expect(displayStatus('OPEN', '2026-11-16', '2026-11-16')).toBe('OPEN');
    expect(displayStatus('PAID', '2026-11-01', '2026-11-16')).toBe('PAID');
    expect(agingBucket(0)).toBeNull();
    expect([agingBucket(30), agingBucket(31), agingBucket(90), agingBucket(91)]).toEqual(['1-30', '31-60', '61-90', '90+']);
  });
});

describe('rateio', () => {
  it('a soma tem de bater com o valor', () => {
    expect(checkAllocation(10000, [])).toEqual({ ok: true });
    expect(checkAllocation(10000, [{ categoryId: 'a', amount: 6000 }, { categoryId: 'b', amount: 4000 }])).toEqual({ ok: true });
    const falta = checkAllocation(10000, [{ categoryId: 'a', amount: 6000 }]);
    expect(falta.ok).toBe(false);
    if (!falta.ok) expect(falta.difference).toBe(4000);
    const passa = checkAllocation(10000, [{ categoryId: 'a', amount: 12000 }]);
    if (!passa.ok) expect(passa.difference).toBe(-2000);
  });

  it('divide por porcentagem e por peso sem perder centavo', () => {
    expect(allocateByPercent(10001, [33.33, 33.33, 33.34])).toEqual([3333, 3333, 3335]);
    expect(prorate(1000, [1, 1, 1])).toEqual([333, 333, 334]);
    expect(prorate(5000, [30000, 10000])).toEqual([3750, 1250]);
    expect(prorate(100, [0, 0])).toEqual([0, 0]);
  });
});

describe('cartão', () => {
  const faixas = [
    { upToInstallments: 1, percent: 3.2 },
    { upToInstallments: 6, percent: 4.5 },
    { upToInstallments: 12, percent: 5.9 },
  ];

  it('acha a faixa de taxa pelo número de parcelas', () => {
    expect(feeTierFor(faixas, 1)?.percent).toBe(3.2);
    expect(feeTierFor(faixas, 3)?.percent).toBe(4.5);
    expect(feeTierFor(faixas, 12)?.percent).toBe(5.9);
    expect(feeTierFor(faixas, 18)?.percent).toBe(5.9);
    expect(feeTierFor([], 3)).toBeNull();
  });

  it('3x: taxa, líquido e compensação de cada parcela', () => {
    const linhas = cardReceivables(80000, 3, faixas, '2026-11-16', { type: 'DAYS', days: 30 });
    expect(linhas.map((l) => l.gross)).toEqual([26666, 26666, 26668]);
    // 4,5% de 800,00 = 36,00 → 12,00 por parcela.
    expect(linhas.map((l) => l.fee)).toEqual([1200, 1200, 1200]);
    expect(linhas.map((l) => l.net)).toEqual([25466, 25466, 25468]);
    expect(linhas.map((l) => l.expectedDate)).toEqual(['2026-12-16', '2027-01-15', '2027-02-14']);
    expect(totalFee(linhas)).toBe(3600);
    expect(totalNet(linhas)).toBe(76400);
  });

  it('compensação no mesmo dia, em D+N e em dia fixo', () => {
    expect(settlementDate('2026-11-16', { type: 'SAME_DAY' })).toBe('2026-11-16');
    expect(settlementDate('2026-11-16', { type: 'DAYS', days: 1 })).toBe('2026-11-17');
    expect(settlementDate('2026-11-16', { type: 'DAY_OF_MONTH', day: 10 }, 1)).toBe('2027-01-10');
    expect(settlementRule('DAYS', 30)).toEqual({ type: 'DAYS', days: 30 });
    expect(settlementRule('DAYS', null)).toEqual({ type: 'SAME_DAY' });
    expect(settlementRule('QUALQUER', 3)).toEqual({ type: 'SAME_DAY' });
  });

  it('taxa fixa por parcela e taxa nunca maior que o valor', () => {
    const fixa = cardReceivables(10000, 2, [{ upToInstallments: 12, fixedCents: 50 }], '2026-11-16', { type: 'SAME_DAY' });
    expect(totalFee(fixa)).toBe(100);
    const absurda = cardReceivables(100, 1, [{ upToInstallments: 1, fixedCents: 500 }], '2026-11-16', { type: 'SAME_DAY' });
    expect(absurda[0].net).toBe(0);
  });
});

describe('saldos', () => {
  it('cada tipo de movimento entra ou sai da conta; a carteira não mexe', () => {
    expect(signedAmount('RECEIPT', 5000)).toBe(5000);
    expect(signedAmount('PAYMENT', 5000)).toBe(-5000);
    expect(signedAmount('WITHDRAWAL', 5000)).toBe(-5000);
    expect(signedAmount('REINFORCEMENT', 5000)).toBe(5000);
    expect(signedAmount('RECEIPT', 5000, true)).toBe(0);
    expect(accountBalance(10000, -2500)).toBe(7500);
    expect(walletBalance([5000, -2000, 1000])).toBe(4000);
  });

  it('soma o esperado do caixa por meio', () => {
    const m = expectedByMethod([
      { methodKind: 'CASH', signedAmount: 10000 },
      { methodKind: 'CASH', signedAmount: -3000 },
      { methodKind: 'PIX', signedAmount: 5000 },
      { methodKind: null, signedAmount: 100 },
    ]);
    expect(Object.fromEntries(m)).toEqual({ CASH: 7000, PIX: 5000, OTHER: 100 });
  });
});

describe('DRE', () => {
  it('soma as linhas com o sinal certo e fecha os subtotais', () => {
    const linhas = buildDre({ RECEITA_BRUTA: 100000, IMPOSTOS: 6000, DEDUCOES_RECEITA: 4000, CUSTO_SERVICOS: 20000, DESPESAS_PESSOAL: 15000, DESPESAS_ADMINISTRATIVAS: 10000, INVESTIMENTOS_ATIVOS: 5000 });
    const v = (id: string) => linhas.find((l) => l.id === id)?.value;
    expect(v('RECEITA_LIQUIDA')).toBe(90000);
    expect(v('RESULTADO_BRUTO')).toBe(70000);
    expect(v('TOTAL_DESPESAS')).toBe(-25000);
    expect(v('RESULTADO_ANTES_IR')).toBe(40000);
    expect(v('RESULTADO_LIQUIDO')).toBe(40000);
    expect(v('IMPOSTOS')).toBe(-6000);
  });

  it('o resultado bate com receitas menos todo o resto', () => {
    const totais = Object.fromEntries(DRE_LINES.map((l, i) => [l, (i + 1) * 100]));
    const linhas = buildDre(totais);
    const soma = linhas.filter((l) => l.kind === 'line').reduce((s, l) => s + l.value, 0);
    expect(linhas.at(-1)?.value).toBe(soma);
    expect(isDreLine('RECEITA_BRUTA')).toBe(true);
    expect(isDreLine('NADA')).toBe(false);
    expect(variation(120, 100)).toBe(20);
    expect(variation(50, 0)).toBeNull();
  });
});

describe('padrões e configurações', () => {
  it('o plano de contas padrão tem chaves únicas e cobre o que o sistema usa', () => {
    const chaves = DEFAULT_CATEGORIES.flatMap((c) => [c.key, ...c.children.map((s) => s.key)]);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const k of Object.values(SYSTEM_CATEGORY)) expect(chaves).toContain(k);
    expect(DEFAULT_METHODS.map((m) => m.kind)).toContain('WALLET');
  });

  it('adivinha o tipo das formas antigas, que eram só texto', () => {
    expect(guessMethodKind('PIX')).toBe('PIX');
    expect(guessMethodKind('Cartão de crédito')).toBe('CREDIT_CARD');
    expect(guessMethodKind('Cartão de débito')).toBe('DEBIT_CARD');
    expect(guessMethodKind('Dinheiro')).toBe('CASH');
    expect(guessMethodKind('Transferência')).toBe('TRANSFER');
    expect(guessMethodKind('Permuta')).toBe('OTHER');
  });

  it('configuração vazia ou estranha cai nos padrões', () => {
    expect(readFinanceSettings(null)).toEqual(DEFAULT_FINANCE_SETTINGS);
    expect(readFinanceSettings({ finance: 'x' })).toEqual(DEFAULT_FINANCE_SETTINGS);
    const s = cleanFinanceSettings({ finePercent: 999, closeWithUnbilled: 'BLOCK', blockStartWithoutPayment: 'talvez', requireOpenCashForCash: false });
    expect(s.finePercent).toBe(20);
    expect(s.closeWithUnbilled).toBe('BLOCK');
    expect(s.blockStartWithoutPayment).toBe('OFF');
    expect(s.requireOpenCashForCash).toBe(false);
  });
});
