import 'server-only';

import { decrypt } from '@clinicaiq/db';
import { addDays, addMonths, dateToDay, dayToDate, daysBetween, type Day } from '@/lib/financeiro/dates';
import { buildDre, isDreLine, variation, type DreLine, type DreRow } from '@/lib/financeiro/dre';
import { toCents } from '@/lib/financeiro/money';
import { bucketIndex, buckets, competencesBetween, defaultRate, granularityFor, previousRange, type Bucket } from '@/lib/financeiro/reports';
import { agingBucket } from '@/lib/financeiro/title-status';
import { normalizeBrazilPhone } from '@/lib/phone';
import type { FinContext } from './guard';

/**
 * As leituras dos relatórios do financeiro. Nada aqui grava. Valores em
 * centavos. "Realizado" é dinheiro que andou (movimentos não estornados);
 * "previsto" são as contas em aberto pelo vencimento; a DRE é por competência
 * (as contas lançadas no mês, pagas ou não).
 */

const fimDoDia = (d: Day) => dayToDate(addDays(d, 1));

// ─── Visão geral ─────────────────────────────────────────────────────────────

export interface Overview {
  from: Day;
  to: Day;
  revenue: { period: number; openTotal: number; overdue: number; next7: number };
  expense: { period: number; openTotal: number; overdue: number; next7: number };
  accounts: { id: string; name: string; balance: number }[];
  accountsTotal: number;
  openCashSessions: number;
  attended: number;
  averageTicket: number | null;
  defaultRate: number | null;
  topProcedures: { name: string; quantity: number; cents: number }[];
  topSpecialties: { name: string; quantity: number; cents: number }[];
  months: { key: string; label: string; revenue: number; expense: number }[];
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export async function overview(ctx: FinContext, from: Day, to: Day, today: Day): Promise<Overview> {
  const { db } = ctx;
  const periodo = { gte: dayToDate(from), lt: fimDoDia(to) };
  const doze = addMonths(`${today.slice(0, 7)}-01` as Day, -11);

  const [rec, pag, abertos, contas, somas, caixas, atendidos, itens, serieMov] = await Promise.all([
    db.financialTransaction.aggregate({ where: { kind: 'RECEIPT', reversedAt: null, paidOn: periodo }, _sum: { signedAmount: true } }),
    db.financialTransaction.aggregate({ where: { kind: { in: ['PAYMENT', 'FEE'] }, reversedAt: null, paidOn: periodo }, _sum: { signedAmount: true } }),
    db.financialTitle.findMany({ where: { status: { in: ['OPEN', 'PARTIAL'] } }, select: { direction: true, dueDate: true, amount: true, paidAmount: true } }),
    db.financialAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true, openingBalance: true } }),
    db.financialTransaction.groupBy({ by: ['accountId'], where: { accountId: { not: null } }, _sum: { signedAmount: true } }),
    db.cashSession.count({ where: { status: 'OPEN' } }),
    db.appointment.count({ where: { status: 'ATTENDED', startTime: { gte: dayToDate(from), lt: fimDoDia(to) } } }),
    db.appointmentItem.findMany({
      where: { appointment: { status: 'ATTENDED', type: { not: 'CORTESIA' }, startTime: { gte: dayToDate(from), lt: fimDoDia(to) } } },
      select: { name: true, quantity: true, total: true, appointment: { select: { professional: { select: { specialty: true } } } } },
    }),
    db.financialTransaction.findMany({ where: { kind: { in: ['RECEIPT', 'PAYMENT', 'FEE'] }, reversedAt: null, paidOn: { gte: dayToDate(doze), lt: fimDoDia(today) } }, select: { kind: true, paidOn: true, signedAmount: true } }),
  ]);

  const r = { period: toCents(rec._sum.signedAmount), openTotal: 0, overdue: 0, next7: 0 };
  const p = { period: Math.abs(toCents(pag._sum.signedAmount)), openTotal: 0, overdue: 0, next7: 0 };
  const sete = addDays(today, 7);
  for (const t of abertos) {
    const aberto = Math.max(0, toCents(t.amount) - toCents(t.paidAmount));
    const venc = dateToDay(t.dueDate);
    const alvo = t.direction === 'RECEIVABLE' ? r : p;
    alvo.openTotal += aberto;
    if (venc < today) alvo.overdue += aberto;
    else if (venc <= sete) alvo.next7 += aberto;
  }

  const soma = new Map(somas.map((s) => [s.accountId!, toCents(s._sum.signedAmount)]));
  const accounts = contas.map((c) => ({ id: c.id, name: c.name, balance: toCents(c.openingBalance) + (soma.get(c.id) ?? 0) }));

  const porProc = new Map<string, { quantity: number; cents: number }>();
  const porEsp = new Map<string, { quantity: number; cents: number }>();
  for (const i of itens) {
    const a = porProc.get(i.name) ?? { quantity: 0, cents: 0 };
    a.quantity += i.quantity;
    a.cents += toCents(i.total);
    porProc.set(i.name, a);
    const nome = i.appointment.professional.specialty?.trim() || 'Sem especialidade';
    const e = porEsp.get(nome) ?? { quantity: 0, cents: 0 };
    e.quantity += i.quantity;
    e.cents += toCents(i.total);
    porEsp.set(nome, e);
  }
  const top = (m: Map<string, { quantity: number; cents: number }>) => [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((x, y) => y.cents - x.cents).slice(0, 10);

  const months: Overview['months'] = [];
  for (let i = 0; i < 12; i++) {
    const ini = addMonths(doze, i);
    months.push({ key: ini.slice(0, 7), label: `${MESES[Number(ini.slice(5, 7)) - 1]}/${ini.slice(2, 4)}`, revenue: 0, expense: 0 });
  }
  for (const m of serieMov) {
    const k = dateToDay(m.paidOn).slice(0, 7);
    const alvo = months.find((x) => x.key === k);
    if (!alvo) continue;
    if (m.kind === 'RECEIPT') alvo.revenue += toCents(m.signedAmount);
    else alvo.expense += Math.abs(toCents(m.signedAmount));
  }

  // Inadimplência: do que venceu no período, quanto ficou sem pagar.
  const vencidosPeriodo = await db.financialTitle.findMany({ where: { direction: 'RECEIVABLE', status: { notIn: ['CANCELLED', 'RENEGOTIATED'] }, dueDate: { gte: dayToDate(from), lt: dayToDate(to < today ? addDays(to, 1) : today) } }, select: { amount: true, paidAmount: true, status: true } });
  const venceu = vencidosPeriodo.reduce((s, t) => s + toCents(t.amount), 0);
  const ficou = vencidosPeriodo.filter((t) => t.status === 'OPEN' || t.status === 'PARTIAL').reduce((s, t) => s + toCents(t.amount) - toCents(t.paidAmount), 0);

  return {
    from,
    to,
    revenue: r,
    expense: p,
    accounts,
    accountsTotal: accounts.reduce((s, a) => s + a.balance, 0),
    openCashSessions: caixas,
    attended: atendidos,
    averageTicket: atendidos > 0 ? Math.round(r.period / atendidos) : null,
    defaultRate: defaultRate(ficou, venceu),
    topProcedures: top(porProc),
    topSpecialties: top(porEsp),
    months,
  };
}

