'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { decrypt, encrypt, prisma, type Prisma } from '@clinicaiq/db';
import { finRead, finWrite, type FinContext } from '@/fin/guard';
import { ensureFinanceSetup } from '@/fin/setup';
import { cpfHash } from '@/lib/cpf-hash';
import { dateToDay, dayToDate, isDay } from '@/lib/financeiro/dates';
import { isMethodKind, METHOD_KINDS } from '@/lib/financeiro/defaults';
import { DRE_LINES, isDreLine } from '@/lib/financeiro/dre';
import { fromCents, toCents } from '@/lib/financeiro/money';
import { cleanFinanceSettings, readFinanceSettings, type FinanceSettings } from '@/lib/financeiro/settings';

/**
 * Configurações › Financeiro: contas, categorias, centros de custo, formas,
 * clientes e fornecedores, regras gerais e permissões por usuário.
 * Tudo exige `fin_config` (dono e administrador) e a bandeira do financeiro novo.
 */

export type Result<T = undefined> = ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; message: string };

const fail = (message: string) => ({ ok: false as const, message });

async function audit(ctx: FinContext, action: string, entity: string, entityId: string, metadata?: Prisma.InputJsonValue) {
  await ctx.db.auditLog.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, action, entity, entityId, metadata } });
}

const masterKey = () => process.env.ENCRYPTION_MASTER_KEY ?? '';

// ─── Contas ──────────────────────────────────────────────────────────────────

export interface AccountRow {
  id: string;
  name: string;
  kind: 'CASH' | 'BANK' | 'DIGITAL';
  bankName: string | null;
  agency: string | null;
  number: string | null;
  openingBalanceCents: number;
  openingDate: string;
  unitId: string | null;
  active: boolean;
  isDefault: boolean;
  balanceCents: number;
  inUse: boolean;
}

export async function listFinanceAccounts(): Promise<AccountRow[]> {
  const gate = await finRead('fin_config');
  if (!gate.ok) return [];
  const { db, tenantId } = gate.ctx;
  await ensureFinanceSetup(tenantId);
  const [contas, somas] = await Promise.all([
    db.financialAccount.findMany({ orderBy: [{ active: 'desc' }, { isDefault: 'desc' }, { name: 'asc' }] }),
    db.financialTransaction.groupBy({ by: ['accountId'], _sum: { signedAmount: true }, _count: true }),
  ]);
  const porConta = new Map(somas.map((s) => [s.accountId, s]));
  return contas.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    bankName: c.bankName,
    agency: c.agency,
    number: c.number,
    openingBalanceCents: toCents(c.openingBalance),
    openingDate: dateToDay(c.openingDate),
    unitId: c.unitId,
    active: c.active,
    isDefault: c.isDefault,
    balanceCents: toCents(c.openingBalance) + toCents(porConta.get(c.id)?._sum.signedAmount),
    inUse: (porConta.get(c.id)?._count ?? 0) > 0,
  }));
}

const accountSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Dê um nome à conta.').max(60),
  kind: z.enum(['CASH', 'BANK', 'DIGITAL']),
  bankName: z.string().trim().max(60).optional().nullable(),
  agency: z.string().trim().max(20).optional().nullable(),
  number: z.string().trim().max(30).optional().nullable(),
  openingBalanceCents: z.number().int().min(-99_999_999_99).max(99_999_999_99),
  openingDate: z.string().refine(isDay, 'Data inválida.'),
  unitId: z.string().optional().nullable(),
  active: z.boolean(),
  isDefault: z.boolean(),
});

