'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ErrorText, Field, inputCls, MoneyInput, Panel, PercentInput, Toggle } from '@/components/fin/ui';
import { financeOptions } from '../finance-actions';
import {
  commissionConfig,
  deleteCommissionException,
  saveCommissionException,
  saveCommissionRules,
  saveProcedureCost,
  saveTransferType,
  type CommissionConfig,
} from '@/app/(app)/financeiro/comissoes/actions';
import { formatCents } from '@/lib/financeiro/money';

/**
 * Configurações › Financeiro › Comissões: a regra da clínica, as exceções por
 * profissional, os tipos de repasse e o custo de material dos procedimentos.
 */

type Opts = NonNullable<Awaited<ReturnType<typeof financeOptions>>>;

export function FinanceCommissionPanel() {
  const [cfg, setCfg] = useState<CommissionConfig | null>(null);
  const [opts, setOpts] = useState<Opts | null>(null);
  const carregar = useCallback(async () => {
    const [c, o] = await Promise.all([commissionConfig(), financeOptions()]);
    setCfg(c);
    setOpts(o);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!cfg || !opts)
    return (
      <Panel title="Comissões e repasses">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </Panel>
    );

  return (
    <div className="space-y-5">
      <Regras cfg={cfg} opts={opts} />
      <Excecoes cfg={cfg} onChanged={carregar} />
      <Repasses cfg={cfg} onChanged={carregar} />
      <Custos cfg={cfg} />
    </div>
  );
}

function ModoValor({ label, value, onChange }: { label: string; value: { mode: 'PERCENT' | 'FIXED'; value: number }; onChange: (v: { mode: 'PERCENT' | 'FIXED'; value: number }) => void }) {
  return (
    <div>
      <span className="block text-sm font-medium">{label}</span>
      <div className="mt-1 flex gap-2">
        <select aria-label={`${label}: tipo`} value={value.mode} onChange={(e) => onChange({ mode: e.target.value as 'PERCENT' | 'FIXED', value: 0 })} className={`${inputCls} max-w-[9rem]`}>
          <option value="PERCENT">%</option>
          <option value="FIXED">R$ por item</option>
        </select>
        {value.mode === 'PERCENT' ? (
          <PercentInput ariaLabel={`${label}: porcentagem`} value={value.value} onChange={(v) => onChange({ ...value, value: v ?? 0 })} />
        ) : (
          <MoneyInput ariaLabel={`${label}: valor`} value={Math.round(value.value * 100)} onChange={(c) => onChange({ ...value, value: c / 100 })} />
        )}
      </div>
    </div>
  );
}

function Regras({ cfg, opts }: { cfg: CommissionConfig; opts: Opts }) {
  const [r, setR] = useState(cfg.rules);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, start] = useTransition();
  const muda = (p: Partial<typeof r>) => {
    setR({ ...r, ...p });
    setAviso(null);
  };
  const salvar = () =>
    start(async () => {
      const x = await saveCommissionRules(r);
      setAviso(x.ok ? { ok: true, texto: 'Regras salvas.' } : { ok: false, texto: x.message });
    });
  const despesas = opts.categories.filter((c) => c.direction === 'PAYABLE' && c.parentId);
  return (
    <Panel title="Regra da clínica" description="Vale para quem não tem exceção nem porcentagem no cadastro do profissional. A porcentagem que já estava no cadastro de cada profissional continua valendo.">
      <div className="space-y-4">
        <Toggle label="Comissões ligadas" checked={r.commissionEnabled} onChange={(v) => muda({ commissionEnabled: v })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <ModoValor label="Particular" value={r.commissionParticular} onChange={(v) => muda({ commissionParticular: v })} />
          <ModoValor label="Convênio" value={r.commissionConvenio} onChange={(v) => muda({ commissionConvenio: v })} />
          <Field label="Base do cálculo">
            {(id) => (
              <select id={id} value={r.commissionBase} onChange={(e) => muda({ commissionBase: e.target.value as typeof r.commissionBase })} className={inputCls}>
                <option value="CHARGED">Valor cobrado (já com desconto)</option>
                <option value="TABLE">Preço da tabela do procedimento</option>
              </select>
            )}
          </Field>
          <Field label="Quando a comissão nasce">
            {(id) => (
              <select id={id} value={r.commissionWhen} onChange={(e) => muda({ commissionWhen: e.target.value as typeof r.commissionWhen })} className={inputCls}>
                <option value="EXECUTION">No atendimento</option>
                <option value="BILLING">No faturamento</option>
                <option value="RECEIPT">No recebimento (proporcional ao que entrou)</option>
              </select>
            )}
          </Field>
          <Field label="Categoria da conta a pagar">
            {(id) => (
              <select id={id} value={r.commissionCategoryId ?? ''} onChange={(e) => muda({ commissionCategoryId: e.target.value || null })} className={inputCls}>
                <option value="">Comissões (padrão)</option>
                {despesas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Conta que paga">
            {(id) => (
              <select id={id} value={r.commissionAccountId ?? ''} onChange={(e) => muda({ commissionAccountId: e.target.value || null })} className={inputCls}>
                <option value="">A definir no pagamento</option>
                {opts.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Toggle label="Descontar o custo de material do procedimento" hint="O custo é cadastrado logo abaixo, em Custo dos procedimentos." checked={r.commissionDeductCost} onChange={(v) => muda({ commissionDeductCost: v })} />
        <Toggle label="O profissional vê as próprias comissões" hint="Ele entra em Financeiro › Comissões e vê só as dele." checked={r.professionalSeesCommissions} onChange={(v) => muda({ professionalSeesCommissions: v })} />
        {aviso && <p className={`text-sm ${aviso.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>{aviso.texto}</p>}
        <button type="button" onClick={salvar} disabled={pending} className="btn-primary btn-md">
          Salvar regras
        </button>
      </div>
    </Panel>
  );
}

function Excecoes({ cfg, onChanged }: { cfg: CommissionConfig; onChanged: () => Promise<void> }) {
  const [prof, setProf] = useState(cfg.professionals[0]?.id ?? '');
  const [proc, setProc] = useState('');
  const [mv, setMv] = useState<{ mode: 'PERCENT' | 'FIXED'; value: number }>({ mode: 'PERCENT', value: 0 });
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const nome = (lista: { id: string; name: string }[], id: string | null) => (id ? (lista.find((x) => x.id === id)?.name ?? '') : 'Todos os procedimentos');
  const salvar = () =>
    start(async () => {
      setErro('');
      const r = await saveCommissionException({ professionalId: prof, procedureId: proc || null, ...mv });
      if (!r.ok) return setErro(r.message);
      await onChanged();
    });
  return (
    <Panel title="Exceções por profissional" description="Uma porcentagem ou valor diferente para um profissional, em todos os procedimentos ou só em um.">
      {cfg.professionals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Cadastre os profissionais primeiro.</p>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {cfg.professionals.map((p) => {
              const doProf = cfg.exceptions.filter((e) => e.professionalId === p.id);
              return (
                <li key={p.id} className="px-3 py-2">
                  <p className="font-medium">
                    {p.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{p.percent != null ? `${String(p.percent).replace('.', ',')}% no cadastro` : 'sem % no cadastro'}</span>
                  </p>
                  {doProf.map((e) => (
                    <p key={e.id} className="mt-1 flex items-center gap-2 text-xs">
                      {nome(cfg.procedures, e.procedureId)}: {e.mode === 'PERCENT' ? `${String(e.value).replace('.', ',')}%` : `${formatCents(Math.round(e.value * 100))} por item`}
                      <button
                        type="button"
                        aria-label="Tirar esta exceção"
                        onClick={() =>
                          start(async () => {
                            await deleteCommissionException(e.id);
                            await onChanged();
                          })
                        }
                        className="rounded p-1 text-muted-foreground hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
            <Field label="Profissional">
              {(id) => (
                <select id={id} value={prof} onChange={(e) => setProf(e.target.value)} className={inputCls}>
                  {cfg.professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Procedimento">
              {(id) => (
                <select id={id} value={proc} onChange={(e) => setProc(e.target.value)} className={inputCls}>
                  <option value="">Todos</option>
                  {cfg.procedures.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <ModoValor label="Comissão" value={mv} onChange={setMv} />
            <button type="button" onClick={salvar} disabled={pending || !prof} className="btn-outline btn-md inline-flex items-center gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" /> Salvar exceção
            </button>
          </div>
          <ErrorText>{erro}</ErrorText>
        </div>
      )}
    </Panel>
  );
}

function Repasses({ cfg, onChanged }: { cfg: CommissionConfig; onChanged: () => Promise<void> }) {
  const vazio = { id: undefined as string | undefined, name: '', mode: 'FIXED' as 'PERCENT' | 'FIXED', value: 0, contactId: null as string | null, procedureIds: [] as string[], active: true };
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const salvar = () =>
    start(async () => {
      setErro('');
      const r = await saveTransferType(form);
      if (!r.ok) return setErro(r.message);
      setForm(vazio);
      await onChanged();
    });
  return (
    <Panel title="Tipos de repasse" description="Valores que saem para terceiros a cada procedimento (laboratório, anestesista, profissional parceiro).">
      <div className="space-y-4">
        {cfg.transferTypes.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {cfg.transferTypes.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className={`font-medium ${t.active ? '' : 'text-muted-foreground line-through'}`}>{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.mode === 'PERCENT' ? `${String(t.value).replace('.', ',')}%` : `${formatCents(Math.round(t.value * 100))} por item`} · {t.procedureIds.length} procedimento(s) · {t.contactId ? (cfg.contacts.find((c) => c.id === t.contactId)?.name ?? '') : 'para o profissional do atendimento'}
                </span>
                <button type="button" onClick={() => setForm({ ...t })} className="btn-ghost btn-sm ml-auto">
                  Editar
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome do repasse">{(id) => <input id={id} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />}</Field>
          <ModoValor label="Valor" value={{ mode: form.mode, value: form.value }} onChange={(v) => setForm({ ...form, ...v })} />
          <Field label="Quem recebe">
            {(id) => (
              <select id={id} value={form.contactId ?? ''} onChange={(e) => setForm({ ...form, contactId: e.target.value || null })} className={inputCls}>
                <option value="">O profissional do atendimento</option>
                {cfg.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {form.id && <Toggle label="Repasse ativo" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />}
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Procedimentos em que entra</legend>
          <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-2 text-sm sm:grid-cols-2">
            {cfg.procedures.map((p) => (
              <label key={p.id} className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={form.procedureIds.includes(p.id)} onChange={(e) => setForm({ ...form, procedureIds: e.target.checked ? [...form.procedureIds, p.id] : form.procedureIds.filter((x) => x !== p.id) })} />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorText>{erro}</ErrorText>
        <div className="flex gap-2">
          <button type="button" onClick={salvar} disabled={pending} className="btn-primary btn-md">
            {form.id ? 'Salvar repasse' : 'Criar repasse'}
          </button>
          {form.id && (
            <button type="button" onClick={() => setForm(vazio)} className="btn-ghost btn-md">
              Novo
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Custos({ cfg }: { cfg: CommissionConfig }) {
  const [custos, setCustos] = useState(() => Object.fromEntries(cfg.procedures.map((p) => [p.id, p.costCents ?? 0])));
  const [aviso, setAviso] = useState('');
  const [pending, start] = useTransition();
  const salvar = (id: string) =>
    start(async () => {
      const r = await saveProcedureCost(id, custos[id] || null);
      setAviso(r.ok ? 'Custo salvo.' : r.message);
    });
  return (
    <Panel title="Custo dos procedimentos" description="O custo de material de cada procedimento. Só entra na comissão se a clínica escolher descontar o custo.">
      {cfg.procedures.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum procedimento cadastrado.</p>
      ) : (
        <div className="space-y-2">
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
            {cfg.procedures.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">
                  {p.name} <span className="text-xs text-muted-foreground">· {formatCents(p.priceCents)}</span>
                </span>
                <MoneyInput ariaLabel={`Custo de ${p.name}`} value={custos[p.id] ?? 0} onChange={(c) => setCustos({ ...custos, [p.id]: c })} className="w-32" />
                <button type="button" onClick={() => salvar(p.id)} disabled={pending} className="btn-ghost btn-sm">
                  Salvar
                </button>
              </li>
            ))}
          </ul>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {aviso}
          </p>
        </div>
      )}
    </Panel>
  );
}
