'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Badge, ErrorText } from '@/components/fin/ui';
import { formatCents } from '@/lib/financeiro/money';
import { instantDateTimeShortBR } from '@/lib/tz';
import { decideRelease, listReleases, type ReleaseRow } from '../../fin-actions';

/**
 * Pedidos de liberação: alguém da equipe quer passar do próprio limite
 * (desconto maior, tirar juros de uma conta vencida) e um dono ou
 * administrador aprova ou nega aqui. A tela se atualiza sozinha.
 */
export function ReleasesView({ canDecide }: { canDecide: boolean }) {
  const [rows, setRows] = useState<ReleaseRow[] | null>(null);
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();

  const carregar = useCallback(async () => setRows(await listReleases()), []);
  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 10_000);
    return () => clearInterval(t);
  }, [carregar]);

  const decidir = (id: string, aprova: boolean) =>
    start(async () => {
      setErro('');
      const r = await decideRelease(id, aprova);
      if (!r.ok) setErro(r.message);
      await carregar();
    });

  const esperando = rows?.filter((r) => r.status === 'PENDING' && !r.expired) ?? [];
  const antigos = rows?.filter((r) => r.status !== 'PENDING' || r.expired) ?? [];
  const oQue = (r: ReleaseRow) =>
    r.kind === 'DISCOUNT' ? `Desconto de ${formatCents(r.amountCents)} numa conta de ${formatCents(r.openCents)} (${r.openCents ? ((r.amountCents / r.openCents) * 100).toFixed(1).replace('.', ',') : '0'}%)` : `Tirar juros e multa de uma conta de ${formatCents(r.openCents)}`;

  return (
    <div className="space-y-6">
      <section aria-labelledby="lib-esperando">
        <h2 id="lib-esperando" className="text-base font-semibold">
          Esperando resposta
        </h2>
        <ErrorText>{erro}</ErrorText>
        {rows === null ? (
          <p className="mt-2 text-sm text-muted-foreground">Carregando…</p>
        ) : esperando.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-muted-foreground">Nenhum pedido esperando. Quando alguém pedir uma liberação, aparece aqui na hora.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {esperando.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-card">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{oQue(r)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.requestedBy} pediu às {instantDateTimeShortBR(r.createdAt).slice(-5)}
                    {r.party ? ` · ${r.party}` : ''}
                    {r.titleCode ? ` · conta nº ${r.titleCode}` : ''}
                  </p>
                </div>
                {canDecide && (
                  <div className="flex gap-2">
                    <button type="button" disabled={pending} onClick={() => decidir(r.id, false)} className="btn-outline btn-md">
                      Negar
                    </button>
                    <button type="button" disabled={pending} onClick={() => decidir(r.id, true)} className="btn-primary btn-md">
                      Liberar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {antigos.length > 0 && (
        <section aria-labelledby="lib-antigos">
          <h2 id="lib-antigos" className="text-base font-semibold">
            Últimos 7 dias
          </h2>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface shadow-card">
            {antigos.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {oQue(r)} <span className="text-muted-foreground">· {r.requestedBy}</span>
                </span>
                <span className="text-xs text-muted-foreground">{instantDateTimeShortBR(r.createdAt)}</span>
                {r.expired ? <Badge>Venceu sem resposta</Badge> : r.status === 'APPROVED' ? <Badge tone="green">Liberado{r.decidedBy ? ` por ${r.decidedBy}` : ''}</Badge> : <Badge tone="red">Negado{r.decidedBy ? ` por ${r.decidedBy}` : ''}</Badge>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