export async function saveFinanceAccount(input: z.input<typeof accountSchema>): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const { db, tenantId } = gate.ctx;
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const d = parsed.data;
  if (d.isDefault && !d.active) return fail('A conta padrão precisa estar ativa.');
  if (d.unitId && !(await db.clinicUnit.findFirst({ where: { id: d.unitId }, select: { id: true } }))) return fail('Unidade não encontrada.');

  const dados = {
    name: d.name,
    kind: d.kind,
    bankName: d.bankName || null,
    agency: d.agency || null,
    number: d.number || null,
    openingBalance: fromCents(d.openingBalanceCents),
    openingDate: dayToDate(d.openingDate),
    unitId: d.unitId || null,
    active: d.active,
    isDefault: d.isDefault,
  };

  if (d.id) {
    const atual = await db.financialAccount.findFirst({ where: { id: d.id }, select: { id: true, isDefault: true } });
    if (!atual) return fail('Conta não encontrada.');
    if (atual.isDefault && !d.isDefault) return fail('Para trocar a conta padrão, marque outra conta como padrão.');
    if (!d.active) {
      const aberto = await db.cashSession.count({ where: { accountId: d.id, status: 'OPEN' } });
      if (aberto) return fail('Há um caixa aberto nesta conta. Feche o caixa antes de desativar.');
    }
    await db.$transaction(async (tx) => {
      if (d.isDefault) await tx.financialAccount.updateMany({ where: { isDefault: true, id: { not: d.id } }, data: { isDefault: false } });
      await tx.financialAccount.update({ where: { id: d.id }, data: dados });
    });
    await audit(gate.ctx, 'UPDATE', 'FinancialAccount', d.id);
  } else {
    const nova = await db.$transaction(async (tx) => {
      if (d.isDefault) await tx.financialAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.financialAccount.create({ data: { tenantId, ...dados } });
    });
    await audit(gate.ctx, 'CREATE', 'FinancialAccount', nova.id);
  }
  revalidatePath('/configuracoes');
  return { ok: true };
}

// ─── Categorias e centros de custo ───────────────────────────────────────────

export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  direction: 'RECEIVABLE' | 'PAYABLE';
  dreLine: string | null;
  comment: string | null;
  active: boolean;
  isSystem: boolean;
  inUse: boolean;
}

export async function listFinanceCategories(): Promise<CategoryRow[]> {
  const gate = await finRead('fin_config');
  if (!gate.ok) return [];
  const { db, tenantId } = gate.ctx;
  await ensureFinanceSetup(tenantId);
  const [cats, usoTitulos, usoRateio] = await Promise.all([
    db.financialCategory.findMany({ orderBy: [{ direction: 'desc' }, { order: 'asc' }, { name: 'asc' }] }),
    db.financialTitle.groupBy({ by: ['categoryId'], _count: true }),
    db.financialTitleAllocation.groupBy({ by: ['categoryId'], _count: true }),
  ]);
  const usados = new Set([...usoTitulos.map((u) => u.categoryId), ...usoRateio.map((u) => u.categoryId)]);
  return cats.map((c) => ({
    id: c.id,
    parentId: c.parentId,
    name: c.name,
    direction: c.direction,
    dreLine: c.dreLine,
    comment: c.comment,
    active: c.active,
    isSystem: c.isSystem,
    inUse: usados.has(c.id),
  }));
}

const categorySchema = z.object({
  id: z.string().optional(),
  parentId: z.string().optional().nullable(),
  name: z.string().trim().min(1, 'Dê um nome à categoria.').max(60),
  direction: z.enum(['RECEIVABLE', 'PAYABLE']),
  dreLine: z.string().optional().nullable(),
  comment: z.string().trim().max(200).optional().nullable(),
  active: z.boolean(),
});

export async function saveFinanceCategory(input: z.input<typeof categorySchema>): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const { db, tenantId } = gate.ctx;
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const d = parsed.data;

  let direction = d.direction;
  if (d.parentId) {
    const pai = await db.financialCategory.findFirst({ where: { id: d.parentId }, select: { parentId: true, direction: true } });
    if (!pai) return fail('Categoria principal não encontrada.');
    if (pai.parentId) return fail('O plano de contas tem só dois níveis: categoria e subcategoria.');
    direction = pai.direction;
    if (!isDreLine(d.dreLine)) return fail('Escolha a linha da DRE desta subcategoria.');
  }
  const repetida = await db.financialCategory.findFirst({
    where: { parentId: d.parentId ?? null, name: { equals: d.name, mode: 'insensitive' }, ...(d.id ? { id: { not: d.id } } : {}) },
    select: { id: true },
  });
  if (repetida) return fail('Já existe uma categoria com este nome neste nível.');

  const dados = { name: d.name, comment: d.comment || null, active: d.active, dreLine: d.parentId && isDreLine(d.dreLine) ? d.dreLine : null };
  if (d.id) {
    const atual = await db.financialCategory.findFirst({ where: { id: d.id }, select: { id: true, parentId: true } });
    if (!atual) return fail('Categoria não encontrada.');
    await db.financialCategory.update({ where: { id: d.id }, data: dados });
    // Desativar a categoria principal desativa as subcategorias junto.
    if (!d.active && !atual.parentId) await db.financialCategory.updateMany({ where: { parentId: d.id }, data: { active: false } });
    await audit(gate.ctx, 'UPDATE', 'FinancialCategory', d.id);
  } else {
    const ordem = await db.financialCategory.count({ where: { parentId: d.parentId ?? null } });
    const nova = await db.financialCategory.create({ data: { tenantId, parentId: d.parentId || null, direction, order: ordem, ...dados } });
    await audit(gate.ctx, 'CREATE', 'FinancialCategory', nova.id);
  }
  revalidatePath('/configuracoes');
  return { ok: true };
}

