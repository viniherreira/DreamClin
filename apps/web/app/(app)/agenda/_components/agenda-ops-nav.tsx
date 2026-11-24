import Link from 'next/link';

const ITENS = [
  { href: '/agenda', label: 'Agenda' },
  { href: '/agenda/confirmacoes', label: 'Confirmações' },
  { href: '/agenda/lista-de-espera', label: 'Lista de espera' },
  { href: '/agenda/horarios-livres', label: 'Horários livres' },
  { href: '/agenda/meu-dia', label: 'Meu dia' },
  { href: '/agenda/alteracoes', label: 'Alterações em massa' },
];

/** As abas das telas de operação da agenda (agenda nova). */
export function AgendaOpsNav({ current }: { current: string }) {
  return (
    <nav aria-label="Telas da agenda" className="flex gap-1 overflow-x-auto border-b border-border">
      {ITENS.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.href === current ? 'page' : undefined}
          className={`relative shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${i.href === current ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {i.label}
          {i.href === current && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden="true" />}
        </Link>
      ))}
    </nav>
  );
}
