'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { Send } from 'lucide-react';
import { Badge, ErrorText, Field, inputBaseCls, inputCls, Panel, Toggle } from '@/components/fin/ui';
import { COLLECTION_LABEL, toCollectionTemplate, type CollectionPurpose } from '@/lib/financeiro/collection';
import { CLINIC_TZ } from '@/lib/tz';
import { collectionConfig, saveCollectionRules, submitCollectionTemplateAction, type CollectionConfig } from '../collection-actions';

/**
 * A régua de cobrança pelo WhatsApp: quando avisar (dias antes, no dia, dias
 * depois), os dois textos (lembrete e atraso) que vão para a Meta aprovar, e o
 * histórico do que saiu.
 */

const SITUACAO: Record<string, { label: string; tone: 'gray' | 'amber' | 'green' | 'red' }> = {
  NONE: { label: 'Ainda não mandado', tone: 'gray' },
  PENDING: { label: 'Esperando a Meta aprovar', tone: 'amber' },
  APPROVED: { label: 'Aprovado', tone: 'green' },
  REJECTED: { label: 'Recusado pela Meta', tone: 'red' },
  PAUSED: { label: 'Pausado pela Meta', tone: 'red' },
  DISABLED: { label: 'Desativado pela Meta', tone: 'red' },
};

const PASSO = (s: string) => (s === 'D0' ? 'No dia' : s.startsWith('B') ? `${s.slice(1)} dia(s) antes` : `${s.slice(1)} dia(s) depois`);
const ENTREGA: Record<string, string> = { PENDING: 'Enviando', SENT: 'Enviada', DELIVERED: 'Entregue', READ: 'Lida', FAILED: 'Falhou' };

