'use client';

import { useEffect, useState, useTransition } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Badge, ErrorText, Field, inputBaseCls, inputCls, MoneyInput, Panel, PercentInput, Toggle, useLoader } from '@/components/fin/ui';
import { CONTACT_KIND_LABEL, METHOD_KIND_LABEL, METHOD_KINDS } from '@/lib/financeiro/defaults';
import type { FinanceSettings } from '@/lib/financeiro/settings';
import {
  financeOptions,
  getFinanceRules,
  listFinanceContacts,
  listFinanceMethods,
  listFinancePermissions,
  saveFinanceContact,
  saveFinanceMethod,
  saveFinancePermission,
  saveFinanceRules,
  type ContactRow,
  type FinPermissionRow,
  type MethodRow,
} from '../finance-actions';

const iconBtn = 'rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

type Options = NonNullable<Awaited<ReturnType<typeof financeOptions>>>;

function useOptions() {
  const [opts, setOpts] = useState<Options | null>(null);
  useEffect(() => {
    void financeOptions().then(setOpts);
  }, []);
  return opts;
}

// ─── Formas de recebimento e pagamento ───────────────────────────────────────

type MethodForm = Omit<MethodRow, 'id' | 'isSystem'> & { id?: string; isSystem?: boolean };

const novaForma = (): MethodForm => ({
  name: '',
  kind: 'OTHER',
  active: true,
  usage: 'BOTH',
  accountId: null,
  requireDocNumber: false,
  settlementType: 'SAME_DAY',
  settlementValue: null,
  operatorContactId: null,
  maxInstallments: 1,
  feeCategoryId: null,
  feeCostCenterId: null,
  fees: [],
});

const USO = { BOTH: 'Receber e pagar', RECEIVE: 'Só receber', PAY: 'Só pagar' } as const;