// ─── Fluxo de caixa ──────────────────────────────────────────────────────────

export interface FlowRow {
  id: string;
  name: string;
  direction: 'IN' | 'OUT';
  values: number[];
  total: number;
}

export interface CashFlow {
  buckets: Bucket[];
  opening: number;
  realized: FlowRow[];
  forecast: FlowRow[];
  inTotals: number[];
  outTotals: number[];
  closing: number[];
}

export async function cashFlow(ctx: FinContext, from: Day, to: Day, opts: { accountId?: string | null; weekly?: boolean } = {}): Promise<CashFlow> {
  const { db } = ctx;
  const cols = buckets(from, to, granularityFor(from, to, opts.weekly));
  const conta = opts.accountId || null;
  // Todas as contas: transferência entre elas não é entrada nem saída da clínica.
  const tipos = conta ? undefined : { notIn: ['TRANSFER_IN' as const, 'TRANSFER_OUT' as const] };

  const [contas, antes, movs, titulos, categorias] = await Promise.all([
    db.financialAccount.findMany({ where: conta ? { id: conta } : {}, select: { id: true, openingBalance: true } }),
    db.financialTransaction.aggregate({ where: { paidOn: { lt: dayToDate(from) }, accountId: conta ?? { not: null } }, _sum: { signedAmount: true } }),
    db.financialTransaction.findMany({
      where: { paidOn: { gte: dayToDate(from), lt: fimDoDia(to) }, accountId: conta ?? { not: null }, kind: tipos },
      select: { kind: true, paidOn: true, signedAmount: true, categoryId: true, title: { select: { categoryId: true } } },
    }),
    db.financialTitle.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gte: dayToDate(from), lt: fimDoDia(to) }, ...(conta ? { accountId: conta } : {}) },
      select: { direction: true, dueDate: true, amount: true, paidAmount: true, categoryId: true },
    }),
    db.financialCategory.findMany({ select: { id: true, name: true, parent: { select: { name: true } } } }),
  ]);
  const nome = new Map(categorias.map((c) => [c.id, c.parent ? `${c.parent.name} › ${c.name}` : c.name]));
  const opening = contas.reduce((s, c) => s + toCents(c.openingBalance), 0) + toCents(antes._sum.signedAmount);

  const linhas = new Map<string, FlowRow>();
  const linha = (id: string, rotulo: string, direction: 'IN' | 'OUT', mapa: Map<string, FlowRow>) => {
    const k = `${direction}:${id}`;
    let l = mapa.get(k);
    if (!l) {
      l = { id, name: rotulo, direction, values: cols.map(() => 0), total: 0 };
      mapa.set(k, l);
    }
    return l;
  };
  for (const m of movs) {
    const i = bucketIndex(cols, dateToDay(m.paidOn));
    if (i < 0) continue;
    const v = toCents(m.signedAmount);
    if (v === 0) continue;
    const cat = m.categoryId ?? m.title?.categoryId ?? null;
    const rotulo = m.kind === 'TRANSFER_IN' || m.kind === 'TRANSFER_OUT' ? 'Transferências' : m.kind === 'REINFORCEMENT' ? 'Reforço de caixa' : m.kind === 'WITHDRAWAL' ? 'Sangria' : m.kind === 'REVERSAL' ? 'Estornos' : cat ? (nome.get(cat) ?? 'Sem categoria') : 'Sem categoria';
    const l = linha(m.kind === 'REVERSAL' ? 'estornos' : (cat ?? m.kind), rotulo, v > 0 ? 'IN' : 'OUT', linhas);
    l.values[i] += Math.abs(v);
    l.total += Math.abs(v);
  }
  const previstas = new Map<string, FlowRow>();
  for (const t of titulos) {
    const i = bucketIndex(cols, dateToDay(t.dueDate));
    if (i < 0) continue;
    const aberto = Math.max(0, toCents(t.amount) - toCents(t.paidAmount));
    const l = linha(t.categoryId, nome.get(t.categoryId) ?? 'Sem categoria', t.direction === 'RECEIVABLE' ? 'IN' : 'OUT', previstas);
    l.values[i] += aberto;
    l.total += aberto;
  }
  const ordena = (m: Map<string, FlowRow>) => [...m.values()].sort((a, b) => (a.direction === b.direction ? b.total - a.total : a.direction === 'IN' ? -1 : 1));
  const realized = ordena(linhas);
  const forecast = ordena(previstas);
  const inTotals = cols.map((_, i) => [...realized, ...forecast].filter((l) => l.direction === 'IN').reduce((s, l) => s + l.values[i], 0));
  const outTotals = cols.map((_, i) => [...realized, ...forecast].filter((l) => l.direction === 'OUT').reduce((s, l) => s + l.values[i], 0));
  const closing: number[] = [];
  let saldo = opening;
  for (let i = 0; i < cols.length; i++) {
    saldo += inTotals[i] - outTotals[i];
    closing.push(saldo);
  }
  return { buckets: cols, opening, realized, forecast, inTotals, outTotals, closing };
}

