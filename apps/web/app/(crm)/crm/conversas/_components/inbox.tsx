'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, MessageCircle, PanelRight, Search, WifiOff, X } from 'lucide-react';
import { colorClasses } from '@/crm/colors';
import type { ConversationSummary, InboxTab } from '@/crm/conversations';
import { chatListTime, initials } from '@/crm/format';
import { ConversationPane } from '@/components/crm-chat/conversation-pane';
import { announceUnread } from '@/components/crm-chat/unread';
import type { QuickReplyOption } from '@/components/crm-chat/chat-composer';
import { refreshInboxAction, type InboxSnapshot } from '../actions';
import { ThreadSide, type LeadSideBasics } from './lead-side';
import { StageChip } from '@/components/crm-stage-chip';
import { ResizeHandle, usePanelWidth } from '@/components/crm-resize';
import { INBOX_MAX, INBOX_PAGE } from '@/crm/inbox-limits';

const TABS: { key: InboxTab; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'mine', label: 'Minhas' },
  { key: 'unassigned', label: 'Sem dono' },
  { key: 'unanswered', label: 'Sem resposta' },
];

/** De quanto em quanto tempo a tela pergunta se chegou algo, enquanto visível. */
const POLL_MS = 4_000;

export function Inbox({
  initial,
  initialTab,
  initialQ,
  initialTagId,
  initialSelectedId,
  quickReplies,
  lineDown,
  whatsappHref,
  canManage,
  basics,
  meId,
}: {
  /** Quem está usando (para o "Assumir"). */
  meId: string;
  initial: InboxSnapshot;
  initialTab: InboxTab;
  initialQ: string;
  initialTagId: string | null;
  initialSelectedId: string | null;
  quickReplies: QuickReplyOption[];
  lineDown: boolean;
  /** Onde conectar o WhatsApp (null = a pessoa não pode). */
  whatsappHref: string | null;
  canManage: boolean;
  basics: LeadSideBasics;
}) {
  const id = useId();
  const [snap, setSnap] = useState(initial);
  const [tab, setTab] = useState(initialTab);
  const [busca, setBusca] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [tagId, setTagId] = useState(initialTagId);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [aviso, setAviso] = useState('');
  const [gaveta, setGaveta] = useState(false);
  // Quantas conversas a lista mostra: cresce quando a pessoa rola até o fim.
  const [limite, setLimite] = useState(INBOX_PAGE);
  // Com quantas a lista na tela foi lida.
  const [lido, setLido] = useState(INBOX_PAGE);
  const lista = usePanelWidth('conversas-lista', 330, 260, 520);
  const lado = usePanelWidth('conversas-lead', 350, 290, 560);
  const emVoo = useRef(false);
  // Pediram de novo enquanto uma leitura estava no caminho: lê de novo ao terminar.
  const deNovo = useRef(false);
  const estado = useRef({ tab, q, selectedId, tagId, limite });
  estado.current = { tab, q, selectedId, tagId, limite };
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const refresh = useCallback(async () => {
    if (emVoo.current) {
      deNovo.current = true;
      return;
    }
    emVoo.current = true;
    try {
      const pedido = { ...estado.current };
      const r = await refreshInboxAction({ ...pedido, take: pedido.limite });
      // Se a pessoa trocou de aba, de conversa ou rolou a lista no meio, esta resposta já é velha.
      const agora = estado.current;
      if (
        !r.ok ||
        pedido.tab !== agora.tab ||
        pedido.q !== agora.q ||
        pedido.selectedId !== agora.selectedId ||
        pedido.tagId !== agora.tagId ||
        pedido.limite !== agora.limite
      )
        return;
      const novas = novasRecebidas(snapRef.current, r.snapshot);
      if (novas) setAviso(novas);
      // O número do menu acompanha sem recarregar a página: um router.refresh()
      // aqui cancelava a navegação em andamento numa clínica movimentada.
      if (r.snapshot.counts.unread !== snapRef.current.counts.unread) announceUnread(r.snapshot.counts.unread);
      setSnap(r.snapshot);
      setLido(pedido.limite);
    } finally {
      emVoo.current = false;
      if (deNovo.current) {
        deNovo.current = false;
        void refreshRef.current();
      }
    }
  }, []);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Filtros e conversa aberta moram na URL (sem recarregar a página).
  useEffect(() => {
    const sp = new URLSearchParams();
    if (tab !== 'all') sp.set('aba', tab);
    if (q) sp.set('q', q);
    if (tagId) sp.set('tag', tagId);
    if (selectedId) sp.set('c', selectedId);
    const qs = sp.toString();
    window.history.replaceState(null, '', qs ? `/crm/conversas?${qs}` : '/crm/conversas');
  }, [tab, q, selectedId, tagId]);

  // A primeira leitura já veio do servidor; daí em diante, a cada mudança.
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    void refresh();
  }, [tab, q, selectedId, tagId, limite, refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (busca === q) return;
    const t = setTimeout(() => {
      setQ(busca.trim());
      setLimite(INBOX_PAGE);
    }, 350);
    return () => clearTimeout(t);
  }, [busca, q]);

  const thread = snap.thread && snap.thread.conversation.id === selectedId ? snap.thread : null;
  // Pediu mais e a leitura maior ainda não chegou: "Carregando". A lista veio cheia: deve haver mais.
  const carregandoMais = lido < limite;
  const temMais = carregandoMais || (snap.list.length >= limite && limite < INBOX_MAX);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {lineDown && (
        <div role="status" className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>O WhatsApp oficial da clínica não está conectado. Conecte para responder por aqui.</span>
          {whatsappHref && (
            <Link href={whatsappHref} className="font-medium underline underline-offset-2">
              Conectar
            </Link>
          )}
        </div>
      )}

      {/* A largura da lista e a do lead a pessoa ajusta pelas bordas; a conversa fica com o resto. */}
      <div
        style={{ '--lista': `${lista.width}px`, '--lado': `${lado.width}px` } as React.CSSProperties}
        className={`grid min-h-0 min-w-0 flex-1 grid-cols-1 lg:grid-cols-[var(--lista)_minmax(0,1fr)] ${thread ? 'xl:grid-cols-[var(--lista)_var(--lado)_minmax(0,1fr)]' : ''}`}
      >
        <aside
          aria-labelledby={`${id}-titulo`}
          className={`${selectedId ? 'hidden lg:flex' : 'flex'} relative min-h-0 min-w-0 flex-col border-r border-border bg-surface`}
        >
          <ResizeHandle label="Largura da lista de conversas" panel={lista} />
          <div className="space-y-3 border-b border-border p-4">
            <div className="flex items-baseline justify-between">
              <h1 id={`${id}-titulo`} className="text-base font-semibold uppercase tracking-wide">
                Conversas
              </h1>
              {snap.counts.unread > 0 && <span className="text-xs text-muted-foreground">{snap.counts.unread} não lida(s)</span>}
            </div>
            <div className="relative">
              <label htmlFor={`${id}-busca`} className="sr-only">
                Buscar conversa
              </label>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                id={`${id}-busca`}
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome ou telefone"
                className="h-9 w-full rounded-md border border-border bg-surface-alt pl-8 pr-2 text-sm focus:bg-surface focus-visible:outline-2 focus-visible:outline-ring"
              />
            </div>
            <div role="group" aria-label="Filtrar conversas" className="segmented flex w-full">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={tab === t.key}
                  onClick={() => {
                    setTab(t.key);
                    setLimite(INBOX_PAGE);
                  }}
                  className="segmented-item flex-1 whitespace-nowrap px-2"
                >
                  {t.label}
                </button>
              ))}
            </div>
            {basics.tags.length > 0 && (
              <div>
                <label htmlFor={`${id}-tag`} className="sr-only">
                  Filtrar por tag
                </label>
                <select
                  id={`${id}-tag`}
                  value={tagId ?? ''}
                  onChange={(e) => {
                    setTagId(e.target.value || null);
                    setLimite(INBOX_PAGE);
                  }}
                  className="h-8 w-full rounded-md border border-border bg-surface-alt px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <option value="">Todas as tags</option>
                  {basics.tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      Tag: {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <ConversationList
            items={snap.list}
            selectedId={selectedId}
            onSelect={setSelectedId}
            tab={tab}
            q={q}
            filtered={Boolean(tagId)}
            hasMore={temMais}
            loadingMore={carregandoMais}
            onLoadMore={() => {
              if (!carregandoMais && snap.list.length >= limite) setLimite(Math.min(INBOX_MAX, limite + INBOX_PAGE));
            }}
          />
        </aside>

        {/* O lead da conversa no meio, como no Kommo: tags, funil, etapa e campos à mão enquanto se conversa. */}
        {thread && (
          <div className="relative hidden min-h-0 min-w-0 border-r border-border bg-surface xl:block">
            <ResizeHandle label="Largura do painel do lead" panel={lado} />
            <div className="h-full overflow-y-auto">
              <ThreadSide thread={thread} basics={basics} onChanged={() => void refresh()} />
            </div>
          </div>
        )}

        <div className={`${selectedId ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-col`}>
          {thread ? (
            <ConversationPane
              key={thread.conversation.id}
              thread={thread}
              quickReplies={quickReplies}
              onChanged={() => void refresh()}
              onBack={() => setSelectedId(null)}
              canManage={canManage}
              team={basics.team}
              meId={meId}
              headerAction={
                <button
                  type="button"
                  onClick={() => setGaveta(true)}
                  className="btn-outline btn-sm inline-flex items-center gap-1.5 xl:hidden"
                  aria-haspopup="dialog"
                >
                  <PanelRight className="h-3.5 w-3.5" aria-hidden="true" /> {thread.conversation.lead ? 'Lead' : 'Contato'}
                </button>
              }
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-board p-8 text-center text-muted-foreground">
              <MessageCircle className="h-10 w-10" aria-hidden="true" />
              <p className="text-sm">{selectedId ? 'Carregando conversa…' : 'Escolha uma conversa na lista.'}</p>
            </div>
          )}
        </div>

      </div>

      {/* Tela pequena: o mesmo painel, por cima, pelo botão do cabeçalho da conversa. */}
      <Dialog.Root open={gaveta && Boolean(thread)} onOpenChange={setGaveta}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm xl:hidden" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(380px,100vw)] flex-col border-l border-border bg-surface shadow-2xl focus:outline-none xl:hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <Dialog.Title className="text-sm font-semibold">{thread?.conversation.lead ? 'Lead da conversa' : 'Contato da conversa'}</Dialog.Title>
              <Dialog.Description className="sr-only">Dados de {thread?.conversation.name}</Dialog.Description>
              <Dialog.Close className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Fechar</span>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{thread && <ThreadSide thread={thread} basics={basics} onChanged={() => void refresh()} />}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <p role="status" aria-live="polite" className="sr-only">
        {aviso}
      </p>
    </div>
  );
}

/** "Nova mensagem de Ana" quando a conversa aberta recebe algo. */
function novasRecebidas(antes: InboxSnapshot, depois: InboxSnapshot): string {
  const a = antes.thread;
  const d = depois.thread;
  if (!a || !d || a.conversation.id !== d.conversation.id) return '';
  const vistos = new Set(a.messages.map((m) => m.id));
  const novas = d.messages.filter((m) => !vistos.has(m.id) && m.direction === 'INBOUND');
  if (novas.length === 0) return '';
  const ultima = novas.at(-1)!;
  return `Nova mensagem de ${d.conversation.name}: ${ultima.text || 'mídia'}`;
}

function ConversationList({
  items,
  selectedId,
  onSelect,
  tab,
  q,
  filtered,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  items: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  tab: InboxTab;
  q: string;
  filtered: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const rolagem = useRef<HTMLUListElement>(null);
  const fim = useRef<HTMLLIElement>(null);
  const pedir = useRef(onLoadMore);
  useEffect(() => {
    pedir.current = onLoadMore;
  }, [onLoadMore]);
  // Chegando perto do fim da lista, pede a próxima leva (como no funil).
  useEffect(() => {
    if (!hasMore || loadingMore || !fim.current) return;
    const obs = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) pedir.current();
    }, { root: rolagem.current, rootMargin: '0px 0px 300px 0px' });
    obs.observe(fim.current);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, items.length]);

  if (items.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        {q || filtered
          ? 'Nenhuma conversa encontrada.'
          : tab === 'unanswered'
              ? 'Nenhuma conversa esperando resposta.'
              : tab === 'mine'
                ? 'Nenhuma conversa com você.'
                : tab === 'unassigned'
                  ? 'Toda conversa tem alguém atendendo.'
                : 'Ainda não há conversas. Elas aparecem aqui assim que alguém escrever para o WhatsApp da clínica.'}
      </p>
    );
  }
  return (
    <ul ref={rolagem} className="min-h-0 flex-1 overflow-y-auto" aria-label="Lista de conversas">
      {items.map((c) => {
        const ativa = c.id === selectedId;
        const lida = c.unread === 0;
        return (
          <li key={c.id} className="border-b border-border/70">
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={ativa ? 'true' : undefined}
              className={`relative flex w-full gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${ativa ? 'bg-primary/10 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary' : 'hover:bg-surface-alt'}`}
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary-hover dark:text-sky-300"
              >
                {initials(c.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={`truncate text-sm ${lida ? 'font-medium' : 'font-semibold'}`}>{c.name}</span>
                  <span className={`ml-auto shrink-0 text-[11px] ${lida ? 'text-muted-foreground' : 'font-semibold text-primary'}`}>
                    {chatListTime(new Date(c.lastMessageAt))}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[13px]">
                  {c.lead ? (
                    <span className="truncate font-medium text-foreground/90">{c.lead.label}</span>
                  ) : c.patient ? (
                    <span className="text-[12px] text-muted-foreground">Paciente · sem negócio</span>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">Sem negócio</span>
                  )}
                  {c.lead && <StageChip name={c.lead.stage} color={c.lead.stageColor} small />}
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className={`truncate text-xs ${lida ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {c.previewFrom && <span className="font-medium">{c.previewFrom}: </span>}
                    {c.preview || '-'}
                  </span>
                  {!lida && (
                    <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {c.unread}
                      <span className="sr-only"> não lida(s)</span>
                    </span>
                  )}
                </span>
                {(c.tags.length > 0 || c.awaitingReply || c.assignedTo) && (
                  <span className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
                    {c.assignedTo && (
                      <span className="max-w-[110px] truncate rounded-[3px] bg-surface-alt px-1.5 py-0.5 text-muted-foreground">
                        <span className="sr-only">Atende: </span>
                        {c.assignedTo.name.split(' ')[0]}
                      </span>
                    )}
                    {c.awaitingReply && (
                      <span className="rounded-[3px] bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">Sem resposta</span>
                    )}
                    {c.tags.slice(0, 3).map((t) => (
                      <span key={t.id} className={`max-w-[110px] truncate rounded-[3px] px-1.5 py-0.5 font-medium ${colorClasses(t.color).chip}`}>
                        {t.name}
                      </span>
                    ))}
                    {c.tags.length > 3 && (
                      <span className="rounded-[3px] bg-surface-alt px-1.5 py-0.5 text-muted-foreground">
                        +{c.tags.length - 3}
                        <span className="sr-only"> tags: {c.tags.slice(3).map((t) => t.name).join(', ')}</span>
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
      {hasMore && (
        <li ref={fim} className="flex justify-center py-3">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-alt hover:text-primary focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
          >
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {loadingMore ? 'Carregando…' : 'Carregar mais conversas'}
          </button>
        </li>
      )}
    </ul>
  );
}