export function FinanceMethodsPanel() {
  const { data: formas, loaded, reload } = useLoader(listFinanceMethods, [] as MethodRow[]);
  const opts = useOptions();
  const [form, setForm] = useState<MethodForm | null>(null);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const cartao = form?.kind === 'CREDIT_CARD' || form?.kind === 'DEBIT_CARD';

  const salvar = () =>
    start(async () => {
      if (!form) return;
      setErro('');
      const r = await saveFinanceMethod(form);
      if (!r.ok) return setErro(r.message);
      setForm(null);
      await reload();
    });

  const compensacao = (m: MethodRow) =>
    m.settlementType === 'DAYS' ? `cai em ${m.settlementValue} dia(s)` : m.settlementType === 'DAY_OF_MONTH' ? `cai no dia ${m.settlementValue}` : 'cai no mesmo dia';

  return (
    <Panel
      title="Formas de recebimento e pagamento"
      description="Dinheiro, PIX, cartões, boleto… Cada forma diz em que conta o dinheiro entra, quando cai e, no cartão, a taxa por número de parcelas."
      action={
        !form && (
          <button type="button" onClick={() => setForm(novaForma())} className="btn-primary btn-sm inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Nova forma
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
          <Field label="Nome">{(id) => <input id={id} autoFocus maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />}</Field>
          <Field label="Tipo" hint={form.isSystem ? 'O tipo das formas que já vêm no sistema não muda.' : undefined}>
            {(id) => (
              <select id={id} disabled={form.isSystem} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MethodForm['kind'] })} className={inputCls}>
                {METHOD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {METHOD_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Usada para">
            {(id) => (
              <select id={id} value={form.usage} onChange={(e) => setForm({ ...form, usage: e.target.value as MethodForm['usage'] })} className={inputCls}>
                {Object.entries(USO).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {form.kind !== 'WALLET' && (
            <Field label="Conta de destino" hint="A conta que já vem escolhida ao usar esta forma.">
              {(id) => (
                <select id={id} value={form.accountId ?? ''} onChange={(e) => setForm({ ...form, accountId: e.target.value || null })} className={inputCls}>
                  <option value="">A conta padrão</option>
                  {opts?.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Quando o dinheiro cai na conta">
            {(id) => (
              <select
                id={id}
                value={form.settlementType}
                onChange={(e) => setForm({ ...form, settlementType: e.target.value as MethodForm['settlementType'], settlementValue: e.target.value === 'SAME_DAY' ? null : (form.settlementValue ?? 1) })}
                className={inputCls}
              >
                <option value="SAME_DAY">No mesmo dia</option>
                <option value="DAYS">Depois de alguns dias (a cada parcela)</option>
                <option value="DAY_OF_MONTH">Num dia fixo do mês</option>
              </select>
            )}
          </Field>
          {form.settlementType !== 'SAME_DAY' && (
            <Field label={form.settlementType === 'DAYS' ? 'Quantos dias' : 'Dia do mês'}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={form.settlementType === 'DAYS' ? 365 : 31}
                  value={form.settlementValue ?? ''}
                  onChange={(e) => setForm({ ...form, settlementValue: e.target.value ? Number(e.target.value) : null })}
                  className={inputCls}
                />
              )}
            </Field>
          )}

          {cartao && (
            <>
              <Field label="Operadora (opcional)" hint="Cadastre a operadora em Clientes e fornecedores.">
                {(id) => (
                  <select id={id} value={form.operatorContactId ?? ''} onChange={(e) => setForm({ ...form, operatorContactId: e.target.value || null })} className={inputCls}>
                    <option value="">Nenhuma</option>
                    {opts?.contacts
                      .filter((c) => c.kind === 'CARD_OPERATOR')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
              {form.kind === 'CREDIT_CARD' && (
                <Field label="Máximo de parcelas">
                  {(id) => <input id={id} type="number" min={1} max={24} value={form.maxInstallments} onChange={(e) => setForm({ ...form, maxInstallments: Math.max(1, Number(e.target.value) || 1) })} className={inputCls} />}
                </Field>
              )}
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium">Taxas por número de parcelas</legend>
                <p className="mt-0.5 text-xs text-muted-foreground">Exemplo: até 1x, 3,2%; até 6x, 4,5%. A taxa vira uma despesa lançada sozinha.</p>
                <div className="mt-2 space-y-2">
                  {form.fees.map((f, i) => (
                    <div key={i} className="grid grid-cols-[5.5rem_1fr_1fr_auto] items-center gap-2">
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">
                          até
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={24}
                          aria-label={`Faixa ${i + 1}: até quantas parcelas`}
                          value={f.upToInstallments}
                          onChange={(e) => setForm({ ...form, fees: form.fees.map((x, j) => (j === i ? { ...x, upToInstallments: Math.max(1, Number(e.target.value) || 1) } : x)) })}
                          className={`${inputCls} pl-9 pr-1 text-right`}
                        />
                      </div>
                      <PercentInput ariaLabel={`Faixa ${i + 1}: taxa em porcentagem`} value={f.percent} onChange={(v) => setForm({ ...form, fees: form.fees.map((x, j) => (j === i ? { ...x, percent: v } : x)) })} />
                      <MoneyInput ariaLabel={`Faixa ${i + 1}: taxa fixa por parcela`} value={f.fixedCents ?? 0} onChange={(c) => setForm({ ...form, fees: form.fees.map((x, j) => (j === i ? { ...x, fixedCents: c || null } : x)) })} />
                      <button type="button" className={iconBtn} aria-label={`Remover a faixa ${i + 1}`} onClick={() => setForm({ ...form, fees: form.fees.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn-ghost btn-sm inline-flex items-center gap-1"
                    onClick={() => setForm({ ...form, fees: [...form.fees, { upToInstallments: Math.min(form.maxInstallments, (form.fees.at(-1)?.upToInstallments ?? 0) + 1), percent: null, fixedCents: null }] })}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Adicionar faixa
                  </button>
                </div>
              </fieldset>
              <Field label="Categoria da taxa" hint="Em branco, usa Taxas de cartão.">
                {(id) => (
                  <select id={id} value={form.feeCategoryId ?? ''} onChange={(e) => setForm({ ...form, feeCategoryId: e.target.value || null })} className={inputCls}>
                    <option value="">Taxas de cartão</option>
                    {opts?.categories
                      .filter((c) => c.parentId && c.direction === 'PAYABLE')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
            </>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4" /> Ativa
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requireDocNumber} onChange={(e) => setForm({ ...form, requireDocNumber: e.target.checked })} className="h-4 w-4" /> Obrigar o número do documento
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
          {formas.map((m) => (
            <li key={m.id} className={`flex items-center gap-3 px-3 py-2.5 ${m.active ? '' : 'opacity-60'}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.name} {!m.active && <Badge>Desativada</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {METHOD_KIND_LABEL[m.kind]} · {USO[m.usage].toLowerCase()} · {compensacao(m)}
                  {m.fees.length ? ` · ${m.fees.length} faixa(s) de taxa` : ''}
                </p>
              </div>
              <button type="button" className={iconBtn} aria-label={`Editar ${m.name}`} onClick={() => setForm({ ...m, fees: m.fees.map((f) => ({ ...f })) })}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─── Clientes e fornecedores ─────────────────────────────────────────────────

type ContactForm = Omit<ContactRow, 'id'> & { id?: string };

const novoContato = (): ContactForm => ({
  name: '',
  personType: 'PJ',
  document: '',
  phone: '',
  email: '',
  zipCode: '',
  street: '',
  addressNumber: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  kind: 'SUPPLIER',
  notes: '',
  active: true,
});

export function FinanceContactsPanel() {
  const [busca, setBusca] = useState('');
  const [contatos, setContatos] = useState<ContactRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<ContactForm | null>(null);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const carregar = async (q: string) => {
    setContatos(await listFinanceContacts(q));
    setLoaded(true);
  };
  useEffect(() => {
    const t = setTimeout(() => void carregar(busca), busca ? 250 : 0);
    return () => clearTimeout(t);
  }, [busca]);

  const salvar = () =>
    start(async () => {
      if (!form) return;
      setErro('');
      const r = await saveFinanceContact(form);
      if (!r.ok) return setErro(r.message);
      setForm(null);
      await carregar(busca);
    });

  const campo = (label: string, key: keyof ContactForm, max: number, extra = '') => (
    <Field label={label} className={extra}>
      {(id) => <input id={id} maxLength={max} value={(form?.[key] as string | null) ?? ''} onChange={(e) => form && setForm({ ...form, [key]: e.target.value })} className={inputCls} />}
    </Field>
  );

  return (
    <Panel
      title="Clientes e fornecedores"
      description="Quem paga ou recebe e não é paciente: fornecedores, convênios, operadoras de cartão e profissionais terceiros. Os pacientes já contam como clientes."
      action={
        !form && (
          <button type="button" onClick={() => setForm(novoContato())} className="btn-primary btn-sm inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Novo cadastro
          </button>
        )
      }
    >
      {form ? (
        <form
          className="grid gap-3 rounded-lg border border-border bg-surface-alt/50 p-4 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <Field label="Nome ou razão social" className="sm:col-span-4">
            {(id) => <input id={id} autoFocus maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />}
          </Field>
          <Field label="Tipo de cadastro" className="sm:col-span-2">
            {(id) => (
              <select id={id} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ContactForm['kind'] })} className={inputCls}>
                {Object.entries(CONTACT_KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Pessoa" className="sm:col-span-2">
            {(id) => (
              <select id={id} value={form.personType} onChange={(e) => setForm({ ...form, personType: e.target.value as 'PF' | 'PJ' })} className={inputCls}>
                <option value="PJ">Jurídica (CNPJ)</option>
                <option value="PF">Física (CPF)</option>
              </select>
            )}
          </Field>
          {campo(form.personType === 'PF' ? 'CPF' : 'CNPJ', 'document', 20, 'sm:col-span-2')}
          {campo('Telefone', 'phone', 30, 'sm:col-span-2')}
          {campo('E-mail', 'email', 120, 'sm:col-span-3')}
          {campo('CEP', 'zipCode', 10, 'sm:col-span-1')}
          {campo('Cidade', 'city', 60, 'sm:col-span-2')}
          {campo('Rua', 'street', 120, 'sm:col-span-3')}
          {campo('Número', 'addressNumber', 20, 'sm:col-span-1')}
          {campo('Bairro', 'neighborhood', 60, 'sm:col-span-1')}
          {campo('UF', 'state', 2, 'sm:col-span-1')}
          {campo('Observações', 'notes', 500, 'sm:col-span-6')}
          <label className="inline-flex items-center gap-2 text-sm sm:col-span-6">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4" /> Ativo
          </label>
          <div className="sm:col-span-6">
            <ErrorText>{erro}</ErrorText>
          </div>
          <div className="flex gap-2 sm:col-span-6">
            <button type="submit" disabled={pending} className="btn-primary btn-sm">
              {pending ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" onClick={() => (setForm(null), setErro(''))} className="btn-ghost btn-sm">
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="relative mb-3 max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input aria-label="Buscar cliente ou fornecedor" placeholder="Buscar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} className={`${inputCls} pl-8`} />
          </div>
          {!loaded ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : contatos.length === 0 ? (
            <p className="text-sm text-muted-foreground">{busca ? 'Nenhum cadastro com esse nome.' : 'Nenhum cadastro ainda. O primeiro fornecedor pode ser criado aqui ou na hora de lançar uma conta.'}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {contatos.map((c) => (
                <li key={c.id} className={`flex items-center gap-3 px-3 py-2.5 ${c.active ? '' : 'opacity-60'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.name} {!c.active && <Badge>Desativado</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {CONTACT_KIND_LABEL[c.kind]}
                      {c.phone ? ` · ${c.phone}` : ''}
                      {c.city ? ` · ${c.city}` : ''}
                    </p>
                  </div>
                  <button type="button" className={iconBtn} aria-label={`Editar ${c.name}`} onClick={() => setForm({ ...c })}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

// ─── Regras gerais ───────────────────────────────────────────────────────────

export function FinanceRulesPanel() {
  const [regras, setRegras] = useState<FinanceSettings | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    void getFinanceRules().then(setRegras);
  }, []);

  if (!regras) {
    return (
      <Panel title="Regras do financeiro">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </Panel>
    );
  }

  const muda = (parte: Partial<FinanceSettings>) => {
    setRegras({ ...regras, ...parte });
    setAviso(null);
  };
  const salvar = () =>
    start(async () => {
      const r = await saveFinanceRules(regras);
      setAviso(r.ok ? { ok: true, texto: 'Regras salvas.' } : { ok: false, texto: r.message });
    });

  const grupo = (titulo: string, filhos: React.ReactNode) => (
    <div className="rounded-lg border border-border px-4">
      <h3 className="border-b border-border py-2.5 text-sm font-semibold">{titulo}</h3>
      <div className="divide-y divide-border">{filhos}</div>
    </div>
  );

  return (
    <Panel title="Regras do financeiro" description="Como a clínica quer que o caixa, os recebimentos e a agenda se comportem.">
      <div className="space-y-4">
        {grupo(
          'Caixa',
          <>
            <Toggle label="Exigir caixa aberto para receber em dinheiro" hint="Sem caixa aberto, o sistema pede para abrir antes de aceitar dinheiro." checked={regras.requireOpenCashForCash} onChange={(v) => muda({ requireOpenCashForCash: v })} />
            <Toggle label="Conferência cega no fechamento" hint="A pessoa digita o que contou antes de ver o que o sistema esperava." checked={regras.blindCashCount} onChange={(v) => muda({ blindCashCount: v })} />
            <Toggle
              label="Bloquear o fechamento com atendidos sem cobrar"
              hint="Desligado, o sistema só avisa quem foi atendido e ficou sem faturar ou receber."
              checked={regras.closeWithUnbilled === 'BLOCK'}
              onChange={(v) => muda({ closeWithUnbilled: v ? 'BLOCK' : 'WARN' })}
            />
            <Toggle label="Avisar quando um caixa fechar com diferença" checked={regras.alertCashDifference} onChange={(v) => muda({ alertCashDifference: v })} />
            <div className="flex flex-wrap items-center justify-between gap-3 py-3">
              <label htmlFor="fin-dias-caixa" className="text-sm font-medium">
                Avisar caixa aberto há mais de (dias)
              </label>
              <input id="fin-dias-caixa" type="number" min={0} max={60} value={regras.openCashAlertDays} onChange={(e) => muda({ openCashAlertDays: Number(e.target.value) || 0 })} className={`${inputBaseCls} w-24 text-right`} />
            </div>
          </>,
        )}
        {grupo(
          'Agenda',
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <label htmlFor="fin-bloqueio" className="text-sm font-medium">
                  Bloquear o início do atendimento sem pagamento
                </label>
                <p className="mt-0.5 text-xs text-muted-foreground">O botão “em atendimento” só libera com a cobrança feita ou paga.</p>
              </div>
              <select id="fin-bloqueio" value={regras.blockStartWithoutPayment} onChange={(e) => muda({ blockStartWithoutPayment: e.target.value as FinanceSettings['blockStartWithoutPayment'] })} className={`${inputBaseCls} w-56 max-w-full`}>
                <option value="OFF">Não bloquear</option>
                <option value="BILLED">Liberar com a cobrança gerada</option>
                <option value="PAID">Liberar só com tudo pago</option>
              </select>
            </div>
            <Toggle label="Faturar sozinho ao concluir o atendimento" hint="Cria a cobrança automaticamente quando o paciente é marcado como atendido." checked={regras.autoBillOnFinish} onChange={(v) => muda({ autoBillOnFinish: v })} />
            <Toggle label="Mostrar valores dos procedimentos para o profissional" checked={regras.showPricesToProfessional} onChange={(v) => muda({ showPricesToProfessional: v })} />
            <Toggle label="Permitir mudar procedimentos depois de atendido" hint="A mudança fica registrada no histórico." checked={regras.editItemsAfterAttended} onChange={(v) => muda({ editItemsAfterAttended: v })} />
          </>,
        )}
        {grupo(
          'Recebimento',
          <>
            <Toggle label="Exigir os dados da transação do cartão" hint="Bandeira e número da autorização passam a ser obrigatórios." checked={regras.requireCardData} onChange={(v) => muda({ requireCardData: v })} />
            <div className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <label htmlFor="fin-taxa" className="text-sm font-medium">
                  Lançar a taxa do cartão
                </label>
                <p className="mt-0.5 text-xs text-muted-foreground">A taxa vira uma despesa lançada sozinha.</p>
              </div>
              <select id="fin-taxa" value={regras.cardFeeWhen} onChange={(e) => muda({ cardFeeWhen: e.target.value as FinanceSettings['cardFeeWhen'] })} className={`${inputBaseCls} w-56 max-w-full`}>
                <option value="RECEIPT">Na hora do recebimento</option>
                <option value="RECONCILIATION">Só na conciliação</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <label htmlFor="fin-desc" className="text-sm font-medium">
                  Limite de desconto da equipe
                </label>
                <p className="mt-0.5 text-xs text-muted-foreground">Vale para quem não tem um limite próprio. Acima disso, pede liberação.</p>
              </div>
              <div className="w-28">
                <PercentInput id="fin-desc" value={regras.defaultMaxDiscountPercent} onChange={(v) => muda({ defaultMaxDiscountPercent: v ?? 0 })} />
              </div>
            </div>
            <Toggle label="Recibo A4 com o cabeçalho da clínica" hint="Desligue se a clínica imprime em papel timbrado." checked={regras.receiptHeader} onChange={(v) => muda({ receiptHeader: v })} />
            <Toggle label="Obrigar CPF ou CNPJ no cadastro de fornecedor" checked={regras.requireSupplierDocument} onChange={(v) => muda({ requireSupplierDocument: v })} />
          </>,
        )}
        {grupo(
          'Atraso e renegociação',
          <>
            <Toggle label="Cobrar juros e multa em conta vencida" hint="Calculados na hora de receber, sobre o valor em aberto." checked={regras.lateChargesEnabled} onChange={(v) => muda({ lateChargesEnabled: v })} />
            <div className="grid gap-3 py-3 sm:grid-cols-3">
              <Field label="Multa (uma vez)">{(id) => <PercentInput id={id} value={regras.finePercent} onChange={(v) => muda({ finePercent: v ?? 0 })} />}</Field>
              <Field label="Juros ao dia">{(id) => <PercentInput id={id} value={regras.dailyInterestPercent} onChange={(v) => muda({ dailyInterestPercent: v ?? 0 })} />}</Field>
              <Field label="Juros da renegociação (ao mês)">{(id) => <PercentInput id={id} value={regras.renegotiationInterestPercent} onChange={(v) => muda({ renegotiationInterestPercent: v ?? 0 })} />}</Field>
            </div>
          </>,
        )}
        {grupo('Comissões', <Toggle label="O profissional vê as próprias comissões" checked={regras.professionalSeesCommissions} onChange={(v) => muda({ professionalSeesCommissions: v })} />)}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={salvar} disabled={pending} className="btn-primary btn-md">
          {pending ? 'Salvando…' : 'Salvar regras'}
        </button>
        <p role="status" aria-live="polite" className={`text-sm ${aviso?.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>
          {aviso?.texto}
        </p>
      </div>
    </Panel>
  );
}

// ─── Permissões financeiras ──────────────────────────────────────────────────

const PERFIL: Record<string, string> = { OWNER: 'Dono', ADMIN: 'Administrador', RECEPTIONIST: 'Recepção', PROFESSIONAL: 'Profissional' };
const triState = (v: boolean | null) => (v === null ? '' : v ? 'sim' : 'nao');
const fromTri = (v: string) => (v === '' ? null : v === 'sim');

export function FinancePermissionsPanel() {
  const { data: pessoas, loaded, reload } = useLoader(listFinancePermissions, [] as FinPermissionRow[]);
  const opts = useOptions();
  const [form, setForm] = useState<FinPermissionRow | null>(null);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const salvar = () =>
    start(async () => {
      if (!form) return;
      setErro('');
      const r = await saveFinancePermission(form);
      if (!r.ok) return setErro(r.message);
      setForm(null);
      await reload();
    });

  const resumo = (p: FinPermissionRow) => {
    if (p.role === 'OWNER' || p.role === 'ADMIN') return 'Acesso total ao financeiro';
    const partes = [
      p.maxDiscountPercent == null ? 'desconto: limite da clínica' : `desconto até ${String(p.maxDiscountPercent).replace('.', ',')}%`,
      p.operation === 'BOTH' ? 'recebe e paga' : p.operation === 'RECEIVE' ? 'só recebe' : 'só paga',
      p.accountIds.length ? `${p.accountIds.length} conta(s)` : 'todas as contas',
    ];
    if (p.canReverse) partes.push('pode estornar');
    if (p.canSeeReports) partes.push('vê relatórios');
    return partes.join(' · ');
  };

  return (
    <Panel title="Permissões financeiras" description="Ajustes por pessoa, por cima do perfil: limite de desconto, se recebe ou paga, contas liberadas, estorno e relatórios.">
      {form && (
        <form
          className="mb-4 grid gap-3 rounded-lg border border-border bg-surface-alt/50 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <p className="text-sm font-medium sm:col-span-2">{form.name}</p>
          <Field label="Limite de desconto" hint="Em branco, vale o limite da clínica.">
            {(id) => <PercentInput id={id} value={form.maxDiscountPercent} onChange={(v) => setForm({ ...form, maxDiscountPercent: v })} />}
          </Field>
          <Field label="Operações">
            {(id) => (
              <select id={id} value={form.operation} onChange={(e) => setForm({ ...form, operation: e.target.value as FinPermissionRow['operation'] })} className={inputCls}>
                <option value="BOTH">Receber e pagar</option>
                <option value="RECEIVE">Só receber</option>
                <option value="PAY">Só pagar</option>
              </select>
            )}
          </Field>
          <Field label="Pode estornar">
            {(id) => (
              <select id={id} value={triState(form.canReverse)} onChange={(e) => setForm({ ...form, canReverse: fromTri(e.target.value) })} className={inputCls}>
                <option value="">O que o perfil diz</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            )}
          </Field>
          <Field label="Pode ver relatórios gerenciais">
            {(id) => (
              <select id={id} value={triState(form.canSeeReports)} onChange={(e) => setForm({ ...form, canSeeReports: fromTri(e.target.value) })} className={inputCls}>
                <option value="">O que o perfil diz</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            )}
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium">Contas liberadas</legend>
            <p className="mt-0.5 text-xs text-muted-foreground">Sem nenhuma marcada, a pessoa usa todas.</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {opts?.accounts.map((a) => (
                <label key={a.id} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={form.accountIds.includes(a.id)}
                    onChange={(e) => setForm({ ...form, accountIds: e.target.checked ? [...form.accountIds, a.id] : form.accountIds.filter((x) => x !== a.id) })}
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </fieldset>
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
          {pessoas.map((p) => {
            const total = p.role === 'OWNER' || p.role === 'ADMIN';
            return (
              <li key={p.userId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.name} <Badge>{PERFIL[p.role] ?? p.role}</Badge>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{resumo(p)}</p>
                </div>
                {!total && (
                  <button type="button" className={iconBtn} aria-label={`Editar as permissões de ${p.name}`} onClick={() => setForm({ ...p })}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
