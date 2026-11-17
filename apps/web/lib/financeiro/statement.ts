/**
 * Extratos e arquivos de operadora: ler OFX e CSV, e casar as linhas com os
 * movimentos (exato: mesmo valor e mesma data; aproximado: mesmo valor, até 5
 * dias de diferença). Centavos inteiros. Puro e testado em `statement.test.ts`.
 */

import { daysBetween, isDay, type Day } from './dates';

export interface StatementLineIn {
  date: Day;
  /** Com sinal: positivo entrou, negativo saiu. */
  amount: number;
  description: string;
  externalId: string | null;
}

/** "1.234,56", "-1234.56", "1234,5" → centavos. Nulo se não for número. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/\s|R\$/g, '');
  if (!s) return null;
  const negativo = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()+-]/g, '');
  // O último separador é o decimal.
  const ultimo = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let inteiro = s;
  let decimal = '';
  if (ultimo >= 0 && s.length - ultimo - 1 <= 2) {
    inteiro = s.slice(0, ultimo);
    decimal = s.slice(ultimo + 1);
  }
  inteiro = inteiro.replace(/[.,]/g, '');
  if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(decimal) || (!inteiro && !decimal)) return null;
  const cents = Number(inteiro || '0') * 100 + Number(decimal.padEnd(2, '0') || '0');
  return negativo ? -cents : cents;
}

/** Data de verdade (isDay só confere o formato: 31/02 passaria). */
const real = (d: string): Day | null => (isDay(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d ? d : null);

/** "2026-11-17", "17/11/2026", "20261117" (e com hora depois) → dia. */
export function parseDate(raw: string): Day | null {
  const s = raw.trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (m) {
    return real(`${m[1]}-${m[2]}-${m[3]}`);
  }
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) {
    return real(`${m[3]}-${m[2]}-${m[1]}`);
  }
  return null;
}

/** OFX (SGML ou XML): cada STMTTRN vira uma linha. */
export function parseOfx(text: string): StatementLineIn[] {
  const out: StatementLineIn[] = [];
  const blocos = text.split(/<STMTTRN>/i).slice(1);
  const campo = (bloco: string, nome: string) => {
    const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(bloco);
    return m ? m[1].trim() : '';
  };
  for (const b of blocos) {
    const corpo = b.split(/<\/STMTTRN>/i)[0];
    const date = parseDate(campo(corpo, 'DTPOSTED'));
    const amount = parseAmount(campo(corpo, 'TRNAMT'));
    if (!date || amount == null || amount === 0) continue;
    const desc = [campo(corpo, 'NAME'), campo(corpo, 'MEMO')].filter(Boolean).join(' · ') || campo(corpo, 'TRNTYPE') || 'Lançamento';
    out.push({ date, amount, description: desc.slice(0, 200), externalId: campo(corpo, 'FITID') || null });
  }
  return out;
}

/** Divide uma linha de CSV (ponto e vírgula ou vírgula), respeitando aspas. */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (aspas && line[i + 1] === '"') {
        atual += '"';
        i++;
      } else aspas = !aspas;
    } else if (c === sep && !aspas) {
      out.push(atual);
      atual = '';
    } else atual += c;
  }
  out.push(atual);
  return out.map((x) => x.trim());
}

const separador = (header: string) => (header.split(';').length >= header.split(',').length ? ';' : ',');
const normaliza = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** CSV de extrato: colunas data, descrição e valor (ou crédito e débito). */
export function parseStatementCsv(text: string): StatementLineIn[] {
  const linhas = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) return [];
  const sep = separador(linhas[0]);
  const cab = splitCsvLine(linhas[0], sep).map(normaliza);
  const idx = (...nomes: string[]) => cab.findIndex((c) => nomes.some((n) => c.includes(n)));
  const iData = idx('data', 'date');
  const iDesc = idx('descricao', 'historico', 'memo', 'description');
  const iValor = idx('valor', 'amount', 'montante');
  const iCredito = idx('credito', 'entrada');
  const iDebito = idx('debito', 'saida');
  const iId = idx('id', 'documento', 'fitid');
  if (iData < 0 || (iValor < 0 && iCredito < 0)) return [];
  const out: StatementLineIn[] = [];
  for (const l of linhas.slice(1)) {
    const c = splitCsvLine(l, sep);
    const date = parseDate(c[iData] ?? '');
    let amount = iValor >= 0 ? parseAmount(c[iValor] ?? '') : null;
    if (amount == null && iCredito >= 0) {
      const cr = parseAmount(c[iCredito] ?? '') ?? 0;
      const db = iDebito >= 0 ? (parseAmount(c[iDebito] ?? '') ?? 0) : 0;
      amount = Math.abs(cr) - Math.abs(db);
    }
    if (!date || amount == null || amount === 0) continue;
    out.push({ date, amount, description: (iDesc >= 0 ? c[iDesc] : '')?.slice(0, 200) || 'Lançamento', externalId: iId >= 0 && iId !== iValor && iId !== iData ? c[iId] || null : null });
  }
  return out;
}

