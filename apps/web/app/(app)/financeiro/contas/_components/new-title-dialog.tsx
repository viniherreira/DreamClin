'use client';

import { useMemo, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ErrorText, Field, inputCls, Modal, MoneyInput, PlanLock } from '@/components/fin/ui';
import { saveFinanceContact } from '@/app/(app)/configuracoes/finance-actions';
import { checkAllocation } from '@/lib/financeiro/allocation';
import { competenceOf, dayBR } from '@/lib/financeiro/dates';
import { recurrenceDates, simulateInstallments, type RecurrenceUnit } from '@/lib/financeiro/installments';
import { formatCents } from '@/lib/financeiro/money';
import { createTitleAction } from '../../fin-actions';
import type { FinOptions } from './types';

import { DateField } from '@/components/ui/date-field';
/**
 * Novo lançamento: uma conta a receber ou a pagar, à vista, parcelada (com a
 * tabela simulada antes de salvar) ou recorrente.
 */

type Modo = 'unico' | 'parcelado' | 'recorrente';

interface Rateio {
  key: number;
  categoryId: string;
  costCenterId: string;
  amount: number;
}

export function NewTitleDialog({
  open,
  onOpenChange,
  options,
  today,
  advanced,
  initialDirection,
  patient,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  options: FinOptions;
  today: string;
  /** Plano com centros de custo e rateio. */
  advanced: boolean;
  initialDirection: 'RECEIVABLE' | 'PAYABLE';
  /** Lançamento já ligado a um paciente (ficha do paciente). */
  patient?: { id: string; name: string } | null;
  onSaved: (created: number) => void;
}) {
  const [direction, setDirection] = useState(initialDirection);
  const [contactId, setContactId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [competence, setCompetence] = useState('');
  const [amount, setAmount] = useState(0);
  const [documentNumber, setDocumentNumber] = useState('');
  const [description, setDescription] = useState('');
  const [modo, setModo] = useState<Modo>('unico');
  const [parcelas, setParcelas] = useState(2);
  const [intervalo, setIntervalo] = useState<'monthly' | 'days'>('monthly');
  const [dias, setDias] = useState(30);
  const [tabela, setTabela] = useState<{ dueDate: string; amountCents: number }[] | null>(null);
  const [every, setEvery] = useState(1);
  const [unit, setUnit] = useState<RecurrenceUnit>('MONTH');
  const [fim, setFim] = useState<'nunca' | 'data' | 'vezes'>('nunca');
  const [fimData, setFimData] = useState('');
  const [vezes, setVezes] = useState(12);
  const [rateio, setRateio] = useState<Rateio[]>([]);
  const [novoContato, setNovoContato] = useState<string | null>(null);
  const [contatos, setContatos] = useState(options.contacts);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const cats = options.categories.filter((c) => c.direction === direction);
  const pais = cats.filter((c) => !c.parentId);
  const centros = options.costCenters;
  const formas = options.methods.filter((m) => m.kind !== 'WALLET' && (m.usage === 'BOTH' || m.usage === (direction === 'RECEIVABLE' ? 'RECEIVE' : 'PAY')));

  const simulada = useMemo(
    () => (modo === 'parcelado' && amount > 0 ? simulateInstallments(amount, parcelas, dueDate, intervalo === 'monthly' ? { kind: 'monthly' } : { kind: 'days', days: dias }).map((l) => ({ dueDate: l.dueDate, amountCents: l.amount })) : []),
    [modo, amount, parcelas, dueDate, intervalo, dias],
  );
  const linhas = tabela ?? simulada;
  const somaTabela = linhas.reduce((s, l) => s + l.amountCents, 0);
  const proximas = useMemo(() => {
    if (modo !== 'recorrente') return [];
    return recurrenceDates({ every, unit, start: dueDate, end: fim === 'data' && fimData ? fimData : null, occurrences: fim === 'vezes' ? vezes : null }, '2099-12-31').slice(0, 6);
  }, [modo, every, unit, dueDate, fim, fimData, vezes]);
  const confereRateio = checkAllocation(amount, rateio.map((r) => ({ categoryId: r.categoryId, costCenterId: r.costCenterId || null, amount: r.amount })));

  const limpa = () => {
    setTabela(null);
    setErro('');
  };

  const criaContato = () =>
    start(async () => {
      if (!novoContato?.trim()) return;
      const r = await saveFinanceContact({ name: novoContato.trim(), personType: 'PJ', kind: direction === 'PAYABLE' ? 'SUPPLIER' : 'OTHER', active: true });
      if (!r.ok) return setErro(r.message);
      setContatos((c) => [...c, { id: r.data.id, name: r.data.name, kind: 'SUPPLIER' as const }].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      setContactId(r.data.id);
      setNovoContato(null);
    });

  const salvar = () =>
    start(async () => {
      setErro('');
      if (!categoryId) return setErro('Escolha a categoria.');
      if (amount <= 0) return setErro('Informe o valor.');
      if (modo === 'parcelado' && somaTabela !== amount) return setErro(`As parcelas somam ${formatCents(somaTabela)}, mas o valor é ${formatCents(amount)}.`);
      if (rateio.length && !confereRateio.ok) return setErro(confereRateio.message);
      const r = await createTitleAction({
        direction,
        patientId: patient?.id ?? null,
        contactId: patient ? null : contactId || null,
        categoryId,
        costCenterId: costCenterId || null,
        accountId: accountId || null,
        methodId: methodId || null,
        issueDate,
        dueDate,
        competence: modo === 'unico' && competence ? competence : null,
        amountCents: amount,
        documentNumber: documentNumber || null,
        description: description || null,
        allocations: rateio.length ? rateio.map((x) => ({ categoryId: x.categoryId, costCenterId: x.costCenterId || null, amount: x.amount })) : undefined,
        schedule: modo === 'parcelado' ? linhas : undefined,
        recurrence: modo === 'recorrente' ? { every, unit, start: dueDate, end: fim === 'data' && fimData ? fimData : null, occurrences: fim === 'vezes' ? vezes : null } : null,
      });
      if (!r.ok) return setErro(r.message);
      onSaved(r.data.created);
      onOpenChange(false);
    });

  const opcoesCategoria = (lista: typeof cats) =>
    pais.map((p) => {
      const filhas = lista.filter((c) => c.parentId === p.id);
      return filhas.length ? (
        <optgroup key={p.id} label={p.name}>
          {filhas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ) : null;
    });

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Novo lançamento" description={patient ? patient.name : 'Uma conta a receber ou a pagar, com vencimento.'} size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        {!patient && (
          <div role="radiogroup" aria-label="Tipo de conta" className="inline-flex rounded-lg bg-surface-alt p-1">
            {(['RECEIVABLE', 'PAYABLE'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                onClick={() => {
                  setDirection(d);
                  setCategoryId('');
                  setRateio([]);
                  setMethodId('');
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${direction === d ? 'bg-surface shadow-sm' : 'text-muted-foreground'}`}
              >
                {d === 'RECEIVABLE' ? 'A receber' : 'A pagar'}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {!patient && (
            <div className="sm:col-span-2">
              {novoContato === null ? (
                <Field label={direction === 'PAYABLE' ? 'Fornecedor' : 'Cliente'}>
                  {(id) => (
                    <div className="flex gap-2">
                      <select id={id} value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputCls}>
                        <option value="">Sem cadastro</option>
                        {contatos.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => setNovoContato('')} className="btn-outline btn-md shrink-0 whitespace-nowrap">
                        Cadastrar
                      </button>
                    </div>
                  )}
                </Field>
              ) : (
                <Field label="Nome do novo cadastro" hint="O resto dos dados dá para completar depois, em Configurações › Clientes e fornecedores.">
                  {(id) => (
                    <div className="flex gap-2">
                      <input id={id} autoFocus maxLength={120} value={novoContato} onChange={(e) => setNovoContato(e.target.value)} className={inputCls} />
                      <button type="button" disabled={pending} onClick={criaContato} className="btn-primary btn-md shrink-0">
                        Criar
                      </button>
                      <button type="button" onClick={() => setNovoContato(null)} className="btn-ghost btn-md shrink-0">
                        Voltar
                      </button>
                    </div>
                  )}
                </Field>
              )}
            </div>
          )}

          <Field label="Categoria">
            {(id) => (
              <select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
                <option value="">Escolha…</option>
                {opcoesCategoria(cats)}
              </select>
            )}
          </Field>
          <Field label="Valor">{(id) => <MoneyInput id={id} value={amount} onChange={(c) => (setAmount(c), limpa())} />}</Field>
          <Field label="Emissão">{(id) => <DateField id={id} value={issueDate} onChange={(v) => setIssueDate(v)} className={inputCls} />}</Field>
          <Field label={modo === 'parcelado' ? 'Vencimento da 1ª parcela' : modo === 'recorrente' ? 'Primeiro vencimento' : 'Vencimento'}>
            {(id) => <DateField id={id} value={dueDate} onChange={(v) => (setDueDate(v), limpa())} className={inputCls} />}
          </Field>
          <Field label="Forma de pagamento (opcional)">
            {(id) => (
              <select
                id={id}
                value={methodId}
                onChange={(e) => {
                  setMethodId(e.target.value);
                  const f = formas.find((m) => m.id === e.target.value);
                  if (f?.accountId) setAccountId(f.accountId);
                }}
                className={inputCls}
              >
                <option value="">A definir</option>
                {formas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Conta (opcional)">
            {(id) => (
              <select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
                <option value="">A definir</option>
                {options.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {modo === 'unico' && (
            <Field label="Mês de competência" hint="Em branco, o mês do vencimento.">
              {(id) => <input id={id} type="month" value={competence || competenceOf(dueDate)} onChange={(e) => setCompetence(e.target.value)} className={inputCls} />}
            </Field>
          )}
          <Field label="Nº do documento (opcional)">{(id) => <input id={id} maxLength={60} value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} className={inputCls} />}</Field>
          {advanced && centros.length > 0 && (
            <Field label="Centro de custo (opcional)">
              {(id) => (
                <select id={id} value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} className={inputCls}>
                  <option value="">Nenhum</option>
                  {centros.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parentId ? `— ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Descrição (opcional)" className="sm:col-span-2">
            {(id) => <input id={id} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />}
          </Field>
        </div>

        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium">Como este lançamento se repete</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {(
              [
                ['unico', 'Uma vez só'],
                ['parcelado', 'Parcelar esta conta'],
                ['recorrente', 'Lançamento recorrente'],
              ] as const
            ).map(([m, rotulo]) => (
              <label key={m} className="inline-flex items-center gap-2">
                <input type="radio" name="modo" className="h-4 w-4" checked={modo === m} onChange={() => (setModo(m), limpa())} /> {rotulo}
              </label>
            ))}
          </div>

          {modo === 'parcelado' && (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Parcelas">{(id) => <input id={id} type="number" min={2} max={60} value={parcelas} onChange={(e) => (setParcelas(Math.min(60, Math.max(2, Number(e.target.value) || 2))), limpa())} className={inputCls} />}</Field>
                <Field label="Intervalo">
                  {(id) => (
                    <select id={id} value={intervalo} onChange={(e) => (setIntervalo(e.target.value as 'monthly' | 'days'), limpa())} className={inputCls}>
                      <option value="monthly">Todo mês, no mesmo dia</option>
                      <option value="days">A cada tantos dias</option>
                    </select>
                  )}
                </Field>
                {intervalo === 'days' && <Field label="Dias">{(id) => <input id={id} type="number" min={1} max={365} value={dias} onChange={(e) => (setDias(Math.max(1, Number(e.target.value) || 1)), limpa())} className={inputCls} />}</Field>}
              </div>
              {linhas.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Parcelas simuladas</caption>
                    <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2">Nº</th>
                        <th scope="col" className="px-3 py-2">Vencimento</th>
                        <th scope="col" className="px-3 py-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {linhas.map((l, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 tabular-nums">{i + 1}</td>
                          <td className="px-3 py-1.5">
                            <DateField aria-label={`Vencimento da parcela ${i + 1}`} value={l.dueDate} onChange={(v) => setTabela(linhas.map((x, j) => (j === i ? { ...x, dueDate: v } : x)))} wrapperClassName="w-full max-w-[11rem]" className={inputCls} />
                          </td>
                          <td className="px-3 py-1.5">
                            <MoneyInput ariaLabel={`Valor da parcela ${i + 1}`} value={l.amountCents} onChange={(c) => setTabela(linhas.map((x, j) => (j === i ? { ...x, amountCents: c } : x)))} className="ml-auto max-w-[10rem]" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {tabela && (
                <p className={`text-xs ${somaTabela === amount ? 'text-muted-foreground' : 'text-destructive'}`}>
                  Soma das parcelas: {formatCents(somaTabela)}.{' '}
                  <button type="button" onClick={() => setTabela(null)} className="font-medium underline underline-offset-2">
                    Simular de novo
                  </button>
                </p>
              )}
            </div>
          )}

          {modo === 'recorrente' && (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Repetir a cada">{(id) => <input id={id} type="number" min={1} max={365} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))} className={inputCls} />}</Field>
                <Field label="Período">
                  {(id) => (
                    <select id={id} value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)} className={inputCls}>
                      <option value="DAY">dia(s)</option>
                      <option value="WEEK">semana(s)</option>
                      <option value="MONTH">mês(es)</option>
                      <option value="YEAR">ano(s)</option>
                    </select>
                  )}
                </Field>
                <Field label="Termina">
                  {(id) => (
                    <select id={id} value={fim} onChange={(e) => setFim(e.target.value as typeof fim)} className={inputCls}>
                      <option value="nunca">Não termina</option>
                      <option value="data">Numa data</option>
                      <option value="vezes">Depois de N vezes</option>
                    </select>
                  )}
                </Field>
                {fim === 'data' && <Field label="Até">{(id) => <DateField id={id} value={fimData} onChange={(v) => setFimData(v)} className={inputCls} />}</Field>}
                {fim === 'vezes' && <Field label="Vezes">{(id) => <input id={id} type="number" min={1} max={240} value={vezes} onChange={(e) => setVezes(Math.max(1, Number(e.target.value) || 1))} className={inputCls} />}</Field>}
              </div>
              <p className="text-xs text-muted-foreground">
                Próximos vencimentos: {proximas.map(dayBR).join(', ') || 'nenhum'}
                {proximas.length === 6 ? '…' : ''}. O sistema deixa prontos os lançamentos dos próximos 12 meses e vai criando os seguintes sozinho.
              </p>
            </div>
          )}
        </fieldset>

        {categoryId &&
          (advanced ? (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">Rateio (opcional)</legend>
              <p className="text-xs text-muted-foreground">Divida o valor entre categorias e centros de custo. A soma precisa bater com o valor.</p>
              <div className="mt-2 space-y-2">
                {rateio.map((r, i) => (
                  <div key={r.key} className="grid grid-cols-[1fr_1fr_8.5rem_auto] items-center gap-2">
                    <select aria-label={`Rateio ${i + 1}: categoria`} value={r.categoryId} onChange={(e) => setRateio(rateio.map((x) => (x.key === r.key ? { ...x, categoryId: e.target.value } : x)))} className={inputCls}>
                      {opcoesCategoria(cats)}
                    </select>
                    <select aria-label={`Rateio ${i + 1}: centro de custo`} value={r.costCenterId} onChange={(e) => setRateio(rateio.map((x) => (x.key === r.key ? { ...x, costCenterId: e.target.value } : x)))} className={inputCls}>
                      <option value="">Sem centro de custo</option>
                      {centros.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <MoneyInput ariaLabel={`Rateio ${i + 1}: valor`} value={r.amount} onChange={(c) => setRateio(rateio.map((x) => (x.key === r.key ? { ...x, amount: c } : x)))} />
                    <button type="button" aria-label={`Remover a parte ${i + 1} do rateio`} onClick={() => setRateio(rateio.filter((x) => x.key !== r.key))} className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-ghost btn-sm inline-flex items-center gap-1"
                  onClick={() => setRateio([...rateio, { key: Date.now(), categoryId, costCenterId: '', amount: Math.max(0, amount - rateio.reduce((s, x) => s + x.amount, 0)) }])}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Adicionar parte
                </button>
                {rateio.length > 0 && !confereRateio.ok && <p className="text-xs text-destructive">{confereRateio.message}</p>}
              </div>
            </fieldset>
          ) : (
            <PlanLock what="Rateio entre categorias e centros de custo" />
          ))}

        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="btn-primary btn-md">
            {pending ? 'Salvando…' : modo === 'parcelado' ? `Salvar ${linhas.length} parcelas` : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
