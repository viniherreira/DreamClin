'use client';

import { useEffect, useState, useTransition } from 'react';
import { reverseAction, reverseContext } from '@/app/(app)/financeiro/fin-actions';
import { formatCents } from '@/lib/financeiro/money';
import { ErrorText, Field, inputCls, Modal } from './ui';

type Ctx = NonNullable<Awaited<ReturnType<typeof reverseContext>>>;

const TIPO: Record<string, string> = { RECEIPT: 'Recebimento', PAYMENT: 'Pagamento', FEE: 'Taxa de cartão', REINFORCEMENT: 'Reforço', WITHDRAWAL: 'Sangria' };

/**
 * Estornar um movimento. Pede o motivo, mostra o que vai junto (a taxa do
 * cartão sempre; os outros meios do mesmo recebimento, se a pessoa marcar) e
 * avisa quando o estorno deixa uma parcela anterior do orçamento em aberto.
 */
export function ReverseDialog({ transactionId, open, onOpenChange, onDone }: { transactionId: string | null; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [motivo, setMotivo] = useState('');
  const [junto, setJunto] = useState<string[]>([]);
  const [foraDeOrdem, setForaDeOrdem] = useState(false);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || !transactionId) return;
    setCtx(null);
    setMotivo('');
    setJunto([]);
    setForaDeOrdem(false);
    setErro('');
    let vivo = true;
    void reverseContext(transactionId).then((c) => {
      if (vivo) setCtx(c);
    });
    return () => {
      vivo = false;
    };
  }, [open, transactionId]);

  const salvar = () =>
    start(async () => {
      if (!ctx) return;
      setErro('');
      const r = await reverseAction({ transactionId: ctx.id, reason: motivo, alsoIds: junto, confirmOutOfOrder: foraDeOrdem });
      if (!r.ok) {
        if (r.code === 'OUT_OF_ORDER') setForaDeOrdem(true);
        return setErro(r.message);
      }
      onDone();
      onOpenChange(false);
    });

  const escolhiveis = ctx?.related.filter((r) => !r.automatic) ?? [];
  const automaticos = ctx?.related.filter((r) => r.automatic) ?? [];

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Estornar" description={ctx ? `${TIPO[ctx.kind] ?? 'Movimento'} nº ${ctx.code} · ${formatCents(ctx.amountCents)}` : undefined}>
      {!ctx ? (
        <p className="py-4 text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <p className="text-sm text-muted-foreground">O estorno não apaga nada: cria um lançamento contrário, reabre a conta e fica registrado com o seu nome.</p>
          <Field label="Motivo" hint={`${motivo.length}/150`}>
            {(id) => <textarea id={id} required autoFocus maxLength={150} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={`${inputCls} h-auto py-2`} />}
          </Field>
          {automaticos.length > 0 && (
            <p className="text-sm">
              Vai junto: {automaticos.map((a) => `${a.description ?? TIPO[a.kind] ?? 'movimento'} (${formatCents(a.amountCents)})`).join(', ')}.
            </p>
          )}
          {escolhiveis.length > 0 && (
            <fieldset>
              <legend className="text-sm font-medium">Outros lançamentos do mesmo recebimento</legend>
              <div className="mt-2 space-y-1.5">
                {escolhiveis.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={junto.includes(r.id)} onChange={(e) => setJunto(e.target.checked ? [...junto, r.id] : junto.filter((x) => x !== r.id))} />
                    {TIPO[r.kind] ?? 'Movimento'} nº {r.code} · {formatCents(r.amountCents)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {foraDeOrdem && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked readOnly /> Entendi que uma parcela anterior do orçamento vai ficar em aberto. Clique em Estornar de novo para confirmar.
            </label>
          )}
          <ErrorText>{erro}</ErrorText>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="btn-outline btn-md">
              Voltar
            </button>
            <button type="submit" disabled={pending || motivo.trim().length < 3} className="btn-danger btn-md">
              {pending ? 'Estornando…' : 'Estornar'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