// ─── DRE ─────────────────────────────────────────────────────────────────────

interface DreSource {
  line: DreLine;
  kind: 'title' | 'movement';
  id: string;
  code: number;
  date: Day;
  competence: string;
  description: string;
  category: string;
  cents: number;
}

const SUB_DESCONTO = 'descontos_concedidos';
const SUB_JUROS = 'juros_recebidos';

/** As linhas da DRE de um intervalo de competências, com cada lançamento que entrou. */
async function dreSources(ctx: FinContext, comps: string[]): Promise<DreSource[]> {
  const { db, tenantId } = ctx;
  if (!comps.length) return [];
  const categorias = await db.financialCategory.findMany({ select: { id: true, name: true, dreLine: true } });
  const cat = new Map(categorias.map((c) => [c.id, c]));
  const linhaDe = (id: string | null | undefined): DreLine | null => {
    const c = id ? cat.get(id) : undefined;
    return c?.dreLine && isDreLine(c.dreLine) ? c.dreLine : null;
  };
  const fixo = (key: string) => cat.get(`fc_${tenantId}_${key}`);
  const out: DreSource[] = [];

  // Contas lançadas no mês (pagas ou não). As de renegociação ficam de fora: a receita é a das contas antigas.
  const titulos = await db.financialTitle.findMany({
    where: { competence: { in: comps }, status: { not: 'CANCELLED' }, origin: { not: 'RENEGOTIATION' } },
    select: { id: true, code: true, dueDate: true, competence: true, description: true, amount: true, categoryId: true, allocations: { select: { categoryId: true, amount: true } } },
  });
  for (const t of titulos) {
    const partes = t.allocations.length ? t.allocations.map((a) => ({ categoryId: a.categoryId, cents: toCents(a.amount) })) : [{ categoryId: t.categoryId, cents: toCents(t.amount) }];
    for (const p of partes) {
      const line = linhaDe(p.categoryId);
      if (!line) continue;
      out.push({ line, kind: 'title', id: t.id, code: t.code, date: dateToDay(t.dueDate), competence: t.competence, description: t.description ?? '', category: cat.get(p.categoryId)?.name ?? '', cents: p.cents });
    }
  }

  // Movimentos que não são conta: taxas de cartão, descontos dados e juros/multa recebidos.
  const movs = await db.financialTransaction.findMany({
    where: { competence: { in: comps }, reversedAt: null, OR: [{ kind: 'FEE' }, { kind: 'RECEIPT', titleId: { not: null }, OR: [{ discount: { gt: 0 } }, { interest: { gt: 0 } }, { fine: { gt: 0 } }, { surcharge: { gt: 0 } }] }] },
    select: { id: true, code: true, kind: true, paidOn: true, competence: true, description: true, amount: true, categoryId: true, discount: true, interest: true, fine: true, surcharge: true },
  });
  for (const m of movs) {
    const base = { kind: 'movement' as const, id: m.id, code: m.code, date: dateToDay(m.paidOn), competence: m.competence };
    if (m.kind === 'FEE') {
      const line = linhaDe(m.categoryId);
      if (line) out.push({ ...base, line, description: m.description ?? 'Taxa', category: cat.get(m.categoryId ?? '')?.name ?? '', cents: toCents(m.amount) });
      continue;
    }
    const desconto = toCents(m.discount);
    const extra = toCents(m.interest) + toCents(m.fine) + toCents(m.surcharge);
    const d = fixo(SUB_DESCONTO);
    const j = fixo(SUB_JUROS);
    if (desconto > 0) out.push({ ...base, line: (d?.dreLine && isDreLine(d.dreLine) ? d.dreLine : 'DEDUCOES_RECEITA'), description: `Desconto no recebimento nº ${m.code}`, category: d?.name ?? 'Descontos concedidos', cents: desconto });
    if (extra > 0) out.push({ ...base, line: (j?.dreLine && isDreLine(j.dreLine) ? j.dreLine : 'OUTRAS_RECEITAS'), description: `Juros, multa e acréscimo no recebimento nº ${m.code}`, category: j?.name ?? 'Juros recebidos', cents: extra });
  }
  return out;
}