/** Só apaga categoria criada pela clínica e sem uso. O resto se desativa. */
export async function deleteFinanceCategory(id: string): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const { db } = gate.ctx;
  const cat = await db.financialCategory.findFirst({ where: { id }, select: { id: true, isSystem: true } });
  if (!cat) return fail('Categoria não encontrada.');
  if (cat.isSystem) return fail('Esta categoria é usada pelo sistema. Dá para renomear ou desativar, mas não apagar.');
  const [filhas, titulos, rateios, formas] = await Promise.all([
    db.financialCategory.count({ where: { parentId: id } }),
    db.financialTitle.count({ where: { categoryId: id } }),
    db.financialTitleAllocation.count({ where: { categoryId: id } }),
    db.finPaymentMethod.count({ where: { feeCategoryId: id } }),
  ]);
  if (filhas) return fail('Apague ou mova as subcategorias primeiro.');
  if (titulos || rateios || formas) return fail('Esta categoria já foi usada. Desative em vez de apagar.');
  await db.financialCategory.delete({ where: { id } });
  await audit(gate.ctx, 'DELETE', 'FinancialCategory', id);
  revalidatePath('/configuracoes');
  return { ok: true };
}

export interface CostCenterRow {
  id: string;
  parentId: string | null;
  name: string;
  active: boolean;
  inUse: boolean;
}

export async function listCostCenters(): Promise<CostCenterRow[]> {
  const gate = await finRead('fin_config');
  if (!gate.ok) return [];
  const { db } = gate.ctx;
  const [centros, usoT, usoR] = await Promise.all([
    db.costCenter.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    db.financialTitle.groupBy({ by: ['costCenterId'], _count: true, where: { costCenterId: { not: null } } }),
    db.financialTitleAllocation.groupBy({ by: ['costCenterId'], _count: true, where: { costCenterId: { not: null } } }),
  ]);
  const usados = new Set([...usoT.map((u) => u.costCenterId), ...usoR.map((u) => u.costCenterId)]);
  return centros.map((c) => ({ id: c.id, parentId: c.parentId, name: c.name, active: c.active, inUse: usados.has(c.id) }));
}

const costCenterSchema = z.object({
  id: z.string().optional(),
  parentId: z.string().optional().nullable(),
  name: z.string().trim().min(1, 'Dê um nome ao centro de custo.').max(60),
  active: z.boolean(),
});

export async function saveCostCenter(input: z.input<typeof costCenterSchema>): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const { db, tenantId } = gate.ctx;
  const parsed = costCenterSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const d = parsed.data;
  if (d.parentId) {
    const pai = await db.costCenter.findFirst({ where: { id: d.parentId }, select: { parentId: true } });
    if (!pai) return fail('Centro de custo principal não encontrado.');
    if (pai.parentId) return fail('Os centros de custo têm só dois níveis.');
  }
  if (d.id) {
    const atual = await db.costCenter.findFirst({ where: { id: d.id }, select: { id: true } });
    if (!atual) return fail('Centro de custo não encontrado.');
    await db.costCenter.update({ where: { id: d.id }, data: { name: d.name, active: d.active } });
  } else {
    const ordem = await db.costCenter.count({ where: { parentId: d.parentId ?? null } });
    await db.costCenter.create({ data: { tenantId, parentId: d.parentId || null, name: d.name, active: d.active, order: ordem } });
  }
  revalidatePath('/configuracoes');
  return { ok: true };
}