export interface MatchCandidate {
  id: string;
  date: Day;
  /** Efeito na conta (com sinal). */
  amount: number;
}

export interface MatchResult {
  lineIndex: number;
  candidateId: string;
  exact: boolean;
}

/**
 * Casa linhas do extrato com movimentos: primeiro os exatos (mesmo valor e
 * dia), depois os aproximados (mesmo valor, até `toleranceDays`), sempre o de
 * data mais próxima. Cada movimento casa uma vez só.
 */
export function matchStatement(lines: readonly { date: Day; amount: number }[], candidates: readonly MatchCandidate[], toleranceDays = 5): MatchResult[] {
  const usados = new Set<string>();
  const out: MatchResult[] = [];
  const casadas = new Set<number>();
  for (const passo of ['exact', 'approx'] as const) {
    lines.forEach((l, i) => {
      if (casadas.has(i)) return;
      let melhor: { c: MatchCandidate; dist: number } | null = null;
      for (const c of candidates) {
        if (usados.has(c.id) || c.amount !== l.amount) continue;
        const dist = Math.abs(daysBetween(l.date, c.date));
        if (passo === 'exact' ? dist !== 0 : dist > toleranceDays) continue;
        if (!melhor || dist < melhor.dist) melhor = { c, dist };
      }
      if (melhor) {
        usados.add(melhor.c.id);
        casadas.add(i);
        out.push({ lineIndex: i, candidateId: melhor.c.id, exact: passo === 'exact' });
      }
    });
  }
  return out.sort((a, b) => a.lineIndex - b.lineIndex);
}

export interface CardFileLine {
  date: Day;
  nsu: string | null;
  installment: number | null;
  gross: number | null;
  fee: number | null;
  net: number;
}

/**
 * CSV padrão do DreamClin para a operadora de cartão:
 * data;nsu;parcela;valor_bruto;taxa;valor_liquido (só data e líquido são obrigatórios).
 */
export function parseCardCsv(text: string): CardFileLine[] {
  const linhas = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) return [];
  const sep = separador(linhas[0]);
  const cab = splitCsvLine(linhas[0], sep).map(normaliza);
  const idx = (...nomes: string[]) => cab.findIndex((c) => nomes.some((n) => c === n || c.includes(n)));
  const iData = idx('data', 'datapagamento', 'datadecredito');
  const iNsu = idx('nsu', 'autorizacao');
  const iParcela = idx('parcela');
  const iBruto = idx('valorbruto', 'bruto');
  const iTaxa = idx('taxa');
  const iLiquido = idx('valorliquido', 'liquido');
  if (iData < 0 || iLiquido < 0) return [];
  const out: CardFileLine[] = [];
  for (const l of linhas.slice(1)) {
    const c = splitCsvLine(l, sep);
    const date = parseDate(c[iData] ?? '');
    const net = parseAmount(c[iLiquido] ?? '');
    if (!date || net == null) continue;
    const parcela = iParcela >= 0 ? Number.parseInt((c[iParcela] ?? '').split('/')[0], 10) : NaN;
    out.push({
      date,
      nsu: iNsu >= 0 ? c[iNsu] || null : null,
      installment: Number.isFinite(parcela) ? parcela : null,
      gross: iBruto >= 0 ? parseAmount(c[iBruto] ?? '') : null,
      fee: iTaxa >= 0 ? parseAmount(c[iTaxa] ?? '') : null,
      net: Math.abs(net),
    });
  }
  return out;
}

export interface ReceivableLike {
  id: string;
  nsu: string | null;
  installment: number;
  expectedDate: Day;
  net: number;
}

/** Casa o arquivo da operadora com os recebíveis: NSU + parcela; sem NSU, líquido e data (até 5 dias). */
export function matchCardFile(file: readonly CardFileLine[], receivables: readonly ReceivableLike[]): { fileIndex: number; receivableId: string | null; diff: number | null }[] {
  const usados = new Set<string>();
  return file.map((f, i) => {
    let r = f.nsu ? receivables.find((x) => !usados.has(x.id) && x.nsu === f.nsu && (f.installment == null || x.installment === f.installment)) : undefined;
    if (!r) {
      r = receivables
        .filter((x) => !usados.has(x.id) && x.net === f.net && Math.abs(daysBetween(x.expectedDate, f.date)) <= 5)
        .sort((a, b) => Math.abs(daysBetween(a.expectedDate, f.date)) - Math.abs(daysBetween(b.expectedDate, f.date)))[0];
    }
    if (!r) return { fileIndex: i, receivableId: null, diff: null };
    usados.add(r.id);
    return { fileIndex: i, receivableId: r.id, diff: f.net - r.net };
  });
}
