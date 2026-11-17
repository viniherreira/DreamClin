'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Eye, EyeOff, FileDown, Lock } from 'lucide-react';
import { Badge, ErrorText, Field, inputCls, Modal, MoneyInput } from '@/components/fin/ui';
import type { CashAlerts, CashListRow, CashView } from '@/fin/cash-read';
import { COUNT_GROUPS, COUNT_GROUP_LABEL, ZERO_COUNT, countRows, type CountRow, type Counted } from '@/lib/financeiro/cash';
import { formatCents } from '@/lib/financeiro/money';
import { CLINIC_TZ } from '@/lib/tz';
import { cashMoveAction, closeCashAction, markCashSeenAction, openCashAction } from '../cash-actions';

/**
 * As peças da tela do caixa: abrir, o caixa aberto (saldo por meio, reforço,
 * sangria, movimentos), fechar com a conferência e os avisos.
 */

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: CLINIC_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit' });

const TIPO: Record<string, string> = {
  RECEIPT: 'Recebimento',
  PAYMENT: 'Pagamento',
  REINFORCEMENT: 'Reforço',
  WITHDRAWAL: 'Sangria',
  TRANSFER_IN: 'Transferência (entrada)',
  TRANSFER_OUT: 'Transferência (saída)',
  REVERSAL: 'Estorno',
  FEE: 'Taxa',
};

type Conta = { id: string; name: string };

// ─── Abrir ───────────────────────────────────────────────────────────────────