export async function deleteCostCenter(id: string): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const { db } = gate.ctx;
  const [filhos, titulos, rateios] = await Promise.all([
    db.costCenter.count({ where: { parentId: id } }),
    db.financialTitle.count({ where: { costCenterId: id } }),
    db.financialTitleAllocation.count({ where: { costCenterId: id } }),
  ]);
  if (filhos) return fail('Apague os centros de custo de dentro primeiro.');
  if (titulos || rateios) return fail('Este centro de custo já foi usado. Desative em vez de apagar.');
  await db.costCenter.deleteMany({ where: { id } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

// ─── Formas de recebimento e pagamento ───────────────────────────────────────

export interface MethodFeeRow {
  upToInstallments: number;
  /** Em %, com até 3 casas. */
  percent: number | null;
  fixedCents: number | null;
}

export interface MethodRow {
  id: string;
  name: string;
  kind: (typeof METHOD_KINDS)[number];
  active: boolean;
  usage: 'RECEIVE' | 'PAY' | 'BOTH';
  accountId: string | null;
  requireDocNumber: boolean;
  settlementType: 'SAME_DAY' | 'DAYS' | 'DAY_OF_MONTH';
  settlementValue: number | null;
  operatorContactId: string | null;
  maxInstallments: number;
  feeCategoryId: string | null;
  feeCostCenterId: string | null;
  isSystem: boolean;
  fees: MethodFeeRow[];
}

export async function listFinanceMethods(): Promise<MethodRow[]> {
  const gate = await finRead('fin_config');
  if (!gate.ok) return [];
  const { db, tenantId } = gate.ctx;
  await ensureFinanceSetup(tenantId);
  const formas = await db.finPaymentMethod.findMany({ orderBy: [{ active: 'desc' }, { order: 'asc' }, { name: 'asc' }], include: { fees: { orderBy: { upToInstallments: 'asc' } } } });
  return formas.map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    active: m.active,
    usage: m.usage === 'RECEIVE' || m.usage === 'PAY' ? m.usage : 'BOTH',
    accountId: m.accountId,
    requireDocNumber: m.requireDocNumber,
    settlementType: m.settlementType === 'DAYS' || m.settlementType === 'DAY_OF_MONTH' ? m.settlementType : 'SAME_DAY',
    settlementValue: m.settlementValue,
    operatorContactId: m.operatorContactId,
    maxInstallments: m.maxInstallments,
    feeCategoryId: m.feeCategoryId,
    feeCostCenterId: m.feeCostCenterId,
    isSystem: m.isSystem,
    fees: m.fees.map((f) => ({ upToInstallments: f.upToInstallments, percent: f.percent == null ? null : Number(f.percent), fixedCents: f.fixed == null ? null : toCents(f.fixed) })),
  }));
}

const methodSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Dê um nome à forma.').max(40),
  kind: z.string().refine(isMethodKind, 'Tipo inválido.'),
  active: z.boolean(),
  usage: z.enum(['RECEIVE', 'PAY', 'BOTH']),
  accountId: z.string().optional().nullable(),
  requireDocNumber: z.boolean(),
  settlementType: z.enum(['SAME_DAY', 'DAYS', 'DAY_OF_MONTH']),
  settlementValue: z.number().int().min(1).max(365).optional().nullable(),
  operatorContactId: z.string().optional().nullable(),
  maxInstallments: z.number().int().min(1).max(24),
  feeCategoryId: z.string().optional().nullable(),
  feeCostCenterId: z.string().optional().nullable(),
  fees: z
    .array(
      z.object({
        upToInstallments: z.number().int().min(1).max(24),
        percent: z.number().min(0).max(100).optional().nullable(),
        fixedCents: z.number().int().min(0).max(1_000_000).optional().nullable(),
      }),
    )
    .max(24),
});

