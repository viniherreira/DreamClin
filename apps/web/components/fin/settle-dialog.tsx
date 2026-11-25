'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { CheckCircle2, FileDown, MessageCircle, Plus, Printer, ShieldQuestion, Trash2 } from 'lucide-react';
import { receiptShare } from '@/app/(app)/financeiro/fin-extra-actions';
import { requestRelease, releaseStatus, settleAction, settleContext, type SettleContext } from '@/app/(app)/financeiro/fin-actions';
import { openCashAction } from '@/app/(app)/financeiro/caixa/cash-actions';
import { cardReceivables, settlementRule, totalFee, totalNet } from '@/lib/financeiro/card';
import { dayBR } from '@/lib/financeiro/dates';
import { METHOD_KIND_LABEL, type MethodKind } from '@/lib/financeiro/defaults';
import { formatCents, percentOf } from '@/lib/financeiro/money';
import { discountPercent, planSettlement } from '@/lib/financeiro/settlement';
import { ErrorText, Field, inputCls, Modal, MoneyInput, PercentInput } from './ui';

import { DateField } from '@/components/ui/date-field';
/**
 * Receber ou pagar uma conta: um ou mais meios no mesmo lançamento, desconto,
 * juros de atraso, troco e recibo. É a mesma tela na agenda, no orçamento, na
 * ficha do paciente e nas Contas.
 */

interface Line {
  key: number;
  methodId: string;
  accountId: string;
  amountCents: number;
  paidOn: string;
  installments: number;
  cardBrand: string;
  nsu: string;
  documentNumber: string;
  checkBank: string;
  checkNumber: string;
  checkHolder: string;
  checkDate: string;
}

type Method = SettleContext['methods'][number];

const GROUPS: { label: string; kinds: MethodKind[] }[] = [
  { label: 'Dinheiro', kinds: ['CASH'] },
  { label: 'PIX', kinds: ['PIX'] },
  { label: 'Cartão', kinds: ['CREDIT_CARD', 'DEBIT_CARD'] },
  { label: 'Cheque', kinds: ['CHECK'] },
  { label: 'Carteira', kinds: ['WALLET'] },
  { label: 'Outros', kinds: ['BOLETO', 'TRANSFER', 'INSURANCE', 'OTHER'] },
];

export interface SettleDone {
  receiptGroupId: string;
  changeCents: number;
  walletCreditCents: number;
  remainingCents: number;
}

