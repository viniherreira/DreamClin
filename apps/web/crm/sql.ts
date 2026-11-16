import { Prisma } from '@clinicaiq/db';

/**
 * Um instante como parâmetro de SQL cru. As colunas de data são `timestamp`
 * gravadas em UTC; um `Date` solto vai como `timestamptz` e o banco converte a
 * coluna pelo fuso da sessão, o que desloca a comparação quando a sessão não
 * está em UTC. Assim a comparação é sempre UTC com UTC.
 */
export const sqlInstant = (d: Date): Prisma.Sql => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