export async function saveFinanceMethod(input: z.input<typeof methodSchema>): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const { db, tenantId } = gate.ctx;
  const parsed = methodSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const d = parsed.data;
  const kind = d.kind as (typeof METHOD_KINDS)[number];
  const cartao = kind === 'CREDIT_CARD' || kind === 'DEBIT_CARD';

  if (d.settlementType !== 'SAME_DAY' && !d.settlementValue) return fail('Informe em quantos dias (ou em que dia do mês) o dinheiro cai na conta.');
  if (d.settlementType === 'DAY_OF_MONTH' && (d.settlementValue ?? 0) > 31) return fail('O dia do mês vai de 1 a 31.');
  if (kind !== 'WALLET' && d.accountId && !(await db.financialAccount.findFirst({ where: { id: d.accountId }, select: { id: true } }))) return fail('Conta não encontrada.');
  if (d.operatorContactId && !(await db.finContact.findFirst({ where: { id: d.operatorContactId }, select: { id: true } }))) return fail('Operadora não encontrada.');
  if (d.feeCategoryId && !(await db.financialCategory.findFirst({ where: { id: d.feeCategoryId }, select: { id: true } }))) return fail('Categoria da taxa não encontrada.');
  if (d.feeCostCenterId && !(await db.costCenter.findFirst({ where: { id: d.feeCostCenterId }, select: { id: true } }))) return fail('Centro de custo da taxa não encontrado.');

  const faixas = cartao ? d.fees.filter((f) => (f.percent ?? 0) > 0 || (f.fixedCents ?? 0) > 0) : [];
  if (new Set(faixas.map((f) => f.upToInstallments)).size !== faixas.length) return fail('Há duas faixas de taxa para o mesmo número de parcelas.');
  if (faixas.some((f) => f.upToInstallments > d.maxInstallments)) return fail('Uma faixa de taxa passa do máximo de parcelas da forma.');

  const repetida = await db.finPaymentMethod.findFirst({ where: { name: { equals: d.name, mode: 'insensitive' }, ...(d.id ? { id: { not: d.id } } : {}) }, select: { id: true } });
  if (repetida) return fail('Já existe uma forma com este nome.');

  const dados = {
    name: d.name,
    active: d.active,
    usage: d.usage,
    accountId: kind === 'WALLET' ? null : d.accountId || null,
    requireDocNumber: d.requireDocNumber,
    settlementType: d.settlementType,
    settlementValue: d.settlementType === 'SAME_DAY' ? null : (d.settlementValue ?? null),
    operatorContactId: cartao ? d.operatorContactId || null : null,
    maxInstallments: kind === 'CREDIT_CARD' ? d.maxInstallments : 1,
    feeCategoryId: cartao ? d.feeCategoryId || null : null,
    feeCostCenterId: cartao ? d.feeCostCenterId || null : null,
  };

  const id = await db.$transaction(async (tx) => {
    let alvo = d.id;
    if (alvo) {
      const atual = await tx.finPaymentMethod.findFirst({ where: { id: alvo }, select: { id: true, kind: true, isSystem: true } });
      if (!atual) throw new Error('nao-achou');
      // O tipo de uma forma do sistema não muda: é por ele que o caixa e a carteira a reconhecem.
      await tx.finPaymentMethod.update({ where: { id: alvo }, data: atual.isSystem ? dados : { ...dados, kind } });
      await tx.finPaymentMethodFee.deleteMany({ where: { methodId: alvo } });
    } else {
      const ordem = await tx.finPaymentMethod.count();
      alvo = (await tx.finPaymentMethod.create({ data: { tenantId, kind, order: ordem, ...dados } })).id;
    }
    if (faixas.length) {
      await tx.finPaymentMethodFee.createMany({
        data: faixas.map((f) => ({ tenantId, methodId: alvo!, upToInstallments: f.upToInstallments, percent: f.percent ? f.percent : null, fixed: f.fixedCents ? fromCents(f.fixedCents) : null })),
      });
    }
    return alvo;
  }).catch((e: unknown) => (e instanceof Error && e.message === 'nao-achou' ? null : Promise.reject(e)));
  if (!id) return fail('Forma não encontrada.');
  await audit(gate.ctx, d.id ? 'UPDATE' : 'CREATE', 'FinPaymentMethod', id);
  revalidatePath('/configuracoes');
  return { ok: true };
}

// ─── Clientes e fornecedores ─────────────────────────────────────────────────

export interface ContactRow {
  id: string;
  name: string;
  personType: 'PF' | 'PJ';
  document: string;
  phone: string | null;
  email: string | null;
  zipCode: string | null;
  street: string | null;
  addressNumber: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  kind: 'SUPPLIER' | 'INSURANCE' | 'CARD_OPERATOR' | 'THIRD_PARTY' | 'OTHER';
  notes: string | null;
  active: boolean;
}

