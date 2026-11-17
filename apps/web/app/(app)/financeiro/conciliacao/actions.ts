'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { financeAdvanced } from '@/fin/flag';
import { finRead, finWrite, type FinContext } from '@/fin/guard';
import {
  accountMovements,
  accountsReconSummary,
  anticipateTx,
  checkReturnedTx,
  createFromLineTx,
  discardLineTx,
  importStatementTx,
  lineCandidates,
  linkLineTx,
  listReceivables,
  reconcileReceivablesTx,
  setReconciledTx,
  statementLines,
  transferFromLineTx,
  undoLineTx,
  type RecEnv,
} from '@/fin/reconcile';
import { ensureFinanceSetup } from '@/fin/setup';
import { addDays, dateToDay, isDay, type Day } from '@/lib/financeiro/dates';
import { toCents } from '@/lib/financeiro/money';
import { matchCardFile, parseCardCsv, parseOfx, parseStatementCsv } from '@/lib/financeiro/statement';
import { clinicToday } from '@/lib/tz';

/**
 * Ações da conciliação. É trabalho de gestão (`fin_relatorios`) e dos planos
 * com relatórios completos: no plano menor, as leituras devolvem `locked`.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const env = (ctx: FinContext): RecEnv => ({ tenantId: ctx.tenantId, userId: ctx.userId, unitId: ctx.unitId, access: { role: ctx.role, permission: ctx.permission }, settings: ctx.settings, today: clinicToday() as Day });

async function leitura() {
  const g = await finRead('fin_relatorios');
  if (!g.ok) return null;
  await ensureFinanceSetup(g.ctx.tenantId);
  if (!(await financeAdvanced(g.ctx.tenantId))) return { locked: true as const };
  return { locked: false as const, ctx: g.ctx };
}

async function escrita(): Promise<{ ctx: FinContext } | { ok: false; message: string }> {
  const g = await finWrite('fin_relatorios');
  if (!g.ok) return g;
  if (!(await financeAdvanced(g.ctx.tenantId))) return { ok: false, message: 'A conciliação é do plano Profissional.' };
  return { ctx: g.ctx };
}

function refresh() {
  revalidatePath('/financeiro', 'layout');
}

// ─── Bancos ──────────────────────────────────────────────────────────────────

export async function reconSummaryAction() {
  const g = await leitura();
  if (!g) return null;
  if (g.locked) return { locked: true as const };
  return accountsReconSummary(g.ctx.db);
}

export async function statementLinesAction(accountId: string, show: 'pending' | 'all') {
  const g = await leitura();
  if (!g || g.locked) return [];
  return statementLines(g.ctx.db, accountId, show);
}

export async function lineCandidatesAction(lineId: string) {
  const g = await leitura();
  if (!g || g.locked) return [];
  return lineCandidates(g.ctx.db, lineId);
}

export async function accountMovementsAction(accountId: string, from: string, to: string) {
  const g = await leitura();
  if (!g || g.locked || !isDay(from) || !isDay(to)) return [];
  return accountMovements(g.ctx.db, accountId, from as Day, to as Day);
}

const MAX_FILE = 2 * 1024 * 1024;

export async function importStatementAction(accountId: string, formData: FormData): Promise<Result<{ added: number; skipped: number; matched: number }>> {
  const g = await escrita();
  if ('ok' in g) return g;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Escolha o arquivo do extrato.' };
  if (file.size > MAX_FILE) return { ok: false, message: 'Arquivo grande demais (máximo de 2 MB). Exporte um período menor.' };
  const nome = file.name.toLowerCase();
  // OFX costuma vir em Latin-1; o texto do extrato só serve para a descrição.
  const bytes = new Uint8Array(await file.arrayBuffer());
  let texto = new TextDecoder('utf-8').decode(bytes);
  if (texto.includes('�')) texto = new TextDecoder('latin1').decode(bytes);
  const ofx = nome.endsWith('.ofx') || /<OFX>/i.test(texto);
  const linhas = ofx ? parseOfx(texto) : parseStatementCsv(texto);
  const r = await g.ctx.db.$transaction((tx) => importStatementTx(tx, env(g.ctx), { accountId, filename: file.name, format: ofx ? 'OFX' : 'CSV', lines: linhas }));
  if (!r.ok) return r;
  refresh();
  return { ok: true, added: r.added, skipped: r.skipped, matched: r.matched };
}

export async function linkLineAction(lineId: string, transactionId: string): Promise<Result> {
  const g = await escrita();
  if ('ok' in g) return g;
  const r = await g.ctx.db.$transaction((tx) => linkLineTx(tx, env(g.ctx), lineId, transactionId));
  if (r.ok) refresh();
  return r;
}

export async function createFromLineAction(lineId: string, categoryId: string, description?: string | null): Promise<Result> {
  const g = await escrita();
  if ('ok' in g) return g;
  const r = await g.ctx.db.$transaction((tx) => createFromLineTx(tx, env(g.ctx), lineId, { categoryId, description }));
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

export async function transferFromLineAction(lineId: string, otherAccountId: string): Promise<Result> {
  const g = await escrita();
  if ('ok' in g) return g;
  const r = await g.ctx.db.$transaction((tx) => transferFromLineTx(tx, env(g.ctx), lineId, otherAccountId));
  if (r.ok) refresh();
  return r;
}

export async function discardLineAction(lineId: string): Promise<Result> {
  const g = await escrita();
  if ('ok' in g) return g;
  const r = await g.ctx.db.$transaction((tx) => discardLineTx(tx, env(g.ctx), lineId));
  if (r.ok) refresh();
  return r;
}

export async function undoLineAction(lineId: string): Promise<Result> {
  const g = await escrita();
  if ('ok' in g) return g;
  const r = await g.ctx.db.$transaction((tx) => undoLineTx(tx, env(g.ctx), lineId));
  if (r.ok) refresh();
  return r;
}

export async function setReconciledAction(transactionId: string, value: boolean): Promise<Result> {
  const g = await escrita();
  if ('ok' in g) return g;
  const r = await g.ctx.db.$transaction((tx) => setReconciledTx(tx, env(g.ctx), transactionId, value));
  if (r.ok) refresh();
  return r;
}

// ─── Cartões e cheques ───────────────────────────────────────────────────────

const recFilters = z.object({
  from: z.string().refine(isDay),
  to: z.string().refine(isDay),
  by: z.enum(['expected', 'reconciled']),
  status: z.enum(['OPEN', 'RECONCILED', 'CANCELLED', 'RETURNED', 'ALL']),
  kind: z.enum(['CARD', 'CHECK']).nullable().optional(),
});

export async function receivablesAction(input: z.input<typeof recFilters>) {
  const g = await leitura();
  if (!g) return null;
  if (g.locked) return { locked: true as const };
  const p = recFilters.safeParse(input);
  if (!p.success) return [];
  return listReceivables(g.ctx.db, { ...p.data, from: p.data.from as Day, to: p.data.to as Day });
}

export async function reconcileReceivablesAction(ids: string[]): Promise<Result<{ reconciled: number }>> {
  const g = await escrita();
  if ('ok' in g) return g;
  if (!ids.length || ids.length > 500) return { ok: false, message: 'Marque os recebíveis.' };
  const r = await g.ctx.db.$transaction((tx) => reconcileReceivablesTx(tx, env(g.ctx), ids));
  if (r.ok) refresh();
  return r;
}

export async function anticipateAction(ids: string[], date: string, receivedCents: number): Promise<Result<{ costCents: number }>> {
  const g = await escrita();
  if ('ok' in g) return g;
  if (!isDay(date)) return { ok: false, message: 'Confira a data.' };
  const r = await g.ctx.db.$transaction((tx) => anticipateTx(tx, env(g.ctx), { ids, date: date as Day, receivedCents: Math.round(receivedCents) }));
  if (r.ok) refresh();
  return r;
}

export async function checkReturnedAction(id: string): Promise<Result> {
  const g = await escrita();
  if ('ok' in g) return g;
  const r = await g.ctx.db.$transaction((tx) => checkReturnedTx(tx, env(g.ctx), id));
  if (r.ok) refresh();
  return r;
}

/** Lê o arquivo da operadora (CSV padrão do DreamClin) e mostra o casamento com os recebíveis em aberto. */
export async function previewCardFileAction(formData: FormData): Promise<Result<{ rows: { date: Day; nsu: string | null; installment: number | null; netCents: number; receivableId: string | null; systemNetCents: number | null; diffCents: number | null; party: string }[] }>> {
  const g = await escrita();
  if ('ok' in g) return g;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Escolha o arquivo da operadora.' };
  if (file.size > MAX_FILE) return { ok: false, message: 'Arquivo grande demais (máximo de 2 MB).' };
  const linhas = parseCardCsv(await file.text());
  if (!linhas.length) return { ok: false, message: 'Não achei pagamentos neste arquivo. Use o modelo: data;nsu;parcela;valor_bruto;taxa;valor_liquido.' };
  const datas = linhas.map((l) => l.date).sort();
  const abertos = await g.ctx.db.cardReceivable.findMany({
    where: { status: 'OPEN', kind: 'CARD', expectedDate: { gte: new Date(`${addDays(datas[0], -10)}T00:00:00Z`), lte: new Date(`${addDays(datas[datas.length - 1], 10)}T00:00:00Z`) } },
    include: { transaction: { select: { nsu: true, patientId: true } } },
  });
  const pacientes = new Map((await g.ctx.db.patient.findMany({ where: { id: { in: abertos.map((a) => a.transaction.patientId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const pares = matchCardFile(linhas, abertos.map((a) => ({ id: a.id, nsu: a.transaction.nsu, installment: a.installmentNumber, expectedDate: dateToDay(a.expectedDate), net: toCents(a.netAmount) })));
  const porId = new Map(abertos.map((a) => [a.id, a]));
  return {
    ok: true,
    rows: pares.map((p) => {
      const l = linhas[p.fileIndex];
      const a = p.receivableId ? porId.get(p.receivableId) : undefined;
      return { date: l.date, nsu: l.nsu, installment: l.installment, netCents: l.net, receivableId: p.receivableId, systemNetCents: a ? toCents(a.netAmount) : null, diffCents: p.diff, party: a?.transaction.patientId ? (pacientes.get(a.transaction.patientId) ?? '') : '' };
    }),
  };
}
