import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';
import { getTenantClient } from '@clinicaiq/db';
import { requireCapability } from '@/lib/guard';
import { hasCapability } from '@/lib/access';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { REPORTS, reportDef } from '@/lib/agenda-reports';
import { DIMENSIONS, runReport } from '@/lib/agenda-reports-server';
import { readReportFilters } from './filters';

import { DateField } from '@/components/ui/date-field';
export const metadata = { title: 'Relatórios da agenda' };

const field = 'h-9 rounded-lg border border-border bg-background px-2 text-sm';
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Relatórios da agenda e dos pacientes (spec 2026-11-18, F8). Dono, admin e recepção. */
export default async function RelatoriosAgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { tenantId } = await requireCapability('agenda_config');
  if (!(await pacienteAgendaEnabled(tenantId))) notFound();
  const sp = await searchParams;
  const def = reportDef(sp.tipo);
  const filtros = readReportFilters(sp);
  const [tabela, profs, podeExportarPessoal] = await Promise.all([
    runReport(tenantId, def.key, filtros),
    getTenantClient(tenantId).professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    hasCapability(tenantId, 'pacientes_exportar'),
  ]);
  const podeExportar = !def.personal || podeExportarPessoal;
  const qs = new URLSearchParams({ tipo: def.key, de: filtros.from, ate: filtros.to, ...(filtros.professionalId ? { profissional: filtros.professionalId } : {}), ...(filtros.dim ? { por: filtros.dim } : {}), ...(filtros.days ? { dias: String(filtros.days) } : {}) });
  const pctCols = new Set(tabela.percentColumns ?? []);
  const fmt = (v: string | number | null, i: number) => (v === null ? '' : typeof v === 'number' ? `${num.format(v)}${pctCols.has(i) ? '%' : ''}` : v);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios da agenda</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Agenda e pacientes. Os de dinheiro ficam no Financeiro.</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Relatórios" className="space-y-3">
          {(['Agenda', 'Pacientes'] as const).map((g) => (
            <div key={g}>
              <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</h2>
              <ul className="mt-1 space-y-0.5">
                {REPORTS.filter((r) => r.group === g).map((r) => (
                  <li key={r.key}>
                    <Link
                      href={`/relatorios/agenda?${new URLSearchParams({ tipo: r.key, de: filtros.from, ate: filtros.to })}`}
                      aria-current={r.key === def.key ? 'page' : undefined}
                      className={`block rounded-lg px-2 py-1.5 text-sm ${r.key === def.key ? 'bg-surface-alt font-semibold text-foreground shadow-[inset_3px_0_0_hsl(var(--primary))]' : 'text-foreground hover:bg-surface-alt'}`}
                    >
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="px-2 text-xs text-muted-foreground">
            Aniversariantes: <Link href="/pacientes/aniversariantes" className="text-primary underline underline-offset-2">tela própria</Link>.
          </p>
        </nav>

        <section aria-labelledby="rel-titulo" className="min-w-0 space-y-3">
          <div>
            <h2 id="rel-titulo" className="text-lg font-semibold">
              {def.title}
            </h2>
            <p className="text-sm text-muted-foreground">{def.description}</p>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
            <input type="hidden" name="tipo" value={def.key} />
            {def.period && (
              <>
                <label className="text-xs">
                  <span className="block text-muted-foreground">De</span>
                  <DateField name="de" defaultValue={filtros.from} className={field} />
                </label>
                <label className="text-xs">
                  <span className="block text-muted-foreground">Até</span>
                  <DateField name="ate" defaultValue={filtros.to} className={field} />
                </label>
              </>
            )}
            {def.key !== 'cadastro' && def.key !== 'informacoes' && (
              <label className="text-xs">
                <span className="block text-muted-foreground">Profissional</span>
                <select name="profissional" defaultValue={filtros.professionalId ?? ''} className={field}>
                  <option value="">Todos</option>
                  {profs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {def.key === 'dimensao' && (
              <label className="text-xs">
                <span className="block text-muted-foreground">Agrupar por</span>
                <select name="por" defaultValue={filtros.dim ?? 'tipo'} className={field}>
                  {DIMENSIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {def.key === 'sem-agendar' && (
              <label className="text-xs">
                <span className="block text-muted-foreground">Sem vir há mais de (dias)</span>
                <input type="number" name="dias" min={1} max={3650} defaultValue={filtros.days ?? 180} className={`${field} w-28`} />
              </label>
            )}
            <button type="submit" className="btn-primary btn-md">
              Mostrar
            </button>
            {podeExportar ? (
              <span className="ml-auto flex gap-2">
                <a href={`/relatorios/agenda/exportar?${qs}&formato=xlsx`} className="btn-outline btn-md">
                  <Download className="h-4 w-4" aria-hidden="true" /> Excel
                </a>
                <a href={`/relatorios/agenda/exportar?${qs}&formato=csv`} className="btn-ghost btn-md">
                  CSV
                </a>
              </span>
            ) : (
              <span className="ml-auto text-xs text-muted-foreground">Seu perfil não exporta dados de pacientes.</span>
            )}
          </form>

          {tabela.rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">Nada nesse período.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
              <table className="w-full text-sm">
                <caption className="sr-only">{def.title}</caption>
                <thead className="bg-surface-alt/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {tabela.columns.map((c, i) => (
                      <th key={c} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium ${i > 0 && typeof tabela.rows[0]?.[i] === 'number' ? 'text-right' : ''}`}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tabela.rows.slice(0, 1000).map((r, ri) => (
                    <tr key={ri}>
                      {r.map((v, i) => (
                        <td key={i} className={`px-3 py-2 ${typeof v === 'number' ? 'text-right tabular-nums' : ''} ${i === 0 ? 'font-medium' : ''}`}>
                          {fmt(v, i)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {tabela.total && (
                  <tfoot className="border-t-2 border-border bg-surface-alt/40 font-semibold">
                    <tr>
                      {tabela.total.map((v, i) => (
                        <td key={i} className={`px-3 py-2 ${typeof v === 'number' ? 'text-right tabular-nums' : ''}`}>
                          {fmt(v, i)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
          {tabela.rows.length > 1000 && <p className="text-xs text-muted-foreground">A tela mostra as primeiras 1.000 linhas de {tabela.rows.length}. A exportação traz todas.</p>}
          {tabela.note && <p className="text-xs text-muted-foreground">{tabela.note}</p>}
        </section>
      </div>
    </div>
  );
}
