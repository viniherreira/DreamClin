'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { FileDown, Paperclip, Trash2, Undo2 } from 'lucide-react';
import { attachmentUrl, deleteTitleAttachment, uploadTitleAttachment } from '../../fin-extra-actions';
import { ReverseDialog } from '@/components/fin/reverse-dialog';
import { Badge, ErrorText, Field, inputCls, Modal, MoneyInput } from '@/components/fin/ui';
import { competenceBR, dayBR } from '@/lib/financeiro/dates';
import { ORIGIN_LABEL } from '@/lib/financeiro/defaults';
import { formatCents } from '@/lib/financeiro/money';
import { TITLE_STATUS_LABEL, type TitleDisplay } from '@/lib/financeiro/title-status';
import { cancelTitleAction, getTitle, updateTitleAction, type TitleDetail } from '../../fin-actions';
import type { FinOptions } from './types';

const TOM: Record<TitleDisplay, 'gray' | 'green' | 'amber' | 'red' | 'blue'> = { OPEN: 'blue', PARTIAL: 'amber', PAID: 'green', CANCELLED: 'gray', RENEGOTIATED: 'gray', OVERDUE: 'red' };

export const StatusBadge = ({ display }: { display: TitleDisplay }) => <Badge tone={TOM[display]}>{TITLE_STATUS_LABEL[display]}</Badge>;

/** Para onde leva a origem de um título. */
export function originHref(t: { origin: string; quoteId: string | null; patientId: string | null }): string | null {
  if (t.quoteId) return `/orcamentos/${t.quoteId}`;
  if (t.origin === 'MANUAL' && t.patientId) return `/pacientes/${t.patientId}`;
  return null;
}

/**
 * Detalhe de uma conta: os dados, os pagamentos (com recibo e estorno) e as
 * ações de editar e cancelar.
 */
