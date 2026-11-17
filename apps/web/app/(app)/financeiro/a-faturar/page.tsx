import { FinNav } from '@/components/fin/fin-nav';
import { finPage } from '@/fin/page';
import type { Day } from '@/lib/financeiro/dates';
import { clinicToday } from '@/lib/tz';
import { ToBillView } from './_components/to-bill-view';

export const metadata = { title: 'A faturar' };

export default async function AFaturarPage() {
  const { ctx, nav } = await finPage('fin_ver');
  const [profissionais, unidades] = await Promise.all([
    ctx.db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ctx.db.clinicUnit.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
  ]);
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">A faturar</h1>
        <p className="mt-1 text-sm text-muted-foreground">Atendimentos com valor que ainda não foram recebidos nem viraram conta a receber.</p>
      </header>
      <FinNav access={nav} />
      <ToBillView today={clinicToday() as Day} options={{ professionals: profissionais, units: unidades }} canReceive={ctx.can('fin_receber')} />
    </div>
  );
}
