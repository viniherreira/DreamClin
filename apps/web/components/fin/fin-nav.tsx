'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * As telas do financeiro, em abas no topo de cada uma. O menu lateral leva às
 * principais; daqui se chega a todas.
 */

export interface FinNavAccess {
  /** Pode estornar: vê Estornos e Liberações. */
  reverse: boolean;
  /** Pedidos de liberação esperando resposta. */
  pendingReleases?: number;
  /** Opera o caixa: vê a aba Caixa. */
  cash?: boolean;
  /** Avisos do caixa (aberto há muito tempo, fechado com diferença). */
  cashAlerts?: number;
}

export function FinNav({ access }: { access: FinNavAccess }) {
  const pathname = usePathname();
  const itens: { href: string; label: string; badge?: number }[] = [
    { href: '/financeiro', label: 'Visão geral' },
    ...(access.cash ? [{ href: '/financeiro/caixa', label: 'Caixa', badge: access.cashAlerts }] : []),
    { href: '/financeiro/contas', label: 'Contas a receber e a pagar' },
    { href: '/financeiro/movimentacoes', label: 'Movimentações' },
    ...(access.reverse ? [{ href: '/financeiro/estornos', label: 'Estornos' }, { href: '/financeiro/liberacoes', label: 'Liberações', badge: access.pendingReleases }] : []),
  ];
  const ativo = itens.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Telas do financeiro" className="-mx-1 mb-5 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border px-1">
        {itens.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={ativo === i.href ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${
                ativo === i.href ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {i.label}
              {i.badge ? <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{i.badge}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
