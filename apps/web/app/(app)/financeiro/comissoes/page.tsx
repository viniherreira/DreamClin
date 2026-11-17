import { FinNav } from '@/components/fin/fin-nav';
import { finPage } from '@/fin/page';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { CommissionsView } from './_components/commissions-view';

export const metadata = { title: 'Comissões' };

export default async function ComissoesPage() {
  // A gestão confere e fatura; o profissional (com a liberação da clínica) vê só as dele.
  const { ctx, nav } = await finPage('fin_comissoes_proprias');
  const manage = ctx.can('fin_comissoes');
  const [profissionais, formas] = await Promise.all([
    manage ? ctx.db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }) : [],
    manage ? ctx.db.finPaymentMethod.findMany({ where: { active: true, kind: { not: 'WALLET' }, usage: { in: ['PAY', 'BOTH'] } }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }) : [],
  ]);
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{manage ? 'Comissões e repasses' : 'Minhas comissões'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{manage ? 'Confira, ajuste, aprove e fature o que cada profissional e parceiro tem a receber.' : 'O que você tem a receber pelos seus atendimentos.'}</p>
      </header>
      {ctx.can('fin_ver') && <FinNav access={nav} />}
      <CommissionsView today={clinicToday() as Day} professionals={profissionais} methods={formas} manage={manage} />
    </div>
  );
}
