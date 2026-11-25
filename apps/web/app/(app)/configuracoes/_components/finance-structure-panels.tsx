'use client';

import { useState, useTransition } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, ErrorText, Field, inputCls, MoneyInput, Panel, PlanLock, useLoader } from '@/components/fin/ui';
import { ACCOUNT_KIND_LABEL } from '@/lib/financeiro/defaults';
import { DRE_LINE_LABEL, DRE_LINES, type DreLine } from '@/lib/financeiro/dre';
import { formatCents } from '@/lib/financeiro/money';
import { clinicToday } from '@/lib/tz';
import {
  deleteCostCenter,
  deleteFinanceCategory,
  listCostCenters,
  listFinanceAccounts,
  listFinanceCategories,
  saveCostCenter,
  saveFinanceAccount,
  saveFinanceCategory,
  type AccountRow,
  type CategoryRow,
  type CostCenterRow,
} from '../finance-actions';

import { DateField } from '@/components/ui/date-field';
const iconBtn = 'rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

// ─── Contas ──────────────────────────────────────────────────────────────────

type AccountForm = Omit<AccountRow, 'balanceCents' | 'inUse' | 'id'> & { id?: string };

const novaConta = (): AccountForm => ({ name: '', kind: 'BANK', bankName: '', agency: '', number: '', openingBalanceCents: 0, openingDate: clinicToday(), unitId: null, active: true, isDefault: false });

