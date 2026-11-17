'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { AdOriginRow } from '@/crm/origin';
import { setAdTopicAction } from '../actions';

/**
 * O assunto de cada anúncio que trouxe leads (implante, prótese, carga
 * imediata). Sai do nome da campanha ou do anúncio; o gestor pode trocar, e a
 * troca vale para os leads que já vieram dele. Nunca depende do que o
 * paciente escreve.
 */

const DE_ONDE: Record<NonNullable<AdOriginRow['topicFrom']>, string> = {
  AD: 'escolhido para este anúncio',
  CAMPAIGN: 'escolhido para a campanha',
  AUTO: 'achado no nome do anúncio',
};

export function AdTopics({ rows, procedures, canManage }: { rows: AdOriginRow[]; procedures: { id: string; name: string }[]; canManage: boolean }) {
  if (!rows.length) {
    return (
      <section aria-labelledby="assuntos-t" className="viz-card space-y-1.5 p-5">
        <h2 id="assuntos-t" className="text-base font-semibold">Assunto de cada anúncio</h2>
        <p className="text-sm text-muted-foreground">
          Quando alguém tocar em &quot;Enviar mensagem&quot; num anúncio do Facebook ou do Instagram, o lead aparece aqui com o anúncio de onde veio.
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="assuntos-t" className="viz-card p-5">
      <h2 id="assuntos-t" className="text-base font-semibold">Assunto de cada anúncio</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        O assunto aparece no card do lead e vira filtro no funil. Ele vem do anúncio e não muda com o que o paciente escreve.
        {canManage ? ' Se estiver errado, escolha o certo: vale também para os leads que já vieram.' : ''}
      </p>
      <ul className="mt-4 divide-y divide-border">
        {rows.map((r) => (
          <AdRow key={r.adId} row={r} procedures={procedures} canManage={canManage} />
        ))}
      </ul>
    </section>
  );
}

function AdRow({ row: r, procedures, canManage }: { row: AdOriginRow; procedures: { id: string; name: string }[]; canManage: boolean }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(r.topic ?? '');
  const [proc, setProc] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, start] = useTransition();
  const nome = r.adName ?? r.headline ?? `Anúncio ${r.adId}`;

  const salvar = (scope: 'AD' | 'CAMPAIGN', topic: string) =>
    start(async () => {
      const externalId = scope === 'AD' ? r.adId : r.campaignId;
      if (!externalId) return;
      const res = await setAdTopicAction({ scope, externalId, topic, procedureId: proc || null });
      if (!res.ok) return setAviso({ ok: false, texto: res.message });
      setAviso({ ok: true, texto: topic ? `Salvo. ${res.leads} lead(s) atualizado(s).` : 'Assunto tirado.' });
      setEditando(false);
    });

  return (
    <li className="flex flex-wrap items-start gap-3 py-3">
      {r.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura da Meta, endereço externo que muda
        <img src={r.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span className="h-12 w-12 shrink-0 rounded bg-surface-alt" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{nome}</p>
        {r.campaignName && <p className="truncate text-xs text-muted-foreground">Campanha: {r.campaignName}</p>}
        <p className="text-xs text-muted-foreground">
          <Link href={`/crm/leads?anuncio=${r.adId}&situacao=todos`} className="text-link underline-offset-2 hover:underline">
            {r.leads} lead{r.leads === 1 ? '' : 's'}
          </Link>
          {' · '}
          {r.topic ? (
            <>
              <strong className="font-medium text-foreground">{r.topic}</strong>
              {r.topicFrom && <span> ({DE_ONDE[r.topicFrom]})</span>}
            </>
          ) : (
            <span>sem assunto</span>
          )}
        </p>
        {aviso && <p className={`text-xs ${aviso.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>{aviso.texto}</p>}
        {editando && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`assunto-${r.adId}`} className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Assunto</label>
              <input
                id={`assunto-${r.adId}`}
                list={`assuntos-${r.adId}`}
                value={texto}
                maxLength={60}
                onChange={(e) => {
                  setTexto(e.target.value);
                  setProc(procedures.find((p) => p.name.toLowerCase() === e.target.value.trim().toLowerCase())?.id ?? '');
                }}
                placeholder="Ex.: Carga imediata"
                className="mt-1 h-9 w-56 rounded-md border border-border bg-background px-2.5 text-sm"
              />
              <datalist id={`assuntos-${r.adId}`}>
                {procedures.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </div>
            <button type="button" disabled={pending || !texto.trim()} onClick={() => salvar('AD', texto)} className="btn-primary btn-sm">
              Salvar neste anúncio
            </button>
            {r.campaignId && (
              <button type="button" disabled={pending || !texto.trim()} onClick={() => salvar('CAMPAIGN', texto)} className="btn-outline btn-sm">
                Salvar na campanha toda
              </button>
            )}
            {r.topicFrom === 'AD' && (
              <button type="button" disabled={pending} onClick={() => salvar('AD', '')} className="btn-ghost btn-sm">
                Tirar o escolhido
              </button>
            )}
            <button type="button" disabled={pending} onClick={() => setEditando(false)} className="btn-ghost btn-sm">
              Cancelar
            </button>
          </div>
        )}
      </div>
      {canManage && !editando && (
        <button type="button" onClick={() => setEditando(true)} className="btn-outline btn-sm shrink-0">
          {r.topic ? 'Trocar assunto' : 'Escolher assunto'}
        </button>
      )}
    </li>
  );
}