export function OpenCashForm({ suggestedCents, cashAccounts, unitName, onOpened, compact = false }: { suggestedCents: number; cashAccounts: Conta[]; unitName: string | null; onOpened?: () => void; compact?: boolean }) {
  const router = useRouter();
  const [troco, setTroco] = useState(suggestedCents);
  const [conta, setConta] = useState(cashAccounts[0]?.id ?? '');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const abrir = () =>
    start(async () => {
      setErro('');
      const r = await openCashAction({ openingCents: troco, accountId: conta || null });
      if (!r.ok) return setErro(r.message);
      onOpened?.();
      router.refresh();
    });

  return (
    <form
      className={compact ? 'space-y-3' : 'max-w-md space-y-4'}
      onSubmit={(e) => {
        e.preventDefault();
        abrir();
      }}
    >
      <Field label="Troco inicial" hint={suggestedCents > 0 ? `O último fechamento deixou ${formatCents(suggestedCents)} em dinheiro.` : 'O dinheiro que já está na gaveta para dar troco. Pode ser zero.'}>
        {(id) => <MoneyInput id={id} value={troco} onChange={setTroco} />}
      </Field>
      {cashAccounts.length > 1 && (
        <Field label="Conta do caixa">
          {(id) => (
            <select id={id} value={conta} onChange={(e) => setConta(e.target.value)} className={inputCls}>
              {cashAccounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {unitName && <p className="text-sm text-muted-foreground">Unidade: {unitName}</p>}
      <ErrorText>{erro}</ErrorText>
      <button type="submit" disabled={pending} className="btn-primary btn-md">
        {pending ? 'Abrindo…' : 'Abrir caixa'}
      </button>
    </form>
  );
}

// ─── O caixa ─────────────────────────────────────────────────────────────────

export function CashSessionPanel({ view, accounts, canManage }: { view: CashView; accounts: Conta[]; canManage: boolean }) {
  const [mostrar, setMostrar] = useState(false);
  const [movimento, setMovimento] = useState<'REINFORCEMENT' | 'WITHDRAWAL' | null>(null);
  const [fechar, setFechar] = useState(false);
  const aberto = view.status === 'OPEN';
  const opera = aberto && (view.mine || canManage);
  const valor = (c: number) => (mostrar ? formatCents(c) : '•••••');

  return (
    <section aria-labelledby="caixa-titulo" className="rounded-xl border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="min-w-0">
          <h2 id="caixa-titulo" className="flex flex-wrap items-center gap-2 text-base font-semibold">
            Caixa nº {view.code}
            {aberto ? <Badge tone="green">Aberto</Badge> : <Badge>Fechado</Badge>}
            {aberto && view.pendingCount && <Badge tone="amber">Contagem registrada</Badge>}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {view.userName} · aberto em {dataHora(view.openedAt)}
            {view.closedAt && ` · fechado em ${dataHora(view.closedAt)}${view.closedByName && view.closedByName !== view.userName ? ` por ${view.closedByName}` : ''}`}
            {view.unitName && ` · ${view.unitName}`} · {view.accountName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/financeiro/caixa/${view.id}/relatorio`} target="_blank" rel="noopener" className="btn-outline btn-md inline-flex items-center gap-1.5">
            <FileDown className="h-4 w-4" aria-hidden="true" /> Relatório
          </a>
          {opera && (
            <>
              <button type="button" onClick={() => setMovimento('REINFORCEMENT')} className="btn-outline btn-md inline-flex items-center gap-1.5">
                <ArrowDownToLine className="h-4 w-4" aria-hidden="true" /> Reforço
              </button>
              <button type="button" onClick={() => setMovimento('WITHDRAWAL')} className="btn-outline btn-md inline-flex items-center gap-1.5">
                <ArrowUpFromLine className="h-4 w-4" aria-hidden="true" /> Sangria
              </button>
              <button type="button" onClick={() => setFechar(true)} className="btn-primary btn-md inline-flex items-center gap-1.5">
                <Lock className="h-4 w-4" aria-hidden="true" /> Fechar caixa
              </button>
            </>
          )}
        </div>
      </div>

      <div className="p-5">
        {view.expected ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{aberto ? 'Saldo por meio de pagamento' : 'Conferência do fechamento'}</h3>
              <button type="button" onClick={() => setMostrar((v) => !v)} aria-pressed={mostrar} className="btn-ghost btn-sm inline-flex items-center gap-1.5">
                {mostrar ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />} {mostrar ? 'Esconder valores' : 'Mostrar valores'}
              </button>
            </div>
            {view.counts.length > 0 ? (
              <ContagemTabela rows={view.counts} valor={valor} />
            ) : (
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {COUNT_GROUPS.map((g) => (
                  <div key={g} className="rounded-lg border border-border p-3">
                    <dt className="text-xs text-muted-foreground">{COUNT_GROUP_LABEL[g]}</dt>
                    <dd className={`mt-1 text-base font-semibold tabular-nums ${mostrar && view.expected![g] < 0 ? 'text-destructive' : ''}`}>{valor(view.expected![g])}</dd>
                  </div>
                ))}
              </dl>
            )}
            {view.summary && (
              <p className="mt-3 text-xs text-muted-foreground">
                Troco inicial {valor(view.openingCents)} · recebimentos {valor(view.summary.receipts)} · pagamentos {valor(view.summary.payments)} · reforços {valor(view.summary.reinforcements)} · sangrias {valor(view.summary.withdrawals)}
                {view.summary.reversals !== 0 && <> · estornos {valor(view.summary.reversals)}</>}
              </p>
            )}
            {view.closingNote && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <strong>Justificativa da diferença:</strong> {view.closingNote}
              </p>
            )}
          </>
        ) : (
          <p className="rounded-lg bg-surface-alt p-3 text-sm text-muted-foreground">A clínica usa conferência cega: os totais aparecem depois que você contar e fechar o caixa.</p>
        )}

        <h3 className="mt-6 text-sm font-semibold">Movimentos do caixa</h3>
        {view.movements.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhum movimento ainda. O que você receber com o caixa aberto aparece aqui.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Movimentos do caixa nº {view.code}</caption>
              <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">Nº</th>
                  <th scope="col" className="px-3 py-2">Hora</th>
                  <th scope="col" className="px-3 py-2">Lançamento</th>
                  <th scope="col" className="px-3 py-2">Meio</th>
                  <th scope="col" className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 font-mono text-xs">{m.code}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{view.daysOpen > 0 || !aberto ? dataHora(m.at) : hora(m.at)}</td>
                    <td className="max-w-[20rem] px-3 py-2">
                      <p className="truncate font-medium">
                        {m.party || TIPO[m.kind]} {m.reversed && <Badge>Estornado</Badge>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.party ? `${TIPO[m.kind]}${m.description ? ` · ${m.description}` : ''}` : m.description === TIPO[m.kind] ? '' : m.description}
                      </p>
                    </td>
                    <td className="px-3 py-2">{m.methodName || (m.methodKind === 'CASH' ? 'Dinheiro' : '')}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${m.reversed ? 'line-through' : m.signedCents < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'}`}>{formatCents(m.signedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {movimento && <MovimentoDialog kind={movimento} sessionId={view.id} accounts={accounts.filter((a) => a.id !== view.accountId)} onClose={() => setMovimento(null)} />}
      {fechar && <FecharDialog view={view} canManage={canManage} onClose={() => setFechar(false)} />}
    </section>
  );
}

function ContagemTabela({ rows, valor }: { rows: CountRow[]; valor: (c: number) => string }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">Esperado e contado por meio de pagamento</caption>
        <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2">Meio</th>
            <th scope="col" className="px-3 py-2 text-right">Esperado</th>
            <th scope="col" className="px-3 py-2 text-right">Contado</th>
            <th scope="col" className="px-3 py-2 text-right">Diferença</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.group}>
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {COUNT_GROUP_LABEL[r.group]}
              </th>
              <td className="px-3 py-2 text-right tabular-nums">{valor(r.expected)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{valor(r.counted)}</td>
              <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.diff === 0 ? 'text-muted-foreground' : 'text-destructive'}`}>{r.diff === 0 ? 'Bateu' : valor(r.diff)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Reforço e sangria ───────────────────────────────────────────────────────

function MovimentoDialog({ kind, sessionId, accounts, onClose }: { kind: 'REINFORCEMENT' | 'WITHDRAWAL'; sessionId: string; accounts: Conta[]; onClose: () => void }) {
  const router = useRouter();
  const sangria = kind === 'WITHDRAWAL';
  const [valor, setValor] = useState(0);
  const [conta, setConta] = useState('');
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const salvar = () =>
    start(async () => {
      setErro('');
      if (valor <= 0) return setErro('Informe o valor.');
      const r = await cashMoveAction({ sessionId, kind, amountCents: valor, otherAccountId: conta || null, description: nota || null });
      if (!r.ok) return setErro(r.message);
      onClose();
      router.refresh();
    });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={sangria ? 'Sangria' : 'Reforço'}
      description={sangria ? 'Tirar dinheiro do caixa por segurança, para o cofre ou para o banco.' : 'Colocar dinheiro no caixa para ter troco.'}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <Field label="Valor">{(id) => <MoneyInput id={id} value={valor} onChange={setValor} />}</Field>
        <Field label={sangria ? 'Para onde vai' : 'De onde veio'} hint={sangria ? 'Escolhendo uma conta, o valor entra nela como transferência.' : 'Escolhendo uma conta, o valor sai dela como transferência.'}>
          {(id) => (
            <select id={id} value={conta} onChange={(e) => setConta(e.target.value)} className={inputCls}>
              <option value="">{sangria ? 'Só registrar a retirada' : 'Só registrar a entrada'}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Observação (opcional)">{(id) => <input id={id} maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls} />}</Field>
        <ErrorText>{erro}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline btn-md">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="btn-primary btn-md">
            {pending ? 'Salvando…' : sangria ? 'Registrar sangria' : 'Registrar reforço'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Fechar ──────────────────────────────────────────────────────────────────

function FecharDialog({ view, canManage, onClose }: { view: CashView; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  // Cega: o esperado não veio do servidor. Com contagem já registrada, vale ela.
  const cega = view.blind && !canManage;
  const registrada = view.pendingCount ? view.counts : null;
  const inicial: Counted = registrada
    ? (Object.fromEntries(registrada.map((r) => [r.group, r.counted])) as Counted)
    : view.expected && !cega
      ? { ...view.expected, CASH: 0 }
      : { ...ZERO_COUNT };
  const [contado, setContado] = useState<Counted>(inicial);
  const [linhas, setLinhas] = useState<CountRow[] | null>(registrada);
  const [travado, setTravado] = useState(Boolean(registrada) && !canManage);
  const [recontar, setRecontar] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  // Sem conferência cega, a diferença aparece enquanto a pessoa digita.
  const aoVivo = !cega && view.expected ? countRows(view.expected, contado) : null;
  const mostradas = travado ? linhas : (aoVivo ?? linhas);
  const temDiferenca = Boolean(mostradas?.some((r) => r.diff !== 0));

  const enviar = () =>
    start(async () => {
      setErro('');
      const r = await closeCashAction({ sessionId: view.id, counted: contado, justification: justificativa || null, recount: recontar });
      if (r.ok) {
        // A página do caixa fechado mostra o resultado, a conferência e o relatório.
        router.push(`/financeiro/caixa/${view.id}?fechado=1`);
        onClose();
        return;
      }
      if (r.rows) setLinhas(r.rows);
      // Cega: a contagem ficou registrada; daqui em diante só entra a justificativa.
      if (r.code === 'NEEDS_JUSTIFICATION' && cega) setTravado(true);
      setErro(r.message);
    });

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Fechar o caixa nº ${view.code}`} description={`${view.userName} · aberto em ${dataHora(view.openedAt)}`} size="lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          <p className="text-sm text-muted-foreground">
            {travado
              ? 'Sua contagem já está registrada. Como não bateu com o esperado, escreva a justificativa para fechar.'
              : cega
                ? 'Conte o que há em cada meio e digite os valores. O esperado aparece depois.'
                : 'Conte o dinheiro da gaveta e confira os outros meios com a maquininha e o extrato.'}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Conferência por meio de pagamento</caption>
              <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">Meio</th>
                  {mostradas && (
                    <th scope="col" className="px-3 py-2 text-right">
                      Esperado
                    </th>
                  )}
                  <th scope="col" className="px-3 py-2 text-right">Contado</th>
                  {mostradas && (
                    <th scope="col" className="px-3 py-2 text-right">
                      Diferença
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {COUNT_GROUPS.map((g) => {
                  const r = mostradas?.find((x) => x.group === g);
                  return (
                    <tr key={g}>
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        {COUNT_GROUP_LABEL[g]}
                      </th>
                      {mostradas && <td className="px-3 py-2 text-right tabular-nums">{r ? formatCents(r.expected) : ''}</td>}
                      <td className="px-3 py-1.5">
                        {travado ? (
                          <p className="text-right tabular-nums">{formatCents(r?.counted ?? contado[g])}</p>
                        ) : (
                          <MoneyInput ariaLabel={`Contado em ${COUNT_GROUP_LABEL[g]}`} value={contado[g]} onChange={(c) => setContado((v) => ({ ...v, [g]: c }))} className="ml-auto max-w-[10rem]" />
                        )}
                      </td>
                      {mostradas && <td className={`px-3 py-2 text-right font-semibold tabular-nums ${!r || r.diff === 0 ? 'text-muted-foreground' : 'text-destructive'}`}>{!r || r.diff === 0 ? 'Bateu' : formatCents(r.diff)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {registrada && canManage && !recontar && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setRecontar(true);
                setTravado(false);
              }}
            >
              Refazer a contagem
            </button>
          )}
          {(temDiferenca || travado) && (
            <Field label="Justificativa da diferença" hint={`${justificativa.length}/500`}>
              {(id) => <textarea id={id} rows={2} maxLength={500} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} className={`${inputCls} h-auto py-2`} />}
            </Field>
          )}
          <ErrorText>{erro}</ErrorText>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-outline btn-md">
              Voltar
            </button>
            <button type="submit" disabled={pending} className="btn-primary btn-md">
              {pending ? 'Fechando…' : 'Fechar caixa'}
            </button>
          </div>
        </form>
    </Modal>
  );
}

// ─── Avisos e listas ─────────────────────────────────────────────────────────

export function CashAlertsPanel({ alerts, canManage }: { alerts: CashAlerts; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (alerts.openLong.length === 0 && alerts.withDifference.length === 0) return null;
  return (
    <div role="region" aria-label="Avisos do caixa" className="mb-5 space-y-2">
      {alerts.openLong.map((c) => (
        <p key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {c.mine ? 'Seu caixa' : `O caixa de ${c.userName}`} nº {c.code} está aberto há {c.daysOpen} {c.daysOpen === 1 ? 'dia' : 'dias'}.
          </span>
          {!c.mine && (
            <Link href={`/financeiro/caixa/${c.id}`} className="font-medium underline underline-offset-2">
              Ver
            </Link>
          )}
        </p>
      ))}
      {alerts.withDifference.map((c) => (
        <p key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            O caixa nº {c.code} de {c.userName} fechou com diferença de {formatCents(c.differenceCents)}
            {c.closedAt ? ` em ${dataHora(c.closedAt)}` : ''}.
          </span>
          <Link href={`/financeiro/caixa/${c.id}`} className="font-medium underline underline-offset-2">
            Ver
          </Link>
          {canManage && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await markCashSeenAction(c.id);
                  router.refresh();
                })
              }
              className="font-medium underline underline-offset-2"
            >
              Marcar como visto
            </button>
          )}
        </p>
      ))}
    </div>
  );
}

export function CashTable({ rows, caption, closed = false }: { rows: CashListRow[]; caption: string; closed?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-alt/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2.5">Nº</th>
            <th scope="col" className="px-3 py-2.5">De quem</th>
            <th scope="col" className="px-3 py-2.5">Aberto em</th>
            <th scope="col" className="px-3 py-2.5">{closed ? 'Fechado em' : 'Há quanto tempo'}</th>
            {closed && (
              <th scope="col" className="px-3 py-2.5 text-right">
                Diferença
              </th>
            )}
            <th scope="col" className="px-3 py-2.5">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-surface-alt/40">
              <td className="px-3 py-2 font-mono text-xs font-semibold">{c.code}</td>
              <td className="px-3 py-2">
                <p className="font-medium">{c.userName}</p>
                {c.unitName && <p className="text-xs text-muted-foreground">{c.unitName}</p>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dataHora(c.openedAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {closed ? (c.closedAt ? dataHora(c.closedAt) : '') : c.daysOpen === 0 ? 'Hoje' : `${c.daysOpen} ${c.daysOpen === 1 ? 'dia' : 'dias'}`} {c.tooLong && <Badge tone="amber">Aberto há muito tempo</Badge>}
              </td>
              {closed && <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${c.hasDifference ? 'text-destructive' : 'text-muted-foreground'}`}>{c.hasDifference ? formatCents(c.differenceCents) : 'Bateu'}</td>}
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <Link href={`/financeiro/caixa/${c.id}`} className="btn-outline btn-sm" aria-label={`Ver o caixa nº ${c.code}`}>
                  Ver
                </Link>
                {closed && (
                  <a href={`/financeiro/caixa/${c.id}/relatorio`} target="_blank" rel="noopener" className="btn-ghost btn-sm ml-1" aria-label={`Relatório do caixa nº ${c.code}`}>
                    Relatório
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