export async function listFinanceContacts(query = ''): Promise<ContactRow[]> {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return [];
  const { db, tenantId } = gate.ctx;
  const q = query.trim();
  const contatos = await db.finContact.findMany({
    where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    take: 300,
  });
  return contatos.map((c) => {
    let document = '';
    if (c.documentEncrypted) {
      try {
        document = decrypt(c.documentEncrypted, masterKey(), tenantId);
      } catch {
        document = '';
      }
    }
    return {
      id: c.id,
      name: c.name,
      personType: c.personType === 'PF' ? 'PF' : 'PJ',
      document,
      phone: c.phone,
      email: c.email,
      zipCode: c.zipCode,
      street: c.street,
      addressNumber: c.addressNumber,
      complement: c.complement,
      neighborhood: c.neighborhood,
      city: c.city,
      state: c.state,
      kind: c.kind,
      notes: c.notes,
      active: c.active,
    };
  });
}

const opt = (max: number) => z.string().trim().max(max).optional().nullable();

const contactSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, 'Informe o nome.').max(120),
  personType: z.enum(['PF', 'PJ']),
  document: opt(20),
  phone: opt(30),
  email: z.string().trim().email('E-mail inválido.').max(120).optional().nullable().or(z.literal('')),
  zipCode: opt(10),
  street: opt(120),
  addressNumber: opt(20),
  complement: opt(60),
  neighborhood: opt(60),
  city: opt(60),
  state: opt(2),
  kind: z.enum(['SUPPLIER', 'INSURANCE', 'CARD_OPERATOR', 'THIRD_PARTY', 'OTHER']),
  notes: opt(500),
  active: z.boolean(),
});

/** Cadastro (também o "cadastro rápido" do novo título). Quem lança conta pode cadastrar o fornecedor. */
export async function saveFinanceContact(input: z.input<typeof contactSchema>): Promise<Result<{ id: string; name: string }>> {
  const gate = await finWrite('fin_pagar');
  if (!gate.ok) return gate;
  const { db, tenantId, settings } = gate.ctx;
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const d = parsed.data;
  const digitos = (d.document ?? '').replace(/\D/g, '');
  if (digitos && digitos.length !== 11 && digitos.length !== 14) return fail('O CPF tem 11 números e o CNPJ tem 14.');
  if (!digitos && settings.requireSupplierDocument && d.kind === 'SUPPLIER') return fail('Esta clínica exige CPF ou CNPJ no cadastro de fornecedor.');

  const hash = digitos ? cpfHash(digitos, tenantId) : null;
  if (hash) {
    const repetido = await db.finContact.findFirst({ where: { documentHash: hash, ...(d.id ? { id: { not: d.id } } : {}) }, select: { name: true } });
    if (repetido) return fail(`Este documento já está cadastrado em "${repetido.name}".`);
  }

  const dados = {
    name: d.name,
    personType: d.personType,
    documentEncrypted: digitos ? encrypt(digitos, masterKey(), tenantId) : null,
    documentHash: hash,
    phone: d.phone || null,
    email: d.email || null,
    zipCode: d.zipCode || null,
    street: d.street || null,
    addressNumber: d.addressNumber || null,
    complement: d.complement || null,
    neighborhood: d.neighborhood || null,
    city: d.city || null,
    state: d.state ? d.state.toUpperCase() : null,
    kind: d.kind,
    notes: d.notes || null,
    active: d.active,
  };
  let id = d.id;
  if (id) {
    const atual = await db.finContact.findFirst({ where: { id }, select: { id: true } });
    if (!atual) return fail('Cadastro não encontrado.');
    await db.finContact.update({ where: { id }, data: dados });
  } else {
    id = (await db.finContact.create({ data: { tenantId, createdById: gate.ctx.userId, ...dados } })).id;
  }
  await audit(gate.ctx, d.id ? 'UPDATE' : 'CREATE', 'FinContact', id);
  revalidatePath('/configuracoes');
  return { ok: true, data: { id, name: d.name } };
}

// ─── Regras gerais ───────────────────────────────────────────────────────────

export async function getFinanceRules(): Promise<FinanceSettings | null> {
  const gate = await finRead('fin_config');
  return gate.ok ? gate.ctx.settings : null;
}