export interface DreReport {
  from: Day;
  to: Day;
  previous: { from: Day; to: Day };
  rows: (DreRow & { previous: number; variation: number | null })[];
}

export async function dre(ctx: FinContext, from: Day, to: Day): Promise<DreReport> {
  const prev = previousRange(from, to);
  const [atual, antes] = await Promise.all([dreSources(ctx, competencesBetween(from, to)), dreSources(ctx, competencesBetween(prev.from, prev.to))]);
  const totais = (lista: DreSource[]) => {
    const t: Partial<Record<DreLine, number>> = {};
    for (const s of lista) t[s.line] = (t[s.line] ?? 0) + s.cents;
    return t;
  };
  const a = buildDre(totais(atual));
  const b = new Map(buildDre(totais(antes)).map((r) => [r.id, r.value]));
  return { from, to, previous: prev, rows: a.map((r) => ({ ...r, previous: b.get(r.id) ?? 0, variation: variation(r.value, b.get(r.id) ?? 0) })) };
}

/** Os lançamentos que compõem uma linha da DRE. */
export async function dreEntries(ctx: FinContext, from: Day, to: Day, line: DreLine): Promise<DreSource[]> {
  return (await dreSources(ctx, competencesBetween(from, to))).filter((s) => s.line === line).sort((x, y) => (x.competence === y.competence ? y.cents - x.cents : x.competence.localeCompare(y.competence)));
}

