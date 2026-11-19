'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { DOC_KINDS, docKindLabel } from '@/lib/doc-template';
import { QUESTION_TYPES, type Question } from '@/lib/questionnaire';
import { RichEditor } from '@/components/rich-editor';
import { ANAMNESIS_QUESTIONS } from '../../pacientes/[id]/_components/anamnesis-questions';
import {
  archiveQuestionnaireAction,
  archiveTemplateAction,
  listTemplatesAction,
  saveFolderDefaultsAction,
  saveQuestionnaireAction,
  saveTemplateAction,
} from '../../pacientes/[id]/docs-actions';

type Data = Awaited<ReturnType<typeof listTemplatesAction>>;
const field = 'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm';

function useData() {
  const [data, setData] = useState<Data | null>(null);
  const carregar = useCallback(async () => setData(await listTemplatesAction()), []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  return { data, carregar };
}

function Box({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function useRun(carregar: () => Promise<void>) {
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, ok: string, depois?: () => void) =>
    start(async () => {
      setErro('');
      setAviso('');
      const r = await fn();
      if (!r.ok) return setErro(r.message);
      setAviso(ok);
      depois?.();
      await carregar();
    });
  const msgs = (
    <>
      {erro && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
          {aviso}
        </p>
      )}
    </>
  );
  return { pending, run, msgs };
}

const EXEMPLO = '<p>Atesto, para os devidos fins, que <strong>{paciente}</strong>, CPF {cpf}, esteve em atendimento nesta clínica em {data}, das ____ às ____, e precisa de {dias} dias de repouso.</p>';

export function DocumentTemplatesPanel() {
  const { data, carregar } = useData();
  const { pending, run, msgs } = useRun(carregar);
  const [edit, setEdit] = useState<{ id?: string; kind: string; name: string; body: string } | null>(null);
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return (
    <Box title="Modelos de documento" desc="Atestado, declaração, receita, pedido de exame, laudo, termo de consentimento e orientações. As variáveis ({paciente}, {data}…) são trocadas pelos dados do paciente.">
      {data.templates.length > 0 && (
        <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
          {data.templates.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1">
                <span className="font-medium">{t.name}</span> <span className="text-xs text-muted-foreground">· {docKindLabel(t.kind)}</span>
              </span>
              <button type="button" onClick={() => setEdit({ id: t.id, kind: t.kind, name: t.name, body: t.body })} className="btn-ghost btn-sm" aria-label={`Editar ${t.name}`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Tirar o modelo "${t.name}"? Os documentos já emitidos continuam.`)) run(() => archiveTemplateAction(t.id), 'Modelo removido.');
                }}
                className="btn-ghost btn-sm"
                aria-label={`Tirar ${t.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-xs font-medium text-muted-foreground">Nome</span>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={field} />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-muted-foreground">Tipo</span>
              <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} className={field}>
                {DOC_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <RichEditor label="Texto do modelo" value={edit.body} onChange={(body) => setEdit({ ...edit, body })} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEdit(null)} className="btn-outline btn-sm">
              Cancelar
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => saveTemplateAction(edit), 'Modelo salvo.', () => setEdit(null))} className="btn-primary btn-sm">
              {pending ? 'Salvando…' : 'Salvar modelo'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEdit({ kind: 'CERTIFICATE', name: 'Atestado', body: EXEMPLO })} className="btn-outline btn-md">
          <Plus className="h-4 w-4" aria-hidden="true" /> Novo modelo
        </button>
      )}
      {msgs}
    </Box>
  );
}

const novaPergunta = (): Question => ({ id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label: '', type: 'YESNO', options: [], required: false });

export function QuestionnairesPanel() {
  const { data, carregar } = useData();
  const { pending, run, msgs } = useRun(carregar);
  const [edit, setEdit] = useState<{ id?: string; name: string; health: boolean; questions: Question[] } | null>(null);
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const setQ = (i: number, q: Partial<Question>) => edit && setEdit({ ...edit, questions: edit.questions.map((x, j) => (j === i ? { ...x, ...q } : x)) });
  const mover = (i: number, d: -1 | 1) => {
    if (!edit) return;
    const l = [...edit.questions];
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    setEdit({ ...edit, questions: l });
  };
  return (
    <Box title="Questionários" desc="Mande pelo WhatsApp ou QR code antes da consulta (anamnese, avaliação, pesquisa). Perguntas ligadas à anamnese levam a resposta para a ficha do paciente.">
      {data.questionnaires.length > 0 && (
        <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
          {data.questionnaires.map((q) => (
            <li key={q.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1">
                <span className="font-medium">{q.name}</span> <span className="text-xs text-muted-foreground">· {q.questions.length} perguntas{q.health ? ' · saúde' : ''}</span>
              </span>
              <button type="button" onClick={() => setEdit({ id: q.id, name: q.name, health: q.health, questions: q.questions })} className="btn-ghost btn-sm" aria-label={`Editar ${q.name}`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Tirar "${q.name}"? As respostas já dadas continuam.`)) run(() => archiveQuestionnaireAction(q.id), 'Questionário removido.');
                }}
                className="btn-ghost btn-sm"
                aria-label={`Tirar ${q.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block flex-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Nome</span>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={field} />
            </label>
            <label className="inline-flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={edit.health} onChange={(e) => setEdit({ ...edit, health: e.target.checked })} className="h-4 w-4 accent-primary" /> Respostas de saúde (protegidas como o prontuário)
            </label>
          </div>
          <button
            type="button"
            onClick={() =>
              setEdit({
                ...edit,
                questions: [
                  ...edit.questions,
                  ...ANAMNESIS_QUESTIONS.filter((a) => !edit.questions.some((q) => q.anamnesisKey === a.key)).map((a) => ({ ...novaPergunta(), label: a.label, anamnesisKey: a.key })),
                ],
              })
            }
            className="btn-ghost btn-sm"
          >
            Trazer as perguntas da anamnese
          </button>
          <ol className="space-y-2">
            {edit.questions.map((q, i) => (
              <li key={q.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                  <label className="sr-only" htmlFor={`pq-${q.id}`}>
                    Pergunta {i + 1}
                  </label>
                  <input id={`pq-${q.id}`} value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} placeholder="Pergunta" className={`${field} min-w-[12rem] flex-1`} />
                  <label className="sr-only" htmlFor={`pt-${q.id}`}>
                    Tipo da pergunta {i + 1}
                  </label>
                  <select id={`pt-${q.id}`} value={q.type} onChange={(e) => setQ(i, { type: e.target.value })} className={`${field} w-40`}>
                    {QUESTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} className="h-4 w-4 accent-primary" /> Obrigatória
                  </label>
                  <button type="button" onClick={() => mover(i, -1)} className="btn-ghost btn-sm" aria-label={`Subir pergunta ${i + 1}`}>
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => mover(i, 1)} className="btn-ghost btn-sm" aria-label={`Descer pergunta ${i + 1}`}>
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setEdit({ ...edit, questions: edit.questions.filter((_, j) => j !== i) })} className="btn-ghost btn-sm" aria-label={`Tirar pergunta ${i + 1}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                {(q.type === 'SINGLE' || q.type === 'MULTI') && (
                  <label className="mt-2 block text-xs">
                    <span className="text-muted-foreground">Opções (uma por linha)</span>
                    <textarea
                      rows={3}
                      value={q.options.join('\n')}
                      onChange={(e) => setQ(i, { options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                )}
                {q.anamnesisKey && <p className="mt-1 text-xs text-muted-foreground">Vai para a anamnese do paciente.</p>}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" onClick={() => setEdit({ ...edit, questions: [...edit.questions, novaPergunta()] })} className="btn-outline btn-sm">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Pergunta
            </button>
            <span className="flex gap-2">
              <button type="button" onClick={() => setEdit(null)} className="btn-outline btn-sm">
                Cancelar
              </button>
              <button type="button" disabled={pending} onClick={() => run(() => saveQuestionnaireAction(edit), 'Questionário salvo.', () => setEdit(null))} className="btn-primary btn-sm">
                {pending ? 'Salvando…' : 'Salvar questionário'}
              </button>
            </span>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEdit({ name: 'Anamnese antes da consulta', health: true, questions: [novaPergunta()] })} className="btn-outline btn-md">
          <Plus className="h-4 w-4" aria-hidden="true" /> Novo questionário
        </button>
      )}
      {msgs}
    </Box>
  );
}

export function FolderDefaultsPanel() {
  const { data, carregar } = useData();
  const { pending, run, msgs } = useRun(carregar);
  const [lista, setLista] = useState<{ name: string; clinical: boolean }[] | null>(null);
  useEffect(() => {
    if (data) setLista(data.folders);
  }, [data]);
  if (!data || !lista) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return (
    <Box title="Padrão de pastas" desc="Pastas criadas sozinhas em cada paciente novo. Nos antigos, use &ldquo;Carregar pastas padrão&rdquo; na aba Anexos. Pasta clínica (fotos, exames) segue a regra do prontuário.">
      <ul className="space-y-2">
        {lista.map((f, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`pasta-${i}`}>
              Pasta {i + 1}
            </label>
            <input id={`pasta-${i}`} value={f.name} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={`${field} max-w-xs`} />
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.clinical} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, clinical: e.target.checked } : x)))} className="h-4 w-4 accent-primary" /> Clínica
            </label>
            <button type="button" onClick={() => setLista(lista.filter((_, j) => j !== i))} className="btn-ghost btn-sm" aria-label={`Tirar pasta ${f.name}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap justify-between gap-2">
        <button type="button" onClick={() => setLista([...lista, { name: '', clinical: true }])} className="btn-outline btn-sm">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Pasta
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => saveFolderDefaultsAction(lista.filter((f) => f.name.trim())), 'Padrão salvo.')} className="btn-primary btn-sm">
          Salvar
        </button>
      </div>
      {msgs}
    </Box>
  );
}
