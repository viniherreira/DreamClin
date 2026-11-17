import Link from 'next/link';
import { FinNav } from '@/components/fin/fin-nav';
import { closedCashList, CLOSED_PAGE } from '@/fin/cash-read';
import { finPage } from '@/fin/page';
import { addDays, isDay, type Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { CashTable } from '../_components/cash-view';

export const metadata = { title: 'Caixas fechados' };

const campo = 'h-9 rounded-lg border border-border bg-surface px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export default async function CaixasFechadosPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; quem?: string; diferenca?: string; pagina?: string }> }) {
  const { ctx, nav } = await finPage('fin_caixa');
  const sp = await searchParams;
  const hoje = clinicToday() as Day;
  const to = sp.ate && isDay(sp.ate) ? (sp.ate as Day) : hoje;
  const from = sp.de && isDay(sp.de) && sp.de <= to ? (sp.de as Day) : addDays(to, -30);
  const page = Math.max(1, Number(sp.pagina) || 1);
  const onlyDifference = sp.diferenca === '1';
  const canManage = ctx.can('fin_caixas_outros');
  const { rows, total, users } = await closedCashList(ctx, { from, to, userId: sp.quem || undefined, onlyDifference, page });
  const paginas = Math.max(1, Math.ceil(total / CLOSED_PAGE));
  const link = (p: number) => `/financeiro/caixa/fechados?${new URLSearchParams({ de: from, ate: to, ...(sp.quem ? { quem: sp.quem } : {}), ...(onlyDifference ? { diferenca: '1' } : {}), pagina: String(p) })}`;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Caixas fechados</h1>
          <p className="mt-1 text-sm text-muted-foreground">{canManage ? 'Os fechamentos de todo mundo, com a conferência e o relatório de cada um.' : 'Os seus fechamentos, com a conferência e o relatório de cada um.'}</p>
        </div>
        <Link href="/financeiro/caixa" className="btn-outline btn-md">
          Meu caixa
        </Link>
      </header>
      <FinNav access={nav} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
        <div>
          <label htmlFor="cx-de" className="block text-sm font-medium">
            Fechado de
          </label>
          <input id="cx-de" name="de" type="date" defaultValue={from} className={`${campo} mt-1 w-40`} />
        </div>
        <div>
          <label htmlFor="cx-ate" className="block text-sm font-medium">
            Até
          </label>
          <input id="cx-ate" name="ate" type="date" defaultValue={to} className={`${campo} mt-1 w-40`} />
        </div>
        {canManage && users.length > 0 && (
          <div>
            <label htmlFor="cx-quem" className="block text-sm font-medium">
              De quem
            </label>
            <select id="cx-quem" name="quem" defaultValue={sp.quem ?? ''} className={`${campo} mt-1 w-48`}>
              <option value="">Todos</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <label className="inline-flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="diferenca" value="1" defaultChecked={onlyDifference} className="h-4 w-4" /> Só com diferença
        </label>
        <button type="submit" className="btn-primary btn-md">
          Filtrar
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhum caixa fechado neste período.</p>
      ) : (
        <CashTable rows={rows} caption="Caixas fechados" closed />
      )}

      {paginas > 1 && (
        <nav aria-label="Páginas" className="mt-4 flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Página {page} de {paginas} · {total} caixas
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={link(page - 1)} className="btn-outline btn-sm">
                Anterior
              </Link>
            )}
            {page < paginas && (
              <Link href={link(page + 1)} className="btn-outline btn-sm">
                Próxima
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