// ─── Inadimplência ───────────────────────────────────────────────────────────

export interface AgingRow {
  key: string;
  patientId: string | null;
  name: string;
  titles: number;
  overdueCents: number;
  buckets: Record<'1-30' | '31-60' | '61-90' | '90+', number>;
  maxDaysLate: number;
  oldestDue: Day;
  whatsapp: string | null;
}

export async function aging(ctx: FinContext, today: Day): Promise<{ rows: AgingRow[]; totals: AgingRow['buckets']; total: number }> {
  const { db, tenantId } = ctx;
  const vencidos = await db.financialTitle.findMany({
    where: { direction: 'RECEIVABLE', status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: dayToDate(today) } },
    select: { dueDate: true, amount: true, paidAmount: true, patientId: true, contactId: true, patient: { select: { name: true, phoneEncrypted: true, whatsappOptOut: true } }, contact: { select: { name: true } } },
  });
  const chave = process.env.ENCRYPTION_MASTER_KEY ?? '';
  const mapa = new Map<string, AgingRow>();
  const totals = { '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const t of vencidos) {
    const aberto = Math.max(0, toCents(t.amount) - toCents(t.paidAmount));
    if (!aberto) continue;
    const venc = dateToDay(t.dueDate);
    const dias = daysBetween(venc, today);
    const faixa = agingBucket(dias);
    if (!faixa) continue;
    const key = t.patientId ? `p:${t.patientId}` : `c:${t.contactId ?? 'sem'}`;
    let r = mapa.get(key);
    if (!r) {
      let whatsapp: string | null = null;
      if (t.patient && !t.patient.whatsappOptOut) {
        try {
          whatsapp = normalizeBrazilPhone(decrypt(t.patient.phoneEncrypted, chave, tenantId)) || null;
        } catch {
          whatsapp = null;
        }
      }
      r = { key, patientId: t.patientId, name: t.patient?.name ?? t.contact?.name ?? 'Sem cadastro', titles: 0, overdueCents: 0, buckets: { '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }, maxDaysLate: 0, oldestDue: venc, whatsapp };
      mapa.set(key, r);
    }
    r.titles += 1;
    r.overdueCents += aberto;
    r.buckets[faixa] += aberto;
    totals[faixa] += aberto;
    r.maxDaysLate = Math.max(r.maxDaysLate, dias);
    if (venc < r.oldestDue) r.oldestDue = venc;
  }
  const rows = [...mapa.values()].sort((a, b) => b.overdueCents - a.overdueCents);
  return { rows, totals, total: rows.reduce((s, r) => s + r.overdueCents, 0) };
}

// ─── Procedimentos e centros de custo ────────────────────────────────────────

export async function proceduresReport(ctx: FinContext, from: Day, to: Day) {
  const itens = await ctx.db.appointmentItem.findMany({
    where: { appointment: { status: 'ATTENDED', startTime: { gte: dayToDate(from), lt: fimDoDia(to) } } },
    select: { name: true, quantity: true, total: true, quoteItemId: true, appointment: { select: { type: true, billingStatus: true, professional: { select: { name: true } } } } },
  });
  const mapa = new Map<string, { name: string; quantity: number; totalCents: number; billedCents: number; coveredCents: number; courtesy: number }>();
  for (const i of itens) {
    const r = mapa.get(i.name) ?? { name: i.name, quantity: 0, totalCents: 0, billedCents: 0, coveredCents: 0, courtesy: 0 };
    r.quantity += i.quantity;
    const v = toCents(i.total);
    if (i.appointment.type === 'CORTESIA') r.courtesy += i.quantity;
    else {
      r.totalCents += v;
      if (i.quoteItemId) r.coveredCents += v;
      else if (i.appointment.billingStatus === 'BILLED' || i.appointment.billingStatus === 'PARTIAL' || i.appointment.billingStatus === 'PAID') r.billedCents += v;
    }
    mapa.set(i.name, r);
  }
  return [...mapa.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export async function costCenterReport(ctx: FinContext, from: Day, to: Day) {
  const { db } = ctx;
  const comps = competencesBetween(from, to);
  const [titulos, centros] = await Promise.all([
    db.financialTitle.findMany({ where: { competence: { in: comps }, status: { not: 'CANCELLED' }, origin: { not: 'RENEGOTIATION' } }, select: { direction: true, amount: true, costCenterId: true, allocations: { select: { costCenterId: true, amount: true } } } }),
    db.costCenter.findMany({ select: { id: true, name: true } }),
  ]);
  const nome = new Map(centros.map((c) => [c.id, c.name]));
  const mapa = new Map<string, { name: string; revenueCents: number; expenseCents: number }>();
  for (const t of titulos) {
    const partes = t.allocations.length ? t.allocations.map((a) => ({ cc: a.costCenterId, cents: toCents(a.amount) })) : [{ cc: t.costCenterId, cents: toCents(t.amount) }];
    for (const p of partes) {
      const k = p.cc ?? 'sem';
      const r = mapa.get(k) ?? { name: p.cc ? (nome.get(p.cc) ?? 'Centro removido') : 'Sem centro de custo', revenueCents: 0, expenseCents: 0 };
      if (t.direction === 'RECEIVABLE') r.revenueCents += p.cents;
      else r.expenseCents += p.cents;
      mapa.set(k, r);
    }
  }
  return [...mapa.values()].sort((a, b) => b.revenueCents - b.expenseCents - (a.revenueCents - a.expenseCents));
}