export async function saveFinanceRules(input: Partial<FinanceSettings>): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const { tenantId } = gate.ctx;
  // `Tenant` não passa pelo filtro de clínica: o id vem da sessão, nunca do formulário.
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const atual = (tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {}) as Record<string, unknown>;
  const novo = cleanFinanceSettings({ ...readFinanceSettings(atual), ...input });
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: { ...atual, finance: novo } as unknown as Prisma.InputJsonValue } });
  await audit(gate.ctx, 'UPDATE', 'FinanceSettings', tenantId);
  revalidatePath('/configuracoes');
  return { ok: true };
}

// ─── Permissões financeiras por usuário ──────────────────────────────────────

export interface FinPermissionRow {
  userId: string;
  name: string;
  role: string;
  maxDiscountPercent: number | null;
  operation: 'RECEIVE' | 'PAY' | 'BOTH';
  accountIds: string[];
  canReverse: boolean | null;
  canSeeReports: boolean | null;
}

export async function listFinancePermissions(): Promise<FinPermissionRow[]> {
  const gate = await finRead('fin_config');
  if (!gate.ok) return [];
  const { db } = gate.ctx;
  const [usuarios, perms] = await Promise.all([
    db.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
    db.financialPermission.findMany(),
  ]);
  const porUsuario = new Map(perms.map((p) => [p.userId, p]));
  return usuarios.map((u) => {
    const p = porUsuario.get(u.id);
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      maxDiscountPercent: p?.maxDiscountPercent == null ? null : Number(p.maxDiscountPercent),
      operation: p?.operation === 'RECEIVE' || p?.operation === 'PAY' ? p.operation : 'BOTH',
      accountIds: p?.accountIds ?? [],
      canReverse: p?.canReverse ?? null,
      canSeeReports: p?.canSeeReports ?? null,
    };
  });
}

const permissionSchema = z.object({
  userId: z.string().min(1),
  maxDiscountPercent: z.number().min(0).max(100).nullable(),
  operation: z.enum(['RECEIVE', 'PAY', 'BOTH']),
  accountIds: z.array(z.string()).max(50),
  canReverse: z.boolean().nullable(),
  canSeeReports: z.boolean().nullable(),
});

export async function saveFinancePermission(input: z.input<typeof permissionSchema>): Promise<Result> {
  const gate = await finWrite('fin_config');
  if (!gate.ok) return gate;
  const { db, tenantId } = gate.ctx;
  const parsed = permissionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Confira os campos.');
  const d = parsed.data;
  const usuario = await db.user.findFirst({ where: { id: d.userId, active: true }, select: { id: true, role: true } });
  if (!usuario) return fail('Pessoa não encontrada.');
  if (usuario.role === 'OWNER' || usuario.role === 'ADMIN') return fail('Dono e administrador já têm acesso total ao financeiro.');
  const contas = d.accountIds.length ? await db.financialAccount.findMany({ where: { id: { in: d.accountIds } }, select: { id: true } }) : [];
  const dados = {
    maxDiscountPercent: d.maxDiscountPercent,
    operation: d.operation,
    accountIds: contas.map((c) => c.id),
    canReverse: d.canReverse,
    canSeeReports: d.canSeeReports,
  };
  const atual = await db.financialPermission.findFirst({ where: { userId: d.userId }, select: { id: true } });
  if (atual) await db.financialPermission.update({ where: { id: atual.id }, data: dados });
  else await db.financialPermission.create({ data: { tenantId, userId: d.userId, ...dados } });
  await audit(gate.ctx, 'UPDATE', 'FinancialPermission', d.userId, dados);
  revalidatePath('/configuracoes');
  return { ok: true };
}

/** O que os formulários do financeiro precisam para montar as listas de escolha. */
export async function financeOptions() {
  const gate = await finRead('fin_ver');
  if (!gate.ok) return null;
  const { db, tenantId } = gate.ctx;
  await ensureFinanceSetup(tenantId);
  const [accounts, categories, costCenters, methods, contacts, units] = await Promise.all([
    db.financialAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true, kind: true, isDefault: true } }),
    db.financialCategory.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, parentId: true, name: true, direction: true } }),
    db.costCenter.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, parentId: true, name: true } }),
    db.finPaymentMethod.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true, kind: true, usage: true, accountId: true, maxInstallments: true, requireDocNumber: true } }),
    db.finContact.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, kind: true }, take: 500 }),
    db.clinicUnit.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
  ]);
  return { accounts, categories, costCenters, methods, contacts, units, dreLines: DRE_LINES };
}