export function SettleDialog({ titleId, open, onOpenChange, onDone }: { titleId: string | null; open: boolean; onOpenChange: (o: boolean) => void; onDone?: (r: SettleDone) => void }) {
  const [ctx, setCtx] = useState<SettleContext | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState(0);
  const [surcharge, setSurcharge] = useState(0);
  const [cobraAtraso, setCobraAtraso] = useState(true);
  const [change, setChange] = useState<'RETURN' | 'WALLET'>('RETURN');
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const [feito, setFeito] = useState<SettleDone | null>(null);
  const [troco, setTroco] = useState(0);
  const [liberacao, setLiberacao] = useState<{ id: string | null; kind: 'DISCOUNT' | 'WAIVE_LATE'; status: 'ASK' | 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' } | null>(null);
  const seq = useRef(1);
  const [zap, setZap] = useState('');

  const mandarRecibo = () =>
    start(async () => {
      if (!feito) return;
      setZap('');
      const r = await receiptShare(feito.receiptGroupId);
      if (!r) return setZap('Este paciente não tem um WhatsApp válido no cadastro, ou pediu para não receber mensagens.');
      window.open(`https://wa.me/${r.phone}?text=${encodeURIComponent(r.text)}`, '_blank', 'noopener');
    });

  const receber = ctx?.title.direction !== 'PAYABLE';
  const verbo = receber ? 'Receber' : 'Pagar';

  const novaLinha = (c: SettleContext, amountCents: number, methodId?: string): Line => {
    const forma = c.methods.find((m) => m.id === (methodId ?? c.title.methodId)) ?? c.methods.find((m) => m.kind === 'PIX') ?? c.methods[0];
    return {
      key: seq.current++,
      methodId: forma?.id ?? '',
      accountId: contaDe(c, forma),
      amountCents,
      paidOn: c.today,
      installments: 1,
      cardBrand: '',
      nsu: '',
      documentNumber: '',
      checkBank: '',
      checkNumber: '',
      checkHolder: '',
      checkDate: c.today,
    };
  };

  useEffect(() => {
    if (!open || !titleId) return;
    setCtx(null);
    setFeito(null);
    setErro('');
    setLiberacao(null);
    setDiscount(0);
    setSurcharge(0);
    setCobraAtraso(true);
    setChange('RETURN');
    setNota('');
    setCarregando(true);
    // Só vale a resposta deste pedido: uma resposta atrasada de antes não pode
    // apagar o que a pessoa já digitou.
    let vivo = true;
    void settleContext(titleId).then((c) => {
      if (!vivo) return;
      setCarregando(false);
      setCtx(c);
      if (c) setLines([novaLinha(c, c.title.openCents + (c.late ? c.late.fine + c.late.interest : 0))]);
    });
    return () => {
      vivo = false;
    };
  }, [open, titleId]);

  const formaDe = (id: string): Method | undefined => ctx?.methods.find((m) => m.id === id);
  // Dinheiro com o caixa fechado: a pessoa abre o caixa aqui mesmo e segue recebendo.
  const precisaCaixa = Boolean(ctx && receber && ctx.requireOpenCashForCash && !ctx.cashSession && lines.some((l) => formaDe(l.methodId)?.kind === 'CASH' && l.amountCents > 0));
  const abrirCaixa = () =>
    start(async () => {
      setErro('');
      const r = await openCashAction({ openingCents: troco });
      if (!r.ok) return setErro(r.message);
      const c = titleId ? await settleContext(titleId) : null;
      if (!c) return;
      setCtx(c);
      setLines((ls) => ls.map((l) => (c.methods.find((m) => m.id === l.methodId)?.kind === 'CASH' ? { ...l, accountId: contaDe(c, c.methods.find((m) => m.id === l.methodId)) } : l)));
    });
  const interest = ctx?.late && cobraAtraso ? ctx.late.interest : 0;
  const fine = ctx?.late && cobraAtraso ? ctx.late.fine : 0;

  const plano = useMemo(() => {
    if (!ctx) return null;
    return planSettlement({
      open: ctx.title.openCents,
      lines: lines.map((l) => ({ amount: l.amountCents, isCash: ctx.methods.find((m) => m.id === l.methodId)?.kind === 'CASH' })),
      discount,
      surcharge,
      interest,
      fine,
      change,
      walletAvailable: receber && Boolean(ctx.title.patientId),
    });
  }, [ctx, lines, discount, surcharge, interest, fine, change, receber]);

  const totalDue = ctx ? ctx.title.openCents - discount + surcharge + interest + fine : 0;
  const recebido = lines.reduce((s, l) => s + l.amountCents, 0);
  const sobra = recebido - totalDue;
  const acimaDoLimite = ctx ? receber && discountPercent(discount, ctx.title.openCents) > ctx.discountLimitPercent + 1e-9 : false;

  const muda = (key: number, parte: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...parte } : l)));
  const trocaForma = (key: number, methodId: string) => {
    if (!ctx) return;
    const forma = ctx.methods.find((m) => m.id === methodId);
    muda(key, { methodId, accountId: contaDe(ctx, forma), installments: 1 });
  };

  // Quem pediu liberação fica esperando a resposta do dono.
  useEffect(() => {
    if (liberacao?.status !== 'PENDING' || !liberacao.id) return;
    const id = liberacao.id;
    const t = setInterval(async () => {
      const s = await releaseStatus(id);
      if (s && s !== 'PENDING') setLiberacao((l) => (l ? { ...l, status: s } : l));
    }, 4000);
    return () => clearInterval(t);
  }, [liberacao?.status, liberacao?.id]);

  const salvar = (releaseId?: string | null) =>
    start(async () => {
      if (!ctx) return;
      setErro('');
      const r = await settleAction({
        titleId: ctx.title.id,
        expectedOpenCents: ctx.title.openCents,
        lines: lines.map((l) => {
          const k = formaDe(l.methodId)?.kind;
          const cartao = k === 'CREDIT_CARD' || k === 'DEBIT_CARD';
          return {
            methodId: l.methodId,
            accountId: k === 'WALLET' ? null : l.accountId || null,
            amountCents: l.amountCents,
            paidOn: l.paidOn,
            documentNumber: l.documentNumber || null,
            installments: k === 'CREDIT_CARD' ? l.installments : 1,
            cardBrand: cartao ? l.cardBrand || null : null,
            nsu: cartao ? l.nsu || null : null,
            checkBank: k === 'CHECK' ? l.checkBank || null : null,
            checkNumber: k === 'CHECK' ? l.checkNumber || null : null,
            checkHolder: k === 'CHECK' ? l.checkHolder || null : null,
            checkDate: k === 'CHECK' ? l.checkDate || null : null,
          };
        }),
        discountCents: discount,
        surchargeCents: surcharge,
        interestCents: interest,
        fineCents: fine,
        change,
        releaseId: releaseId ?? (liberacao?.status === 'APPROVED' ? liberacao.id : null),
        description: nota || null,
      });
      if (r.ok) {
        const done = { receiptGroupId: r.receiptGroupId, changeCents: r.changeCents, walletCreditCents: r.walletCreditCents, remainingCents: r.remainingCents };
        setFeito(done);
        onDone?.(done);
        return;
      }
      if (r.code === 'NEEDS_RELEASE') {
        setLiberacao({ id: null, kind: acimaDoLimite ? 'DISCOUNT' : 'WAIVE_LATE', status: 'ASK' });
        return;
      }
      if (r.code === 'STALE') {
        const novo = await settleContext(ctx.title.id);
        setCtx(novo);
      }
      setErro(r.message);
    });

  const pedir = () =>
    start(async () => {
      if (!ctx || !liberacao) return;
      const r = await requestRelease({ kind: liberacao.kind, titleId: ctx.title.id, amountCents: liberacao.kind === 'DISCOUNT' ? discount : 0 });
      if (!r.ok) return setErro(r.message);
      setLiberacao({ ...liberacao, id: r.data.id, status: 'PENDING' });
    });

  const titulo = feito ? (receber ? 'Recebimento registrado' : 'Pagamento registrado') : `${verbo}${ctx ? ` · conta nº ${ctx.title.code}` : ''}`;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={titulo} description={ctx ? [ctx.title.party, ctx.title.description].filter(Boolean).join(' · ') : undefined} size="lg">
      {carregando || (!ctx && open && !feito) ? (
        <p className="py-6 text-sm text-muted-foreground">{carregando ? 'Carregando…' : 'Não foi possível abrir esta conta.'}</p>
      ) : feito ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-emerald-50 p-4 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-semibold">{feito.remainingCents > 0 ? `Baixa parcial. Ainda faltam ${formatCents(feito.remainingCents)}.` : 'Conta quitada.'}</p>
              {feito.changeCents > 0 && <p className="mt-1">Troco a devolver: <strong>{formatCents(feito.changeCents)}</strong></p>}
              {feito.walletCreditCents > 0 && <p className="mt-1">{formatCents(feito.walletCreditCents)} guardados como crédito na carteira do paciente.</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {receber && (
              <>
                <a href={`/financeiro/recibo/${feito.receiptGroupId}`} target="_blank" rel="noopener" className="btn-outline btn-md inline-flex items-center gap-1.5">
                  <FileDown className="h-4 w-4" aria-hidden="true" /> Recibo A4
                </a>
                <a href={`/financeiro/recibo/${feito.receiptGroupId}?formato=cupom`} target="_blank" rel="noopener" className="btn-outline btn-md inline-flex items-center gap-1.5">
                  <Printer className="h-4 w-4" aria-hidden="true" /> Cupom 80 mm
                </a>
                {ctx?.title.patientId && (
                  <button type="button" onClick={mandarRecibo} disabled={pending} className="btn-outline btn-md inline-flex items-center gap-1.5">
                    <MessageCircle className="h-4 w-4" aria-hidden="true" /> Mandar pelo WhatsApp
                  </button>
                )}
              </>
            )}
            <button type="button" onClick={() => onOpenChange(false)} className="btn-primary btn-md ml-auto">
              Fechar
            </button>
          </div>
          <ErrorText>{zap}</ErrorText>
        </div>
      ) : ctx ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-surface-alt/60 p-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Vencimento</dt>
              <dd className="font-medium">{dayBR(ctx.title.dueDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Valor</dt>
              <dd className="font-medium tabular-nums">{formatCents(ctx.title.amountCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{receber ? 'Já recebido' : 'Já pago'}</dt>
              <dd className="font-medium tabular-nums">{formatCents(ctx.title.paidCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Em aberto</dt>
              <dd className="font-semibold tabular-nums">{formatCents(ctx.title.openCents)}</dd>
            </div>
          </dl>

          {ctx.late && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <p>
                Vencida há {ctx.late.daysLate} dia(s): multa de {formatCents(ctx.late.fine)} e juros de {formatCents(ctx.late.interest)}.
              </p>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={cobraAtraso} onChange={(e) => setCobraAtraso(e.target.checked)} /> Cobrar
              </label>
            </div>
          )}

          <div className="space-y-3">
            {lines.map((l, i) => {
              const forma = formaDe(l.methodId);
              const k = forma?.kind;
              const cartao = k === 'CREDIT_CARD' || k === 'DEBIT_CARD';
              const previa = forma && cartao && receber && l.amountCents > 0 ? cardReceivables(l.amountCents, k === 'CREDIT_CARD' ? l.installments : 1, forma.fees, l.paidOn, settlementRule(forma.settlementType, forma.settlementValue)) : [];
              return (
                <fieldset key={l.key} className="rounded-lg border border-border p-3">
                  <legend className="px-1 text-xs font-semibold text-muted-foreground">{lines.length > 1 ? `Meio ${i + 1}` : 'Meio de pagamento'}</legend>
                  <div className="grid gap-3 sm:grid-cols-[1fr_9rem_9.5rem_auto]">
                    <Field label="Forma">
                      {(id) => (
                        <select id={id} value={l.methodId} onChange={(e) => trocaForma(l.key, e.target.value)} className={inputCls}>
                          {GROUPS.map((g) => {
                            const itens = ctx.methods.filter((m) => g.kinds.includes(m.kind as MethodKind));
                            return itens.length ? (
                              <optgroup key={g.label} label={g.label}>
                                {itens.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                              </optgroup>
                            ) : null;
                          })}
                        </select>
                      )}
                    </Field>
                    <Field label="Valor">{(id) => <MoneyInput id={id} value={l.amountCents} onChange={(c) => muda(l.key, { amountCents: c })} />}</Field>
                    <Field label="Data">{(id) => <DateField id={id} max={ctx.today} value={l.paidOn} onChange={(v) => muda(l.key, { paidOn: v })} className={inputCls} />}</Field>
                    {lines.length > 1 && (
                      <button type="button" aria-label={`Remover o meio ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="mt-6 self-start rounded-md p-2 text-muted-foreground hover:bg-surface-alt hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {k !== 'WALLET' && ctx.accounts.length > 1 && (
                      <Field label="Conta">
                        {(id) => (
                          <select id={id} value={l.accountId} onChange={(e) => muda(l.key, { accountId: e.target.value })} className={inputCls}>
                            {ctx.accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    )}
                    {k === 'CREDIT_CARD' && (forma?.maxInstallments ?? 1) > 1 && (
                      <Field label="Parcelas">
                        {(id) => (
                          <select id={id} value={l.installments} onChange={(e) => muda(l.key, { installments: Number(e.target.value) })} className={inputCls}>
                            {Array.from({ length: forma!.maxInstallments }, (_, n) => n + 1).map((n) => (
                              <option key={n} value={n}>
                                {n}x
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    )}
                    {cartao && (
                      <>
                        <Field label={`Bandeira${ctx.requireCardData ? '' : ' (opcional)'}`}>{(id) => <input id={id} maxLength={30} value={l.cardBrand} onChange={(e) => muda(l.key, { cardBrand: e.target.value })} className={inputCls} />}</Field>
                        <Field label={`Autorização (NSU)${ctx.requireCardData ? '' : ' (opcional)'}`}>{(id) => <input id={id} maxLength={40} value={l.nsu} onChange={(e) => muda(l.key, { nsu: e.target.value })} className={inputCls} />}</Field>
                      </>
                    )}
                    {k === 'CHECK' && (
                      <>
                        <Field label="Banco">{(id) => <input id={id} maxLength={40} value={l.checkBank} onChange={(e) => muda(l.key, { checkBank: e.target.value })} className={inputCls} />}</Field>
                        <Field label="Número do cheque">{(id) => <input id={id} maxLength={40} value={l.checkNumber} onChange={(e) => muda(l.key, { checkNumber: e.target.value })} className={inputCls} />}</Field>
                        <Field label="Titular">{(id) => <input id={id} maxLength={80} value={l.checkHolder} onChange={(e) => muda(l.key, { checkHolder: e.target.value })} className={inputCls} />}</Field>
                        <Field label="Bom para">{(id) => <DateField id={id} value={l.checkDate} onChange={(v) => muda(l.key, { checkDate: v })} className={inputCls} />}</Field>
                      </>
                    )}
                    {(forma?.requireDocNumber || k === 'PIX' || k === 'TRANSFER' || k === 'BOLETO') && (
                      <Field label={`Nº do documento${forma?.requireDocNumber ? '' : ' (opcional)'}`}>{(id) => <input id={id} maxLength={60} value={l.documentNumber} onChange={(e) => muda(l.key, { documentNumber: e.target.value })} className={inputCls} />}</Field>
                    )}
                  </div>

                  {k === 'WALLET' && (
                    <p className={`mt-2 text-xs ${l.amountCents > ctx.walletCents ? 'text-destructive' : 'text-muted-foreground'}`}>
                      Saldo na carteira: {formatCents(ctx.walletCents)}
                      {l.amountCents > ctx.walletCents ? '. O valor passa do saldo.' : ''}
                    </p>
                  )}
                  {k === 'CASH' && receber && !ctx.cashSession && ctx.requireOpenCashForCash && (
                    <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      <p className="font-medium">Abra o caixa para receber em dinheiro.</p>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <Field label="Troco inicial" className="w-40">
                          {(id) => <MoneyInput id={id} value={troco} onChange={setTroco} />}
                        </Field>
                        <button type="button" onClick={abrirCaixa} disabled={pending} className="btn-primary btn-md">
                          Abrir caixa
                        </button>
                      </div>
                    </div>
                  )}
                  {previa.length > 0 && totalFee(previa) > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Taxa de {formatCents(totalFee(previa))} · líquido previsto de {formatCents(totalNet(previa))} · {previa.length > 1 ? `de ${dayBR(previa[0].expectedDate)} a ${dayBR(previa[previa.length - 1].expectedDate)}` : `cai em ${dayBR(previa[0].expectedDate)}`}
                    </p>
                  )}
                </fieldset>
              );
            })}
            <button type="button" onClick={() => setLines((ls) => [...ls, novaLinha(ctx, Math.max(0, -sobra))])} className="btn-ghost btn-sm inline-flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Adicionar outro meio
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Desconto (R$)" hint={receber && ctx.discountLimitPercent < 100 ? `Seu limite: ${String(ctx.discountLimitPercent).replace('.', ',')}%` : undefined}>
              {(id) => <MoneyInput id={id} value={discount} onChange={setDiscount} />}
            </Field>
            <Field label="Desconto (%)">{(id) => <PercentInput id={id} value={ctx.title.openCents ? Math.round(discountPercent(discount, ctx.title.openCents) * 100) / 100 || null : null} onChange={(v) => setDiscount(percentOf(ctx.title.openCents, v ?? 0))} />}</Field>
            <Field label="Acréscimo (R$)">{(id) => <MoneyInput id={id} value={surcharge} onChange={setSurcharge} />}</Field>
          </div>

          <Field label="Observação (opcional)">{(id) => <input id={id} maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls} />}</Field>

          {sobra > 0 && receber && ctx.title.patientId && plano?.ok && (
            <fieldset className="rounded-lg border border-border p-3 text-sm">
              <legend className="px-1 text-xs font-semibold text-muted-foreground">Sobraram {formatCents(sobra)}</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="troco" className="h-4 w-4" checked={change === 'RETURN'} onChange={() => setChange('RETURN')} /> Devolver de troco
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="troco" className="h-4 w-4" checked={change === 'WALLET'} onChange={() => setChange('WALLET')} /> Guardar como crédito na carteira
                </label>
              </div>
            </fieldset>
          )}

          <dl className="space-y-1 rounded-lg border border-border p-3 text-sm">
            <Resumo rotulo="Em aberto" valor={ctx.title.openCents} />
            {discount > 0 && <Resumo rotulo="Desconto" valor={-discount} />}
            {surcharge > 0 && <Resumo rotulo="Acréscimo" valor={surcharge} />}
            {interest + fine > 0 && <Resumo rotulo="Juros e multa" valor={interest + fine} />}
            <Resumo rotulo={receber ? 'Total a receber' : 'Total a pagar'} valor={totalDue} forte />
            <Resumo rotulo={receber ? 'Recebido agora' : 'Pago agora'} valor={recebido} />
            {sobra < 0 && <Resumo rotulo="Fica em aberto" valor={-sobra} />}
            {sobra > 0 && <Resumo rotulo={change === 'WALLET' ? 'Vai para a carteira' : 'Troco'} valor={sobra} />}
          </dl>

          {liberacao && (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-alt/60 p-3 text-sm">
              <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1" role="status" aria-live="polite">
                {liberacao.status === 'ASK' && <p>{liberacao.kind === 'DISCOUNT' ? 'Este desconto passa do seu limite.' : 'Tirar os juros e a multa precisa de liberação.'} Um dono ou administrador pode liberar na tela dele, em Financeiro › Liberações.</p>}
                {liberacao.status === 'PENDING' && <p>Pedido enviado. Assim que alguém liberar, esta tela avisa.</p>}
                {liberacao.status === 'APPROVED' && <p className="font-medium text-emerald-700 dark:text-emerald-400">Liberado. Pode concluir.</p>}
                {liberacao.status === 'DENIED' && <p className="text-destructive">O pedido foi negado. Ajuste o valor.</p>}
                {liberacao.status === 'EXPIRED' && <p className="text-destructive">O pedido venceu sem resposta. Peça de novo.</p>}
              </div>
              {(liberacao.status === 'ASK' || liberacao.status === 'EXPIRED') && (
                <button type="button" onClick={pedir} disabled={pending} className="btn-outline btn-sm shrink-0">
                  Pedir liberação
                </button>
              )}
            </div>
          )}

          <ErrorText>{erro || (plano && !plano.ok && recebido > 0 ? plano.message : '')}</ErrorText>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="btn-outline btn-md">
              Cancelar
            </button>
            <button type="submit" disabled={pending || !plano?.ok || liberacao?.status === 'PENDING' || precisaCaixa} className="btn-primary btn-md">
              {pending ? 'Salvando…' : `${verbo} ${formatCents(Math.min(recebido, Math.max(totalDue, 0)))}`}
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}

function contaDe(c: SettleContext, forma: Method | undefined): string {
  if (!forma || forma.kind === 'WALLET') return '';
  // Dinheiro com o caixa aberto entra no caixa de quem recebe.
  if (forma.kind === 'CASH' && c.cashSession && c.accounts.some((a) => a.id === c.cashSession!.accountId)) return c.cashSession.accountId;
  const preferida = forma.accountId && c.accounts.some((a) => a.id === forma.accountId) ? forma.accountId : null;
  return preferida ?? c.accounts.find((a) => a.isDefault)?.id ?? c.accounts[0]?.id ?? '';
}

function Resumo({ rotulo, valor, forte }: { rotulo: string; valor: number; forte?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${forte ? 'border-t border-border pt-1 font-semibold' : ''}`}>
      <dt className={forte ? '' : 'text-muted-foreground'}>{rotulo}</dt>
      <dd className="tabular-nums">{formatCents(valor)}</dd>
    </div>
  );
}

export { METHOD_KIND_LABEL };
