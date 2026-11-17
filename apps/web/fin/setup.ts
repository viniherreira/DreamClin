import 'server-only';

import { cache } from 'react';
import { getTenantClient, prisma } from '@clinicaiq/db';
import { clinicToday } from '@/lib/tz';
import { cleanReceiptMethods } from '@/lib/payment-methods';
import { dayToDate } from '@/lib/financeiro/dates';
import { DEFAULT_ACCOUNT_NAME, DEFAULT_CATEGORIES, DEFAULT_METHODS, guessMethodKind, type MethodKind } from '@/lib/financeiro/defaults';

/**
 * O que a clínica precisa para o financeiro funcionar: o caixa interno, o
 * plano de contas e as formas de recebimento. Nasce na primeira vez que a
 * clínica abre o financeiro novo, como a "unidade principal".
 *
 * Pode rodar quantas vezes for e em duas telas ao mesmo tempo: os ids são
 * fixos por clínica e a gravação ignora o que já existe. Nunca apaga nem muda
 * o que a clínica já editou.
 */

export const defaultAccountId = (tenantId: string) => `fa_${tenantId}`;
export const categoryId = (tenantId: string, key: string) => `fc_${tenantId}_${key}`;
export const methodId = (tenantId: string, kind: MethodKind) => `fm_${tenantId}_${kind.toLowerCase()}`;

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);

export async function setupFinance(tenantId: string): Promise<void> {
  const db = getTenantClient(tenantId);
  const contaId = defaultAccountId(tenantId);

  await db.financialAccount.createMany({
    data: [{ id: contaId, tenantId, name: DEFAULT_ACCOUNT_NAME, kind: 'CASH', openingBalance: 0, openingDate: dayToDate(clinicToday()), isDefault: true }],
    skipDuplicates: true,
  });

  // Pais primeiro (a subcategoria aponta para o pai).
  await db.financialCategory.createMany({
    data: DEFAULT_CATEGORIES.map((c, i) => ({ id: categoryId(tenantId, c.key), tenantId, name: c.name, direction: c.direction, isSystem: true, systemKey: c.key, order: i })),
    skipDuplicates: true,
  });
  await db.financialCategory.createMany({
    data: DEFAULT_CATEGORIES.flatMap((c) =>
      c.children.map(
        (s, i) => ({ id: categoryId(tenantId, s.key), tenantId, parentId: categoryId(tenantId, c.key), name: s.name, direction: c.direction, dreLine: s.dreLine, isSystem: true, systemKey: s.key, order: i }),
      ),
    ),
    skipDuplicates: true,
  });

  await db.finPaymentMethod.createMany({
    data: DEFAULT_METHODS.map(
      (m, i) =>
        ({
          id: methodId(tenantId, m.kind),
          tenantId,
          name: m.name,
          kind: m.kind,
          usage: m.usage,
          accountId: m.kind === 'WALLET' ? null : contaId,
          settlementType: m.settlementType,
          settlementValue: m.settlementValue ?? null,
          maxInstallments: m.maxInstallments ?? 1,
          isSystem: true,
          order: i,
        }),
    ),
    skipDuplicates: true,
  });

  // As formas que a clínica já tinha cadastrado em texto (Configurações › Financeiro antigo).
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const antigas = cleanReceiptMethods((tenant?.settings as Record<string, unknown> | null)?.paymentMethods);
  const padrao = new Set(DEFAULT_METHODS.map((m) => slug(m.name)));
  // "Outro" (singular) da lista antiga é o "Outros" de agora.
  padrao.add('outro');
  const extras = antigas.filter((nome) => !padrao.has(slug(nome)));
  if (extras.length) {
    await db.finPaymentMethod.createMany({
      data: extras.map((nome, i) => {
        const kind = guessMethodKind(nome);
        return { id: `fm_${tenantId}_x_${slug(nome)}`, tenantId, name: nome, kind, usage: 'BOTH', accountId: kind === 'WALLET' ? null : contaId, order: DEFAULT_METHODS.length + i };
      }),
      skipDuplicates: true,
    });
  }
}

/**
 * Garante o preparo da clínica, uma vez por requisição. A checagem barata vem
 * primeiro: clínica já preparada paga uma consulta só.
 */
export const ensureFinanceSetup = cache(async (tenantId: string): Promise<void> => {
  const db = getTenantClient(tenantId);
  const [conta, formas, categorias] = await Promise.all([
    db.financialAccount.count({ where: { id: defaultAccountId(tenantId) } }),
    db.finPaymentMethod.count({ where: { isSystem: true } }),
    db.financialCategory.count({ where: { isSystem: true } }),
  ]);
  const esperadas = DEFAULT_CATEGORIES.reduce((s, c) => s + 1 + c.children.length, 0);
  if (conta && formas >= DEFAULT_METHODS.length && categorias >= esperadas) return;
  await setupFinance(tenantId);
});
