import { describe, expect, it } from 'vitest';
import { matchCardFile, matchStatement, parseAmount, parseCardCsv, parseDate, parseOfx, parseStatementCsv } from './statement';

describe('extrato: leitura', () => {
  it('valores nos formatos que os bancos usam', () => {
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('-1234.56')).toBe(-123456);
    expect(parseAmount('1234,5')).toBe(123450);
    expect(parseAmount('R$ 80')).toBe(8000);
    expect(parseAmount('(45,00)')).toBe(-4500);
    expect(parseAmount('1,234,567.89')).toBe(123456789);
    expect(parseAmount('abc')).toBeNull();
  });

  it('datas', () => {
    expect(parseDate('20261117120000[-3:BRT]')).toBe('2026-11-17');
    expect(parseDate('17/11/2026')).toBe('2026-11-17');
    expect(parseDate('2026-11-17')).toBe('2026-11-17');
    expect(parseDate('31/02/2026')).toBeNull();
  });

  it('OFX em SGML: valor com sinal, descrição e FITID', () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261110<TRNAMT>350.00<FITID>A1<NAME>PIX RECEBIDO<MEMO>Maria</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105<TRNAMT>-1200,00<FITID>A2<MEMO>Aluguel</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105<TRNAMT>0<FITID>A3</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(parseOfx(ofx)).toEqual([
      { date: '2026-11-10', amount: 35000, description: 'PIX RECEBIDO · Maria', externalId: 'A1' },
      { date: '2026-11-05', amount: -120000, description: 'Aluguel', externalId: 'A2' },
    ]);
  });

  it('CSV de extrato: valor único ou crédito e débito', () => {
    expect(parseStatementCsv('Data;Descrição;Valor\n10/11/2026;"PIX; Maria";350,00\n05/11/2026;Aluguel;-1.200,00')).toEqual([
      { date: '2026-11-10', amount: 35000, description: 'PIX; Maria', externalId: null },
      { date: '2026-11-05', amount: -120000, description: 'Aluguel', externalId: null },
    ]);
    expect(parseStatementCsv('data,historico,credito,debito\n2026-11-10,Depósito,100.00,\n2026-11-11,Tarifa,,12.50')).toEqual([
      { date: '2026-11-10', amount: 10000, description: 'Depósito', externalId: null },
      { date: '2026-11-11', amount: -1250, description: 'Tarifa', externalId: null },
    ]);
    expect(parseStatementCsv('nada;aqui\n1;2')).toEqual([]);
  });
});

describe('extrato: casar com os movimentos', () => {
  it('exato primeiro, depois aproximado pela data mais próxima; cada movimento uma vez', () => {
    const linhas = [
      { date: '2026-11-10' as const, amount: 35000 },
      { date: '2026-11-12' as const, amount: 35000 },
      { date: '2026-11-05' as const, amount: -120000 },
      { date: '2026-11-20' as const, amount: 999 },
    ];
    const movs = [
      { id: 'm1', date: '2026-11-09' as const, amount: 35000 },
      { id: 'm2', date: '2026-11-10' as const, amount: 35000 },
      { id: 'm3', date: '2026-11-01' as const, amount: -120000 },
      { id: 'm4', date: '2026-11-25' as const, amount: 999 },
    ];
    expect(matchStatement(linhas, movs)).toEqual([
      { lineIndex: 0, candidateId: 'm2', exact: true },
      { lineIndex: 1, candidateId: 'm1', exact: false },
      { lineIndex: 2, candidateId: 'm3', exact: false },
      { lineIndex: 3, candidateId: 'm4', exact: false },
    ]);
    // Mais de 5 dias: não casa.
    expect(matchStatement([{ date: '2026-11-20', amount: 999 }], [{ id: 'x', date: '2026-11-26', amount: 999 }])).toEqual([]);
  });
});

describe('arquivo da operadora de cartão', () => {
  it('lê o CSV padrão e casa por NSU e parcela, ou por líquido e data', () => {
    const f = parseCardCsv('data;nsu;parcela;valor_bruto;taxa;valor_liquido\n17/12/2026;123;1/3;100,00;3,00;97,00\n20/12/2026;;;;;48,50');
    expect(f).toEqual([
      { date: '2026-12-17', nsu: '123', installment: 1, gross: 10000, fee: 300, net: 9700 },
      { date: '2026-12-20', nsu: null, installment: null, gross: null, fee: null, net: 4850 },
    ]);
    const r = matchCardFile(f, [
      { id: 'r1', nsu: '123', installment: 1, expectedDate: '2026-12-16', net: 9750 },
      { id: 'r2', nsu: null, installment: 1, expectedDate: '2026-12-18', net: 4850 },
    ]);
    expect(r).toEqual([
      { fileIndex: 0, receivableId: 'r1', diff: -50 },
      { fileIndex: 1, receivableId: 'r2', diff: 0 },
    ]);
  });
});
