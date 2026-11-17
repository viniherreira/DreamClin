import { FinNav } from '@/components/fin/fin-nav';
import { finPage } from '@/fin/page';
import { ReleasesView } from './_components/releases-view';

export const metadata = { title: 'Liberações' };

export default async function LiberacoesPage() {
  const { ctx, nav } = await finPage('fin_estornar');
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Liberações</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pedidos da equipe para passar do próprio limite. Cada liberação vale uma vez e por 30 minutos.</p>
      </header>
      <FinNav access={nav} />
      <ReleasesView canDecide={ctx.role === 'OWNER' || ctx.role === 'ADMIN'} />
    </div>
  );
}