export function FinanceAccountsPanel({ units }: { units: { id: string; name: string }[] }) {
  const { data: contas, loaded, reload } = useLoader(listFinanceAccounts, [] as AccountRow[]);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const salvar = () =>
    start(async () => {
      if (!form) return;
      setErro('');
      const r = await saveFinanceAccount(form);
      if (!r.ok) return setErro(r.message);
      setForm(null);
      await reload();
    });

  return (
    <Panel
      title="Contas"
      description="Onde o dinheiro da clínica está: o caixa da recepção, as contas de banco e as contas digitais."
      action={
        !form && (
          <button type="button" onClick={() => setForm(novaConta())} className="btn-primary btn-sm inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Nova conta
          </button>
        )
      }
    >
      {form && (
        <form
          className="mb-4 grid gap-3 rounded-lg border border-border bg-surface-alt/50 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <Field label="Nome">{(id) => <input id={id} autoFocus maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />}</Field>
          <Field label="Tipo">
            {(id) => (
              <select id={id} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AccountForm['kind'] })} className={inputCls}>
                {Object.entries(ACCOUNT_KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {form.kind !== 'CASH' && (
            <>
              <Field label="Banco">{(id) => <input id={id} maxLength={60} value={form.bankName ?? ''} onChange={(e) => setForm({ ...form, bankName: e.target.value })} className={inputCls} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Agência">{(id) => <input id={id} maxLength={20} value={form.agency ?? ''} onChange={(e) => setForm({ ...form, agency: e.target.value })} className={inputCls} />}</Field>
                <Field label="Número">{(id) => <input id={id} maxLength={30} value={form.number ?? ''} onChange={(e) => setForm({ ...form, number: e.target.value })} className={inputCls} />}</Field>
              </div>
            </>
          )}
          <Field label="Saldo inicial" hint="Quanto havia nesta conta no dia abaixo.">
            {(id) => <MoneyInput id={id} allowNegative value={form.openingBalanceCents} onChange={(c) => setForm({ ...form, openingBalanceCents: c })} />}
          </Field>
          <Field label="Data do saldo inicial">{(id) => <DateField id={id} value={form.openingDate} onChange={(v) => setForm({ ...form, openingDate: v })} className={inputCls} />}</Field>
          {units.length > 1 && (
            <Field label="Unidade" hint="Deixe em branco para a clínica toda.">
              {(id) => (
                <select id={id} value={form.unitId ?? ''} onChange={(e) => setForm({ ...form, unitId: e.target.value || null })} className={inputCls}>
                  <option value="">Todas as unidades</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4" /> Ativa
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} className="h-4 w-4" /> Conta padrão
            </label>
          </div>
          <div className="sm:col-span-2">
            <ErrorText>{erro}</ErrorText>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={pending} className="btn-primary btn-sm">
              {pending ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" onClick={() => (setForm(null), setErro(''))} className="btn-ghost btn-sm">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {!loaded ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {contas.map((c) => (
            <li key={c.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 ${c.active ? '' : 'opacity-60'}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {c.name} {c.isDefault && <Badge tone="blue">Padrão</Badge>} {!c.active && <Badge>Desativada</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ACCOUNT_KIND_LABEL[c.kind]}
                  {c.bankName ? ` · ${c.bankName}` : ''}
                </p>
              </div>
              <p className={`text-sm font-semibold tabular-nums ${c.balanceCents < 0 ? 'text-destructive' : ''}`}>{formatCents(c.balanceCents)}</p>
              <button
                type="button"
                className={iconBtn}
                aria-label={`Editar ${c.name}`}
                onClick={() => setForm({ id: c.id, name: c.name, kind: c.kind, bankName: c.bankName, agency: c.agency, number: c.number, openingBalanceCents: c.openingBalanceCents, openingDate: c.openingDate, unitId: c.unitId, active: c.active, isDefault: c.isDefault })}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─── Categorias ──────────────────────────────────────────────────────────────

interface CategoryForm {
  id?: string;
  parentId: string | null;
  name: string;
  direction: 'RECEIVABLE' | 'PAYABLE';
  dreLine: DreLine | '';
  comment: string;
  active: boolean;
}

export function FinanceCategoriesPanel() {
  const { data: cats, loaded, reload } = useLoader(listFinanceCategories, [] as CategoryRow[]);
  const [aba, setAba] = useState<'RECEIVABLE' | 'PAYABLE'>('RECEIVABLE');
  const [form, setForm] = useState<CategoryForm | null>(null);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const pais = cats.filter((c) => !c.parentId && c.direction === aba);
  const filhas = (id: string) => cats.filter((c) => c.parentId === id);

  const salvar = () =>
    start(async () => {
      if (!form) return;
      setErro('');
      const r = await saveFinanceCategory({ ...form, dreLine: form.dreLine || null });
      if (!r.ok) return setErro(r.message);
      setForm(null);
      await reload();
    });

  const apagar = (c: CategoryRow) => {
    if (!confirm(`Apagar a categoria "${c.name}"?`)) return;
    start(async () => {
      const r = await deleteFinanceCategory(c.id);
      if (!r.ok) return setErro(r.message);
      setErro('');
      await reload();
    });
  };

  const editar = (c: CategoryRow) => setForm({ id: c.id, parentId: c.parentId, name: c.name, direction: c.direction, dreLine: (c.dreLine as DreLine | null) ?? '', comment: c.comment ?? '', active: c.active });

  const linha = (c: CategoryRow, sub: boolean) => (
    <li key={c.id} className={`flex items-center gap-2 px-3 py-2 ${sub ? 'pl-8' : 'bg-surface-alt/40'} ${c.active ? '' : 'opacity-60'}`}>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${sub ? '' : 'font-semibold'}`}>
          {c.name} {!c.active && <Badge>Desativada</Badge>}
        </p>
        {sub && c.dreLine && <p className="text-xs text-muted-foreground">DRE: {DRE_LINE_LABEL[c.dreLine as DreLine]}</p>}
      </div>
      {!sub && (
        <button type="button" className="btn-ghost btn-sm inline-flex items-center gap-1" onClick={() => setForm({ parentId: c.id, name: '', direction: c.direction, dreLine: '', comment: '', active: true })}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Subcategoria
        </button>
      )}
      <button type="button" className={iconBtn} aria-label={`Editar ${c.name}`} onClick={() => editar(c)}>
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
      {!c.isSystem && !c.inUse && (
        <button type="button" className={iconBtn} aria-label={`Apagar ${c.name}`} onClick={() => apagar(c)}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </li>
  );

  return (
    <Panel
      title="Categorias"
      description="O plano de contas em dois níveis. Cada subcategoria cai numa linha da DRE. Categoria que já foi usada não se apaga, só se desativa."
      action={
        !form && (
          <button type="button" onClick={() => setForm({ parentId: null, name: '', direction: aba, dreLine: '', comment: '', active: true })} className="btn-primary btn-sm inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Nova categoria
          </button>
        )
      }
    >
      <div role="tablist" aria-label="Tipo de categoria" className="mb-3 inline-flex rounded-lg bg-surface-alt p-1">
        {(['RECEIVABLE', 'PAYABLE'] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={aba === d}
            onClick={() => (setAba(d), setForm(null))}
            className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${aba === d ? 'bg-surface shadow-sm' : 'text-muted-foreground'}`}
          >
            {d === 'RECEIVABLE' ? 'A receber' : 'A pagar'}
          </button>
        ))}
      </div>

      {form && (
        <form
          className="mb-4 grid gap-3 rounded-lg border border-border bg-surface-alt/50 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <p className="text-sm font-medium sm:col-span-2">
            {form.id ? 'Editar' : 'Nova'} {form.parentId ? `subcategoria de "${cats.find((c) => c.id === form.parentId)?.name ?? ''}"` : 'categoria principal'}
          </p>
          <Field label="Nome">{(id) => <input id={id} autoFocus maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />}</Field>
          {form.parentId && (
            <Field label="Linha da DRE">
              {(id) => (
                <select id={id} value={form.dreLine} onChange={(e) => setForm({ ...form, dreLine: e.target.value as DreLine })} className={inputCls}>
                  <option value="">Escolha…</option>
                  {DRE_LINES.map((l) => (
                    <option key={l} value={l}>
                      {DRE_LINE_LABEL[l]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Comentário (opcional)" className="sm:col-span-2">
            {(id) => <input id={id} maxLength={200} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} className={inputCls} />}
          </Field>
          <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4" /> Ativa
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={pending} className="btn-primary btn-sm">
              {pending ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" onClick={() => (setForm(null), setErro(''))} className="btn-ghost btn-sm">
              Cancelar
            </button>
          </div>
        </form>
      )}
      <ErrorText>{erro}</ErrorText>

      {!loaded ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">{pais.flatMap((p) => [linha(p, false), ...filhas(p.id).map((f) => linha(f, true))])}</ul>
      )}
    </Panel>
  );
}

// ─── Centros de custo ────────────────────────────────────────────────────────

export function CostCentersPanel({ advanced }: { advanced: boolean }) {
  const { data: centros, loaded, reload } = useLoader(listCostCenters, [] as CostCenterRow[]);
  const [form, setForm] = useState<{ id?: string; parentId: string | null; name: string; active: boolean } | null>(null);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const salvar = () =>
    start(async () => {
      if (!form) return;
      setErro('');
      const r = await saveCostCenter(form);
      if (!r.ok) return setErro(r.message);
      setForm(null);
      await reload();
    });

  const apagar = (c: CostCenterRow) => {
    if (!confirm(`Apagar o centro de custo "${c.name}"?`)) return;
    start(async () => {
      const r = await deleteCostCenter(c.id);
      if (!r.ok) return setErro(r.message);
      setErro('');
      await reload();
    });
  };

  const pais = centros.filter((c) => !c.parentId);

  return (
    <Panel
      title="Centros de custo"
      description="Uma segunda forma de classificar os lançamentos, opcional: por unidade, especialidade, marketing… Também em dois níveis."
      action={
        advanced &&
        !form && (
          <button type="button" onClick={() => setForm({ parentId: null, name: '', active: true })} className="btn-primary btn-sm inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Novo centro de custo
          </button>
        )
      }
    >
      {!advanced ? (
        <PlanLock what="Centros de custo e rateio" />
      ) : (
        <>
          {form && (
            <form
              className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-alt/50 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                salvar();
              }}
            >
              <Field label={form.parentId ? `Dentro de "${centros.find((c) => c.id === form.parentId)?.name ?? ''}"` : 'Nome'} className="min-w-[14rem] flex-1">
                {(id) => <input id={id} autoFocus maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />}
              </Field>
              <label className="inline-flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4" /> Ativo
              </label>
              <button type="submit" disabled={pending} className="btn-primary btn-sm">
                {pending ? 'Salvando…' : 'Salvar'}
              </button>
              <button type="button" onClick={() => (setForm(null), setErro(''))} className="btn-ghost btn-sm">
                Cancelar
              </button>
            </form>
          )}
          <ErrorText>{erro}</ErrorText>
          {!loaded ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : centros.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum centro de custo ainda. Crie o primeiro para separar os lançamentos por área.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {pais.flatMap((p) =>
                [p, ...centros.filter((c) => c.parentId === p.id)].map((c) => (
                  <li key={c.id} className={`flex items-center gap-2 px-3 py-2 ${c.parentId ? 'pl-8' : 'bg-surface-alt/40'} ${c.active ? '' : 'opacity-60'}`}>
                    <p className={`min-w-0 flex-1 truncate text-sm ${c.parentId ? '' : 'font-semibold'}`}>
                      {c.name} {!c.active && <Badge>Desativado</Badge>}
                    </p>
                    {!c.parentId && (
                      <button type="button" className="btn-ghost btn-sm inline-flex items-center gap-1" onClick={() => setForm({ parentId: c.id, name: '', active: true })}>
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Dentro deste
                      </button>
                    )}
                    <button type="button" className={iconBtn} aria-label={`Editar ${c.name}`} onClick={() => setForm({ id: c.id, parentId: c.parentId, name: c.name, active: c.active })}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {!c.inUse && (
                      <button type="button" className={iconBtn} aria-label={`Apagar ${c.name}`} onClick={() => apagar(c)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                )),
              )}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
