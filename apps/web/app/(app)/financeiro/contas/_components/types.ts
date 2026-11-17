import type { financeOptions } from '@/app/(app)/configuracoes/finance-actions';

/** As listas de escolha dos formulários do financeiro (contas, categorias, formas…). */
export type FinOptions = NonNullable<Awaited<ReturnType<typeof financeOptions>>>;