export function TitleDetailDialog({
  titleId,
  open,
  onOpenChange,
  options,
  canReverse,
  onChanged,
  onSettle,
}: {
  titleId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  options: FinOptions;
  canReverse: boolean;
  onChanged: () => void;
  onSettle: (id: string) => void;
}) {
  const [t, setT] = useState<TitleDetail | null>(null);
  const [modo, setModo] = useState<'ver' | 'editar' | 'cancelar'>('ver');
  const [form, setForm] = useState({ categoryId: '', dueDate: '', competence: '', amountCents: 0, documentNumber: '', description: '', accountId: '', methodId: '' });
  const [escopo, setEscopo] = useState<'one' | 'following'>('one');
  const [motivo, setMotivo] = useState('');
  const [estornar, setEstornar] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const carregar = async (id: string) => {
    const d = await getTitle(id);
    setT(d);
    if (d) setForm({ categoryId: d.categoryId, dueDate: d.dueDate, competence: d.competence, amountCents: d.amountCents, documentNumber: d.documentNumber ?? '', description: d.description ?? '', accountId: d.accountId ?? '', methodId: d.methodId ?? '' });
  };
  useEffect(() => {
    if (!open || !titleId) return;
    setT(null);
    setModo('ver');
    setErro('');
    setMotivo('');
    setEscopo('one');
    void carregar(titleId);
  }, [open, titleId]);

  const salvar = () =>
    start(async () => {
      if (!t) return;
      setErro('');
      const r = await updateTitleAction({
        id: t.id,
        scope: escopo,
        categoryId: form.categoryId,
        dueDate: form.dueDate,
        competence: form.competence,
        ...(t.paidCents === 0 ? { amountCents: form.amountCents } : {}),
        documentNumber: form.documentNumber || null,
        description: form.description || null,
        accountId: form.accountId || null,
        methodId: form.methodId || null,
      });
      if (!r.ok) return setErro(r.message);
      await carregar(t.id);
      setModo('ver');
      onChanged();
    });

  const cancelar = () =>
    start(async () => {
      if (!t) return;
      setErro('');
      const r = await cancelTitleAction(t.id, motivo, escopo);
      if (!r.ok) return setErro(r.message);
      onChanged();
      onOpenChange(false);
    });

  const anexar = (file: File | undefined) =>
    start(async () => {
      if (!t || !file) return;
      setErro('');
      const fd = new FormData();
      fd.set('file', file);
      const r = await uploadTitleAttachment(t.id, fd);
      if (!r.ok) return setErro(r.message);
      await carregar(t.id);
    });
  const abrirAnexo = (id: string) =>
    start(async () => {
      const url = await attachmentUrl(id);
      if (url) window.open(url, '_blank', 'noopener');
      else setErro('Não foi possível abrir o anexo.');
    });
  const tirarAnexo = (id: string, nome: string) => {
    if (!confirm(`Remover o anexo "${nome}"?`)) return;
    start(async () => {
      const r = await deleteTitleAttachment(id);
      if (!r.ok) return setErro(r.message);
      if (t) await carregar(t.id);
    });
  };

  const aberto = t && (t.status === 'OPEN' || t.status === 'PARTIAL');
  const cats = options.categories.filter((c) => c.parentId && c.direction === t?.direction);
  const link = t ? originHref(t) : null;
  const escolheEscopo = t?.recurring && (
    <fieldset className="text-sm">
      <legend className="font-medium">Este lançamento se repete</legend>
      <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="escopo" className="h-4 w-4" checked={escopo === 'one'} onChange={() => setEscopo('one')} /> Só este
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="escopo" className="h-4 w-4" checked={escopo === 'following'} onChange={() => setEscopo('following')} /> Este e os próximos
        </label>
      </div>
    </fieldset>
  );

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title={t ? `Conta nº ${t.code}` : 'Conta'} description={t ? `${t.direction === 'RECEIVABLE' ? 'A receber' : 'A pagar'}${t.party ? ` · ${t.party}` : ''}` : undefined} size="lg">
        {!t ? (
          <p className="py-4 text-sm text-muted-foreground">Carregando…</p>
        ) : modo === 'editar' ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              salvar();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Categoria">
                {(id) => (
                  <select id={id} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className={inputCls}>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Valor" hint={t.paidCents > 0 ? 'Com pagamento, o valor não muda. Estorne o pagamento primeiro.' : undefined}>
                {(id) => <MoneyInput id={id} disabled={t.paidCents > 0} value={form.amountCents} onChange={(c) => setForm({ ...form, amountCents: c })} />}
              </Field>
              <Field label="Vencimento">{(id) => <input id={id} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={inputCls} />}</Field>
              <Field label="Mês de competência">{(id) => <input id={id} type="month" value={form.competence} onChange={(e) => setForm({ ...form, competence: e.target.value })} className={inputCls} />}</Field>
              <Field label="Forma de pagamento">
                {(id) => (
                  <select id={id} value={form.methodId} onChange={(e) => setForm({ ...form, methodId: e.target.value })} className={inputCls}>
                    <option value="">A definir</option>
                    {options.methods
                      .filter((m) => m.kind !== 'WALLET')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
              <Field label="Conta">
                {(id) => (
                  <select id={id} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} className={inputCls}>
                    <option value="">A definir</option>
                    {options.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Nº do documento">{(id) => <input id={id} maxLength={60} value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value })} className={inputCls} />}</Field>
              <Field label="Descrição" className="sm:col-span-2">
                {(id) => <input id={id} maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />}
              </Field>
            </div>
            {escolheEscopo}
            <ErrorText>{erro}</ErrorText>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => (setModo('ver'), setErro(''))} className="btn-outline btn-md">
                Voltar
              </button>
              <button type="submit" disabled={pending} className="btn-primary btn-md">
                {pending ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        ) : modo === 'cancelar' ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              cancelar();
            }}
          >
            <p className="text-sm text-muted-foreground">A conta sai das listas de aberto e fica registrada como cancelada, com o motivo.</p>
            <Field label="Motivo do cancelamento" hint={`${motivo.length}/150`}>
              {(id) => <textarea id={id} required autoFocus maxLength={150} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={`${inputCls} h-auto py-2`} />}
            </Field>
            {escolheEscopo}
            <ErrorText>{erro}</ErrorText>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => (setModo('ver'), setErro(''))} className="btn-outline btn-md">
                Voltar
              </button>
              <button type="submit" disabled={pending || motivo.trim().length < 3} className="btn-danger btn-md">
                {pending ? 'Cancelando…' : 'Cancelar a conta'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <Dado rotulo="Situação" valor={<StatusBadge display={t.display} />} />
              <Dado rotulo="Valor" valor={formatCents(t.amountCents)} />
              <Dado rotulo={t.direction === 'RECEIVABLE' ? 'Recebido' : 'Pago'} valor={formatCents(t.paidCents)} />
              <Dado rotulo="Em aberto" valor={<strong>{formatCents(t.openCents)}</strong>} />
              <Dado rotulo="Vencimento" valor={dayBR(t.dueDate)} />
              <Dado rotulo="Emissão" valor={dayBR(t.issueDate)} />
              <Dado rotulo="Competência" valor={competenceBR(t.competence)} />
              <Dado rotulo="Parcela" valor={t.installment ?? (t.recurring ? 'Recorrente' : 'Única')} />
              <Dado rotulo="Categoria" valor={t.category} />
              <Dado rotulo="Conta" valor={t.account ?? 'A definir'} />
              <Dado rotulo="Forma" valor={t.method ?? 'A definir'} />
              <Dado rotulo="Origem" valor={link ? <Link href={link} className="font-medium text-primary underline-offset-2 hover:underline">{ORIGIN_LABEL[t.origin as keyof typeof ORIGIN_LABEL]}</Link> : ORIGIN_LABEL[t.origin as keyof typeof ORIGIN_LABEL]} />
              {t.costCenter && <Dado rotulo="Centro de custo" valor={t.costCenter} />}
              {t.documentNumber && <Dado rotulo="Documento" valor={t.documentNumber} />}
              {t.createdBy && <Dado rotulo="Lançado por" valor={t.createdBy} />}
            </dl>
            {t.description && <p className="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm">{t.description}</p>}
            {t.cancelReason && <p className="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm">Cancelada: {t.cancelReason}</p>}

            {t.allocations.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Rateio</h3>
                <ul className="mt-1 divide-y divide-border rounded-lg border border-border text-sm">
                  {t.allocations.map((a, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span>
                        {a.category}
                        {a.costCenter ? ` · ${a.costCenter}` : ''}
                      </span>
                      <span className="tabular-nums">{formatCents(a.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold">{t.direction === 'RECEIVABLE' ? 'Recebimentos' : 'Pagamentos'}</h3>
              {t.transactions.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">Nenhum lançamento ainda.</p>
              ) : (
                <ul className="mt-1 divide-y divide-border rounded-lg border border-border text-sm">
                  {t.transactions.map((m) => (
                    <li key={m.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${m.reversed || m.kind === 'REVERSAL' ? 'text-muted-foreground' : ''}`}>
                      <span className="tabular-nums">{dayBR(m.paidOn)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {m.kind === 'REVERSAL' ? 'Estorno' : m.method}
                        {m.reversed && ` · estornado${m.reverseReason ? `: ${m.reverseReason}` : ''}`}
                        {m.discountCents > 0 && ` · desconto de ${formatCents(m.discountCents)}`}
                      </span>
                      <span className={`tabular-nums ${m.reversed ? 'line-through' : ''}`}>{formatCents(m.kind === 'REVERSAL' ? -m.amountCents : m.amountCents)}</span>
                      {m.kind !== 'REVERSAL' && !m.reversed && t.direction === 'RECEIVABLE' && m.receiptGroupId && (
                        <a href={`/financeiro/recibo/${m.receiptGroupId}`} target="_blank" rel="noopener" aria-label={`Recibo do recebimento de ${dayBR(m.paidOn)}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                          <FileDown className="h-4 w-4" aria-hidden="true" />
                        </a>
                      )}
                      {canReverse && m.kind !== 'REVERSAL' && !m.reversed && (
                        <button type="button" onClick={() => setEstornar(m.id)} aria-label={`Estornar o lançamento de ${dayBR(m.paidOn)}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring">
                          <Undo2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Arquivos</h3>
                <label className="btn-ghost btn-sm inline-flex cursor-pointer items-center gap-1 focus-within:outline-2 focus-within:outline-ring">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" /> Anexar
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={pending} onChange={(e) => (anexar(e.target.files?.[0]), (e.target.value = ''))} />
                </label>
              </div>
              {t.attachments.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">Comprovante, nota ou boleto: JPG, PNG, WEBP ou PDF de até 10 MB.</p>
              ) : (
                <ul className="mt-1 divide-y divide-border rounded-lg border border-border text-sm">
                  {t.attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 px-3 py-1.5">
                      <button type="button" onClick={() => abrirAnexo(a.id)} className="min-w-0 flex-1 truncate text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                        {a.filename}
                      </button>
                      <span className="text-xs text-muted-foreground">{Math.max(1, Math.round(a.sizeBytes / 1024))} KB</span>
                      <button type="button" onClick={() => tirarAnexo(a.id, a.filename)} aria-label={`Remover o anexo ${a.filename}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-alt hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <ErrorText>{erro}</ErrorText>
            <div className="flex flex-wrap justify-end gap-2">
              {aberto && canReverse && t.paidCents === 0 && (
                <button type="button" onClick={() => setModo('cancelar')} className="btn-ghost btn-md text-destructive">
                  Cancelar a conta
                </button>
              )}
              {aberto && (
                <button type="button" onClick={() => setModo('editar')} className="btn-outline btn-md">
                  Editar
                </button>
              )}
              {aberto && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    onSettle(t.id);
                  }}
                  className="btn-primary btn-md"
                >
                  {t.direction === 'RECEIVABLE' ? 'Receber' : 'Pagar'}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
      <ReverseDialog
        transactionId={estornar}
        open={Boolean(estornar)}
        onOpenChange={(o) => !o && setEstornar(null)}
        onDone={() => {
          if (t) void carregar(t.id);
          onChanged();
        }}
      />
    </>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 truncate">{valor}</dd>
    </div>
  );
}
