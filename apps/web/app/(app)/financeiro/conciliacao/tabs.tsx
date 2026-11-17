'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Bancos ou cartões e cheques. */
export function ConciliacaoTabs() {
  const p = usePathname();
  const itens = [
    { href: '/financeiro/conciliacao/bancos', label: 'Bancos' },
    { href: '/financeiro/conciliacao/cartoes', label: 'Cartões e cheques' },
  ];
  return (
    <nav aria-label="Tipo de conciliação" className="mb-4 inline-flex rounded-lg bg-surface-alt p-1">
      {itens.map((i) => (
        <Link key={i.href} href={i.href} aria-current={p === i.href ? 'page' : undefined} className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${p === i.href ? 'bg-surface shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
