import Link from 'next/link';
import { FinNav } from '@/components/fin/fin-nav';
import { openCashOf } from '@/fin/cash';
import { cashAccounts, cashAlerts, cashView, openCashList, suggestedOpening } from '@/fin/cash-read';
import { finPage } from '@/fin/page';
import { getUnitContext } from '@/lib/units';
import { CashAlertsPanel, CashSessionPanel, CashTable, OpenCashForm } from './_components/cash-view';

export const metadata = { title: 'Caixa' };

export default async function CaixaPage() {
  const { ctx, nav } = await finPage('fin_caixa');
  const canManage = ctx.can('fin_caixas_outros');
  const meu = await openCashOf(ctx.db, ctx.tenantId, ctx.userId, ctx.unitId);
  const [view, alerts, contas, abertos, sugestao, unidades] = await Promise.all([
    meu ? cashView(ctx, meu.id) : null,
    cashAlerts(ctx),
    cashAccounts(ctx),
    canManage ? openCashList(ctx) : [],
    meu ? 0 : suggestedOpening(ctx),
    getUnitContext(ctx.tenantId, ctx.userId),
  ]);
  const deOutros = abertos.filter((c) => !c.mine);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Caixa</h1>
          <p className="mt-1 text-sm text-muted-foreground">Abra o caixa no começo do dia, receba, e feche conferindo os valores.</p>
        </div>
        <Link href="/financeiro/caixa/fechados" className="btn-outline btn-md">
          Caixas fechados
        </Link>
      </header>
      <FinNav access={nav} />
      <CashAlertsPanel alerts={alerts} canManage={canManage} />

      {view ? (
        <CashSessionPanel view={view} accounts={contas.all} canManage={canManage} />
      ) : (
        <section aria-labelledby="abrir-caixa" className="rounded-xl border border-border bg-surface p-5 shadow-card">
          <h2 id="abrir-caixa" className="text-base font-semibold">
            Seu caixa está fechado
          </h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            {ctx.settings.requireOpenCashForCash ? 'Para receber em dinheiro, o caixa precisa estar aberto.' : 'Com o caixa aberto, o que você receber entra na conferência do fim do dia.'}
          </p>
          <OpenCashForm suggestedCents={sugestao} cashAccounts={contas.cash} unitName={unidades.multi ? unidades.current.name : null} />
        </section>
      )}

      {canManage && deOutros.length > 0 && (
        <section aria-labelledby="caixas-abertos" className="mt-6">
          <h2 id="caixas-abertos" className="mb-2 text-base font-semibold">
            Caixas abertos de outras pessoas
          </h2>
          <CashTable rows={deOutros} caption="Caixas abertos de outras pessoas" />
        </section>
      )}
    </div>
  );
}
