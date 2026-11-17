import Link from 'next/link';
import { BarChart3, CalendarClock, FileText, Layers, Lock, Percent, Receipt, Stethoscope, Vault } from 'lucide-react';
import { finPage } from '@/fin/page';
import { ReportShell } from './layout-parts';

export const metadata = { title: 'Relatórios do financeiro' };

export default async function RelatoriosPage() {
  const { ctx, nav, advanced } = await finPage('fin_relatorios');
  const itens = [
    { href: '/financeiro/relatorios/fluxo-de-caixa', titulo: 'Fluxo de caixa', texto: 'O que entrou, saiu e vai vencer, por categoria, com saldo.', icone: CalendarClock, completo: true },
    { href: '/financeiro/relatorios/dre', titulo: 'DRE', texto: 'O resultado do mês por competência, comparado com o anterior.', icone: BarChart3, completo: true },
    { href: '/financeiro/relatorios/inadimplencia', titulo: 'Inadimplência', texto: 'Quem deve, há quanto tempo, com cobrança pelo WhatsApp.', icone: Receipt, completo: false },
    { href: '/financeiro/relatorios/procedimentos', titulo: 'Procedimentos realizados', texto: 'Quantidade e valor de cada procedimento atendido.', icone: Stethoscope, completo: false },
    { href: '/financeiro/relatorios/centros-de-custo', titulo: 'Centros de custo', texto: 'Receitas e despesas de cada centro.', icone: Layers, completo: true },
    { href: '/financeiro/contas', titulo: 'Financeiro geral', texto: 'Todas as contas com filtros por data, origem, cliente, conta e forma. Exporta em CSV.', icone: FileText, completo: false },
    { href: '/financeiro/caixa/fechados', titulo: 'Caixas', texto: 'Os caixas fechados no período, com a conferência e o relatório.', icone: Vault, completo: false },
    ...(ctx.can('fin_comissoes') ? [{ href: '/financeiro/comissoes', titulo: 'Comissões', texto: 'Comissões e repasses por profissional e situação.', icone: Percent, completo: false }] : []),
  ];
  return (
    <ReportShell title="Relatórios" description="Os números do financeiro, para conferir e exportar." nav={nav}>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {itens.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex h-full gap-3 rounded-xl border border-border bg-surface p-4 shadow-card hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring">
              <i.icone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                <span className="flex items-center gap-1.5 font-semibold">
                  {i.titulo}
                  {i.completo && !advanced && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Disponível no plano Profissional" />}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{i.texto}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </ReportShell>
  );
}
