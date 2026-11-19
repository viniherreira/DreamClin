'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarPlus, ChevronLeft, ChevronRight, Download, Eye, Filter, Pencil, Search, X } from 'lucide-react';
import { PatientAvatar } from './patient-avatar';
import { PatientStatusBadge } from './patient-status-badge';
import { activeFilterCount, filtersToQuery, type PatientFilters } from '@/lib/patient-filters';
import { priorityLabel, SEX_OPTIONS } from '@/lib/patient-fields';
import { ageFromBirth, wallDateBR } from '@/lib/tz';

interface Row {
  id: string;
  controlNumber: number;
  name: string;
  socialName: string | null;
  phone: string;
  email: string | null;
  birthDate: Date | null;
  active: boolean;
  priority: boolean;
  priorityType: string | null;
}

interface Options {
  professionals: { id: string; name: string }[];
  origins: { id: string; name: string }[];
  units: { id: string; name: string }[];
  insurers: string[];
  canExport: boolean;
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

const sel = 'h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

export function PatientListFull({
  rows,
  total,
  pages,
  page,
  filters,
  options,
  recent,
}: {
  rows: Row[];
  total: number;
  pages: number;
  page: number;
  filters: PatientFilters;
  options: Options;
  recent: { id: string; name: string; active: boolean }[];
}) {
  const router = useRouter();
  const [f, setF] = useState(filters);
  const [aberto, setAberto] = useState(activeFilterCount(filters) > 0);
  const n = activeFilterCount(filters);
  const go = (next: Partial<PatientFilters>, p = 1) => {
    const qs = filtersToQuery({ ...next });
    router.push(`/pacientes?${qs}${p > 1 ? `${qs ? '&' : ''}page=${p}` : ''}`);
  };
  const set = (k: keyof PatientFilters, v: string | boolean) => setF({ ...f, [k]: v });

  return (
    <div className="space-y-4">
      <form
        role="search"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go(f);
        }}
      >
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="busca-pacientes" className="sr-only">
            Buscar paciente
          </label>
          <input
            id="busca-pacientes"
            type="search"
            value={f.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder="Nome, CPF, telefone ou nº de controle"
            className="h-10 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          />
        </div>
        <button type="submit" className="btn-primary btn-md">
          Buscar
        </button>
        <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} aria-controls="filtros-pacientes" className="btn-outline btn-md">
          <Filter className="h-4 w-4" aria-hidden="true" /> Filtros{n > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{n}</span>}
        </button>
        {options.canExport && (
          <a href={`/pacientes/exportar?${filtersToQuery(filters)}`} className="btn-outline btn-md">
            <Download className="h-4 w-4" aria-hidden="true" /> Exportar CSV
          </a>
        )}
      </form>