export function FinanceCollectionPanel() {
  const [cfg, setCfg] = useState<CollectionConfig | null>(null);
  const carregar = useCallback(async () => setCfg(await collectionConfig()), []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  if (!cfg)
    return (
      <Panel title="Régua de cobrança">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </Panel>
    );
  return (
    <div className="space-y-5">
      <Regras cfg={cfg} />
      {(['COLLECTION_REMINDER', 'COLLECTION_OVERDUE'] as const).map((p) => (
        <Modelo key={p} purpose={p} cfg={cfg} onChanged={carregar} />
      ))}
      <Historico cfg={cfg} />
    </div>
  );
}

function Regras({ cfg }: { cfg: CollectionConfig }) {
  const [ligada, setLigada] = useState(cfg.enabled);
  const [antes, setAntes] = useState(cfg.daysBefore);
  const [noDia, setNoDia] = useState(cfg.onDueDay);
  const [depois, setDepois] = useState(cfg.daysAfter.join(', '));
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, start] = useTransition();
  const salvar = () =>
    start(async () => {
      const dias = depois
        .split(/[,;\s]+/)
        .map((x) => Number.parseInt(x, 10))
        .filter((x) => Number.isFinite(x));
      const r = await saveCollectionRules({ enabled: ligada, daysBefore: antes, onDueDay: noDia, daysAfter: [...new Set(dias)].slice(0, 3) });
      setAviso(r.ok ? { ok: true, texto: 'Régua salva.' } : { ok: false, texto: r.message });
    });
  return (
    <Panel title="Régua de cobrança" description="Avisos automáticos pelo WhatsApp oficial para as contas a receber dos pacientes. Sai às 9h, um aviso por passo, e nunca para quem pediu para não receber mensagens.">
      <div className="space-y-4">
        {!cfg.connected && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            A régua usa o WhatsApp oficial da clínica.{' '}
            <Link href="/whatsapp" className="font-medium underline underline-offset-2">
              Conecte o WhatsApp
            </Link>{' '}
            para os avisos saírem.
          </p>
        )}
        <Toggle label="Régua ligada" checked={ligada} onChange={setLigada} />
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Avisar quantos dias antes" hint="0 para não avisar antes.">
            {(id) => <input id={id} type="number" min={0} max={30} value={antes} onChange={(e) => setAntes(Math.min(30, Math.max(0, Number(e.target.value) || 0)))} className={`${inputBaseCls} w-24 text-right`} />}
          </Field>
          <div className="pb-1">
            <Toggle label="Avisar no dia do vencimento" checked={noDia} onChange={setNoDia} />
          </div>
          <Field label="Cobrar quantos dias depois" hint="Até três, separados por vírgula (ex.: 3, 10, 30).">
            {(id) => <input id={id} value={depois} onChange={(e) => setDepois(e.target.value)} className={`${inputBaseCls} w-48`} />}
          </Field>
        </div>
        {aviso && <p className={`text-sm ${aviso.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>{aviso.texto}</p>}
        <button type="button" onClick={salvar} disabled={pending} className="btn-primary btn-md">
          Salvar régua
        </button>
      </div>
    </Panel>
  );
}

function Modelo({ purpose, cfg, onChanged }: { purpose: CollectionPurpose; cfg: CollectionConfig; onChanged: () => Promise<void> }) {
  const view = cfg.templates[purpose];
  const [texto, setTexto] = useState(view.draft);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, start] = useTransition();
  const rascunho = toCollectionTemplate(texto);
  const situacao = SITUACAO[view.status] ?? SITUACAO.NONE;
  const mandar = () =>
    start(async () => {
      setAviso(null);
      const r = await submitCollectionTemplateAction(purpose, texto);
      if (!r.ok) return setAviso({ ok: false, texto: r.message });
      setAviso({ ok: true, texto: r.submitted ? 'Mandado para a Meta. A aprovação costuma sair em minutos, às vezes em até 24 horas.' : 'Este texto já foi mandado. Aguarde a resposta da Meta.' });
      await onChanged();
    });
  return (
    <Panel title={COLLECTION_LABEL[purpose]} description={purpose === 'COLLECTION_REMINDER' ? 'Vai antes do vencimento e no dia.' : 'Vai depois do vencimento, nos dias escolhidos.'} action={<Badge tone={situacao.tone}>{situacao.label}</Badge>}>
      <div className="space-y-3">
        <Field label="Texto da mensagem" hint="Use {nome}, {valor}, {vencimento} e {clinica}. {valor} e {vencimento} são obrigatórios.">
          {(id) => <textarea id={id} rows={4} maxLength={900} value={texto} onChange={(e) => setTexto(e.target.value)} className={`${inputCls} h-auto py-2`} />}
        </Field>
        {!rascunho.ok && <ErrorText>{rascunho.message}</ErrorText>}
        {view.status === 'REJECTED' && view.rejectedReason && <p className="text-sm text-destructive">Motivo da recusa: {view.rejectedReason}. Ajuste o texto e mande de novo.</p>}
        {view.approvedName && view.status !== 'APPROVED' && <p className="text-xs text-muted-foreground">Enquanto a Meta não aprova o texto novo, vale o último aprovado.</p>}
        {aviso && <p className={`text-sm ${aviso.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>{aviso.texto}</p>}
        <button type="button" onClick={mandar} disabled={pending || !rascunho.ok || !cfg.connected} className="btn-outline btn-md inline-flex items-center gap-1.5" title={cfg.connected ? undefined : 'Conecte o WhatsApp oficial primeiro'}>
          <Send className="h-4 w-4" aria-hidden="true" /> Mandar para a Meta aprovar
        </button>
      </div>
    </Panel>
  );
}

function Historico({ cfg }: { cfg: CollectionConfig }) {
  return (
    <Panel title="Histórico da régua" description="Os últimos avisos: o que saiu, o que pulou e por quê.">
      {cfg.history.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum aviso ainda.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {cfg.history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="tabular-nums text-muted-foreground">{new Date(h.at).toLocaleDateString('pt-BR', { timeZone: CLINIC_TZ })}</span>
              <span className="min-w-0 flex-1 truncate">
                {h.patientName} · {PASSO(h.step)}
                {h.reason ? <span className="text-xs text-muted-foreground"> · {h.reason}</span> : null}
              </span>
              <Badge tone={h.status === 'SENT' ? 'green' : h.status === 'FAILED' ? 'red' : 'gray'}>{h.status === 'SENT' ? (h.delivery ? (ENTREGA[h.delivery] ?? 'Enviada') : 'Enviada') : h.status === 'FAILED' ? 'Falhou' : 'Não saiu'}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
