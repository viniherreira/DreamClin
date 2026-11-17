import 'server-only';

import { Prisma } from '@clinicaiq/db';

/**
 * Número de exibição sequencial por clínica (título, movimento, caixa,
 * renegociação). Roda dentro da transação de quem vai gravar: a trava
 * consultiva segura a fila daquele tipo naquela clínica até o commit, então
 * dois lançamentos juntos não pegam o mesmo número.
 */

type Tx = { $executeRaw: (query: Prisma.Sql) => Promise<unknown>; $queryRaw: <T>(query: Prisma.Sql) => Promise<T> };

const TABELA = {
  title: Prisma.sql`"financial_titles"`,
  transaction: Prisma.sql`"financial_transactions"`,
  cash: Prisma.sql`"cash_sessions"`,
  renegotiation: Prisma.sql`"renegotiations"`,
} as const;

export type CodeKind = keyof typeof TABELA;

/** O próximo número livre. Quem grava vários de uma vez soma a partir dele. */
export async function nextCode(tx: Tx, tenantId: string, kind: CodeKind): Promise<number> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fin-code:${kind}:${tenantId}`}))`);
  const rows = await tx.$queryRaw<{ max: number | null }[]>(Prisma.sql`SELECT max("code")::int AS max FROM ${TABELA[kind]} WHERE "tenantId" = ${tenantId}`);
  return (rows[0]?.max ?? 0) + 1;
}