      {aberto && (
        <div id="filtros-pacientes" className="rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="f-situacao" className="text-xs font-medium text-muted-foreground">
                Situação
              </label>
              <select id="f-situacao" value={f.situacao} onChange={(e) => set('situacao', e.target.value)} className={sel}>
                <option value="ativos">Ativos</option>
                <option value="inativos">Inativos</option>
                <option value="todos">Todos</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-sexo" className="text-xs font-medium text-muted-foreground">
                Sexo
              </label>
              <select id="f-sexo" value={f.sexo} onChange={(e) => set('sexo', e.target.value)} className={sel}>
                <option value="">Todos</option>
                {SEX_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-nasc-de" className="text-xs font-medium text-muted-foreground">
                Nascido de
              </label>
              <input id="f-nasc-de" type="date" value={f.nascDe} onChange={(e) => set('nascDe', e.target.value)} className={sel} />
            </div>
            <div>
              <label htmlFor="f-nasc-ate" className="text-xs font-medium text-muted-foreground">
                até
              </label>
              <input id="f-nasc-ate" type="date" value={f.nascAte} onChange={(e) => set('nascAte', e.target.value)} className={sel} />
            </div>
            <div>
              <label htmlFor="f-cidade" className="text-xs font-medium text-muted-foreground">
                Cidade
              </label>
              <input id="f-cidade" value={f.cidade} onChange={(e) => set('cidade', e.target.value)} className={sel} />
            </div>
            <div>
              <label htmlFor="f-email" className="text-xs font-medium text-muted-foreground">
                E-mail
              </label>
              <input id="f-email" value={f.email} onChange={(e) => set('email', e.target.value)} className={sel} />
            </div>
            <div>
              <label htmlFor="f-convenio" className="text-xs font-medium text-muted-foreground">
                Convênio
              </label>
              <input id="f-convenio" list="f-convenios" value={f.convenio} onChange={(e) => set('convenio', e.target.value)} className={sel} />
              <datalist id="f-convenios">
                {options.insurers.map((i) => (
                  <option key={i} value={i} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="f-prof" className="text-xs font-medium text-muted-foreground">
                Atendido por
              </label>
              <select id="f-prof" value={f.atendidoPor} onChange={(e) => set('atendidoPor', e.target.value)} className={sel}>
                <option value="">Qualquer profissional</option>
                {options.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-origem" className="text-xs font-medium text-muted-foreground">
                Origem
              </label>
              <select id="f-origem" value={f.origem} onChange={(e) => set('origem', e.target.value)} className={sel}>
                <option value="">Todas</option>
                {options.origins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-futuro" className="text-xs font-medium text-muted-foreground">
                Agendamento futuro
              </label>
              <select id="f-futuro" value={f.futuro} onChange={(e) => set('futuro', e.target.value)} className={sel}>
                <option value="">Tanto faz</option>
                <option value="com">Com agendamento</option>
                <option value="sem">Sem agendamento</option>
              </select>
            </div>
            {options.units.length > 0 && (
              <div>
                <label htmlFor="f-unidade" className="text-xs font-medium text-muted-foreground">
                  Unidade
                </label>
                <select id="f-unidade" value={f.unidade} onChange={(e) => set('unidade', e.target.value)} className={sel}>
                  <option value="">Todas</option>
                  {options.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={f.prioritario} onChange={(e) => set('prioritario', e.target.checked)} className="h-4 w-4 accent-primary" />
              Só prioritários
            </label>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => go({ q: f.q })} className="btn-ghost btn-sm">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Limpar filtros
            </button>
            <button type="button" onClick={() => go(f)} className="btn-primary btn-sm">
              Aplicar
            </button>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <section aria-label="Adicionados recentemente">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Adicionados recentemente</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recent.map((p) => (
              <Link
                key={p.id}
                href={`/pacientes/${p.id}`}
                className="flex shrink-0 items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <PatientAvatar name={p.name} size="sm" />
                <div className="min-w-0">
                  <p className="max-w-[120px] truncate text-xs font-medium">{p.name}</p>
                  <PatientStatusBadge active={p.active} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {total} paciente{total === 1 ? '' : 's'}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">Nenhum paciente com esses filtros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Pacientes</caption>
              <thead className="bg-surface-alt/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Paciente</th>
                  <th scope="col" className="px-4 py-2 font-medium">Idade e nascimento</th>
                  <th scope="col" className="px-4 py-2 font-medium">Telefone</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">E-mail</th>
                  <th scope="col" className="px-4 py-2 font-medium">Situação</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((p) => {
                  const nome = p.socialName || p.name;
                  const idade = ageFromBirth(p.birthDate);
                  return (
                    <tr key={p.id} className="hover:bg-surface-alt/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/pacientes/${p.id}`} className="flex items-center gap-3 rounded focus-visible:outline-2 focus-visible:outline-ring">
                          <PatientAvatar name={nome} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{nome}</span>
                            <span className="block text-xs text-muted-foreground">
                              nº {p.controlNumber}
                              {p.priority && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{priorityLabel(p.priorityType)}</span>}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {p.birthDate ? (
                          <>
                            {idade !== null && <span className="font-medium">{idade} anos</span>}
                            <span className="block text-xs text-muted-foreground">{wallDateBR(p.birthDate)}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Não informado</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{p.phone ? formatPhone(p.phone) : '—'}</td>
                      <td className="hidden max-w-[220px] truncate px-4 py-2.5 lg:table-cell">{p.email ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <PatientStatusBadge active={p.active} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Link href={`/pacientes/${p.id}`} className="btn-ghost btn-sm" aria-label={`Ver perfil de ${nome}`}>
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </Link>
                          <Link href={`/pacientes/${p.id}/editar`} className="btn-ghost btn-sm" aria-label={`Editar ${nome}`}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Link>
                          <Link href={`/agenda?novo=1&paciente=${p.id}`} className="btn-ghost btn-sm" aria-label={`Agendar ${nome}`}>
                            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav aria-label="Páginas" className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => go(filters, page - 1)} className="btn-ghost btn-sm">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Anterior
            </button>
            <span className="text-muted-foreground">
              Página {page} de {pages}
            </span>
            <button type="button" disabled={page >= pages} onClick={() => go(filters, page + 1)} className="btn-ghost btn-sm">
              Próxima <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
