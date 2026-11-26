'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, BadgeCheck, Search, Unplug } from 'lucide-react';
import Link from 'next/link';
import {
  chooseGoogleAdsAccountAction,
  disconnectGoogleAdsAction,
  listGoogleAdsAccountsAction,
} from '@/app/(crm)/crm/whatsapp/google-ads-actions';

/**
 * Conectar o Google Ads: o botão leva para a janela do Google e volta para
 * cá. O token nunca passa pela tela; aqui só chegam o nome e o número das
 * contas, para a pessoa escolher qual é a da clínica.
 */

export interface GoogleAdsConnectionView {
  state: 'none' | 'choosing' | 'connected';
  accountId: string | null;
  accountName: string | null;
  connectedAt: string | null;
}

interface Account {
  id: string;
  name: string;
  currency: string | null;
  loginCustomerId: string | null;
  test: boolean;
}

const traco = (id: string) => (/^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

/** O que a volta do Google diz (o `?google=` do endereço). */
const RESULTADO: Record<string, { tipo: 'ok' | 'erro'; texto: string }> = {
  conectado: { tipo: 'ok', texto: 'Google Ads conectado.' },
  escolher: { tipo: 'ok', texto: 'Conectado. Agora escolha qual conta de anúncios é a da clínica.' },
  cancelado: { tipo: 'erro', texto: 'A janela do Google foi fechada antes de terminar. Nada foi conectado.' },
  expirou: { tipo: 'erro', texto: 'A conexão demorou demais ou foi aberta noutra conta. Clique em Conectar de novo.' },
  'sem-acesso': { tipo: 'erro', texto: 'Só um gestor do CRM pode conectar o Google Ads.' },
  'nao-configurado': { tipo: 'erro', texto: 'A conexão com o Google Ads ainda está sendo liberada. Volte em breve.' },
  indisponivel: { tipo: 'erro', texto: 'A conexão com o Google Ads ainda não está disponível para esta clínica.' },
};

export function GoogleAdsConnect({
  connection,
  configured,
  canManage = true,
  result,
}: {
  connection: GoogleAdsConnectionView;
  /** O servidor tem a configuração do Google (cliente OAuth e token de desenvolvedor). */
  configured: boolean;
  canManage?: boolean;
  /** O resultado da volta do Google, lido do endereço. */
  result?: { code: string; reason?: string } | null;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [contas, setContas] = useState<Account[] | null>(null);
  const [escolhida, setEscolhida] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [indo, setIndo] = useState(false);

  // A volta do Google: mostra o resultado e, se precisa escolher, já abre a lista.
  useEffect(() => {
    if (!result) return;
    const r = RESULTADO[result.code];
    if (result.code === 'erro') setErro(result.reason || 'O Google não aceitou a conexão. Tente de novo.');
    else if (r?.tipo === 'erro') setErro(r.texto);
    else if (r) setAviso(r.texto);
    if (result.code === 'escolher') {
      start(async () => {
        const l = await listGoogleAdsAccountsAction();
        if (l.ok) setContas(l.accounts);
        else setErro(l.message);
      });
    }
    // Limpa o endereço para um recarregar não repetir o aviso.
    window.history.replaceState(null, '', `${window.location.pathname}#google-ads`);
  }, [result]);

  const escolher = () =>
    start(async () => {
      setErro('');
      const r = await chooseGoogleAdsAccountAction(escolhida);
      if (!r.ok) return setErro(r.message);
      const nome = contas?.find((c) => c.id === escolhida)?.name;
      setContas(null);
      setAviso(nome ? `Conectado à conta ${nome}.` : 'Conta de anúncios escolhida.');
      router.refresh();
    });

  const trocar = () =>
    start(async () => {
      setErro('');
      setAviso('');
      const r = await listGoogleAdsAccountsAction();
      if (!r.ok) return setErro(r.message);
      setContas(r.accounts);
      setEscolhida(connection.accountId ?? '');
    });

  const desconectar = () => {
    if (!window.confirm('Desconectar o Google Ads? A aba Google, em Anúncios, para de mostrar os números. Nada do CRM é apagado.')) return;
    start(async () => {
      setErro('');
      const r = await disconnectGoogleAdsAction();
      if (!r.ok) return setErro(r.message);
      setContas(null);
      setAviso('Google Ads desconectado.');
      router.refresh();
    });
  };

  const ocupado = pending || indo;
  const lista = contas;
  const precisaEscolher = connection.state === 'choosing' && !lista;
  const conectar = (
    <a
      href="/api/google-ads/connect"
      onClick={() => setIndo(true)}
      aria-disabled={ocupado}
      className={connection.state === 'none' ? 'btn-primary btn-md' : 'btn-ghost btn-sm'}
    >
      {indo ? 'Abrindo o Google…' : connection.state === 'none' ? 'Conectar Google Ads' : 'Conectar de novo'}
    </a>
  );

  return (
    <section id="google-ads" aria-labelledby={`${id}-t`} className="scroll-mt-20 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            connection.state === 'connected' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' : 'bg-primary/10 text-primary'
          }`}
          aria-hidden="true"
        >
          {connection.state === 'connected' ? <BadgeCheck className="h-5 w-5" /> : <Search className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-t`} className="text-sm font-semibold">
            Google Ads
          </h2>
          <p className="text-sm text-muted-foreground">
            {connection.state === 'connected'
              ? `${connection.accountName ?? 'Conta de anúncios'} · conta ${traco(connection.accountId ?? '')}`
              : 'Pesquisa do Google, YouTube e Display'}
          </p>
        </div>
        {connection.state === 'connected' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800 dark:bg-green-900/50 dark:text-green-200">
            Conectado
          </span>
        )}
      </div>

      {connection.state !== 'connected' && (
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          Veja quanto cada campanha do Google custou, os cliques e as conversões, junto com o que acontece no CRM. Só leitura: o DreamClin não
          cria nem altera anúncios.
        </p>
      )}

      {connection.state === 'connected' && !lista && (
        <dl className="mt-4 divide-y divide-border/70 border-t border-border/70 text-sm">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted-foreground">Números e gráficos</dt>
            <dd>
              <Link href="/crm/anuncios/google" className="inline-flex items-center gap-1 font-medium text-link underline-offset-2 hover:underline">
                Abrir a aba Google <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </dd>
          </div>
        </dl>
      )}

      {precisaEscolher && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Falta escolher qual conta de anúncios é a da clínica.</span>
        </p>
      )}

      {lista && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Qual é a conta de anúncios da clínica?</legend>
          {lista.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Este e-mail não tem conta de anúncios. Conecte com o e-mail que acessa o Google Ads da clínica.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {lista.map((c) => (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    escolhida === c.id ? 'border-primary/60 bg-primary/5' : 'border-border hover:border-border-strong'
                  }`}
                >
                  <input
                    type="radio"
                    name={`${id}-conta`}
                    value={c.id}
                    checked={escolhida === c.id}
                    onChange={() => setEscolhida(c.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {c.name}
                    <span className="block text-xs font-normal text-muted-foreground">
                      Conta {traco(c.id)}
                      {c.currency ? ` · ${c.currency}` : ''}
                      {c.loginCustomerId ? ` · pela conta de administrador ${traco(c.loginCustomerId)}` : ''}
                      {c.test ? ' · conta de teste' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={ocupado || !escolhida} onClick={escolher} className="btn-primary btn-md">
              {pending ? 'Salvando…' : 'Usar esta conta'}
            </button>
            {connection.state === 'connected' && (
              <button type="button" disabled={ocupado} onClick={() => setContas(null)} className="btn-ghost btn-md">
                Cancelar
              </button>
            )}
          </div>
        </fieldset>
      )}

      {canManage && !lista && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {connection.state === 'none' &&
            (configured ? conectar : <p className="rounded-lg bg-surface-alt px-3 py-2 text-sm">A conexão com o Google Ads ainda está sendo liberada. Volte em breve.</p>)}
          {connection.state === 'choosing' && (
            <button type="button" onClick={trocar} disabled={ocupado} className="btn-primary btn-md">
              Escolher a conta
            </button>
          )}
          {connection.state === 'connected' && (
            <button type="button" onClick={trocar} disabled={ocupado} className="btn-outline btn-sm">
              Trocar conta
            </button>
          )}
          {connection.state !== 'none' && (
            <button type="button" onClick={desconectar} disabled={ocupado} className="btn-ghost btn-sm">
              <Unplug className="h-3.5 w-3.5" aria-hidden="true" /> Desconectar
            </button>
          )}
          {connection.state !== 'none' && configured && conectar}
        </div>
      )}

      {!canManage && connection.state !== 'connected' && (
        <p className="mt-3 text-sm text-muted-foreground">Só um gestor do CRM pode conectar o Google Ads.</p>
      )}

      {erro && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erro}
        </p>
      )}
      <p role="status" aria-live="polite" className={aviso ? 'mt-3 text-sm text-muted-foreground' : 'sr-only'}>
        {aviso}
      </p>
    </section>
  );
}
