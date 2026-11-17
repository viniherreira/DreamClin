import { FinNav } from '@/components/fin/fin-nav';
import { finPage } from '@/fin/page';
import { discountLimitPercent } from '@/lib/financeiro/access';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { financeOptions } from '../../configuracoes/finance-actions';
import { RenegotiationsView } from './_components/renegotiations-view';

export const metadata = { title: 'Renegociações' };

export default async function RenegociacoesPage({ searchParams }: { searchParams: Promise<{ paciente?: string }> }) {
  const { ctx, nav } = await finPage('fin_ver');
  const [options, { paciente }] = await Promise.all([financeOptions(), searchParams]);
  if (!options) return null;
  const inicial = paciente ? await ctx.db.patient.findFirst({ where: { id: paciente }, select: { id: true, name: true } }) : null;
  const s = ctx.settings;
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Renegociações</h1>
        <p className="mt-1 text-sm text-muted-foreground">Junte as contas em aberto de um paciente num acordo novo, com entrada e parcelas.</p>
      </header>
      <FinNav access={nav} />
      <RenegotiationsView
        options={options}
        today={clinicToday() as Day}
        canRenegotiate={ctx.can('fin_renegociar')}
        initialPatient={inicial}
        defaults={{
          interestPercent: s.renegotiationInterestPercent,
          mode: s.renegotiationInterestMode,
          lateChargesEnabled: s.lateChargesEnabled,
          manager: ctx.role === 'OWNER' || ctx.role === 'ADMIN',
          discountLimitPercent: discountLimitPercent({ role: ctx.role, permission: ctx.permission }, s.defaultMaxDiscountPercent),
        }}
      />
    </div>
  );
}
