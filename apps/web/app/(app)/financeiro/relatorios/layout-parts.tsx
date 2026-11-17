import Link from 'next/link';
import { FinNav } from '@/components/fin/fin-nav';
import type { finPage } from '@/fin/page';

/** Cabeçalho comum das páginas de relatório. */
export function ReportShell({ title, description, nav, children }: { title: string; description: string; nav: Awaited<ReturnType<typeof finPage>>['nav']; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 print:p-0">
      <header className="mb-4">
        <p className="text-xs font-medium text-muted-foreground print:hidden">
          <Link href="/financeiro/relatorios" className="hover:underline">
            Relatórios
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>
      <div className="print:hidden">
        <FinNav access={nav} />
      </div>
      {children}
    </div>
  );
}
