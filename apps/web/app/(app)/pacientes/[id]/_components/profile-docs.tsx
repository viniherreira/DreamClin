'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, FilePlus2, Folder, FolderPlus, Printer, Smartphone, Trash2, Upload } from 'lucide-react';
import { DOC_KINDS, docKindLabel, isClinicalKind } from '@/lib/doc-template';
import { SIGNATURE_LABEL } from '@/lib/signature';
import { instantDateTimeBR } from '@/lib/tz';
import { RichEditor } from '@/components/rich-editor';
import { directUpload } from '@/components/direct-upload';
import { ShareLink } from './share-link';
import {
  createFolderAction,
  createUploadSessionAction,
  deleteFileAction,
  finishUploadAction,
  loadDefaultFoldersAction,
  moveFileAction,
  previewTemplateAction,
  renameFileAction,
  requestSignatureAction,
  saveDocumentAction,
  sendQuestionnaireAction,
  startUploadAction,
  type DocsOverview,
} from '../docs-actions';

const field = 'h-9 w-full rounded-lg border border-border bg-background px-2 text-sm';
const SIG_CLS: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  VIEWED: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  SIGNED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  REFUSED: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
  EXPIRED: 'bg-surface-alt text-muted-foreground',
};

function Box({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function useRun() {
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = <T,>(fn: () => Promise<({ ok: true } & T) | { ok: false; message: string }>, ok?: (r: { ok: true } & T) => void) =>
    start(async () => {
      setErro('');
      const r = await fn();
      if (!r.ok) setErro(r.message);
      else {
        ok?.(r);
        router.refresh();
      }
    });
  return { erro, pending, run };
}

// ─── Documentos ─────────────────────────────────────────────────────────────

export function DocumentsTab({ patientId, data, phone, appointmentId }: { patientId: string; data: DocsOverview; phone: string; appointmentId?: string }) {
  const { erro, pending, run } = useRun();
  const [novo, setNovo] = useState<null | { templateId: string; kind: string; title: string; body: string; professionalId: string; dias: string; step: 'escolher' | 'editar' }>(null);
  const [link, setLink] = useState<{ docId: string; url: string } | null>(null);
  const tipos = data.canClinical ? DOC_KINDS : DOC_KINDS.filter((k) => !k.clinical);

  return (
    <Box
      title="Documentos"
      action={
        !novo && (
          <button type="button" onClick={() => setNovo({ templateId: '', kind: 'FREE', title: '', body: '', professionalId: '', dias: '', step: 'escolher' })} className="btn-primary btn-sm">
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Novo documento
          </button>
        )
      }
    >
      {novo && (
        <div className="mb-4 space-y-3 rounded-xl border border-border p-4">
          {novo.step === 'escolher' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Modelo</span>
                  <select value={novo.templateId} onChange={(e) => setNovo({ ...novo, templateId: e.target.value })} className={field}>
                    <option value="">Em branco</option>
                    {data.templates
                      .filter((t) => data.canClinical || !isClinicalKind(t.kind))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {docKindLabel(t.kind)} · {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                {!novo.templateId && (
                  <label className="block text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Tipo</span>
                    <select value={novo.kind} onChange={(e) => setNovo({ ...novo, kind: e.target.value })} className={field}>
                      {tipos.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Profissional (assina)</span>
                  <select value={novo.professionalId} onChange={(e) => setNovo({ ...novo, professionalId: e.target.value })} className={field}>
                    <option value="">Nenhum</option>
                    {data.professionals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Dias (atestado)</span>
                  <input value={novo.dias} onChange={(e) => setNovo({ ...novo, dias: e.target.value })} inputMode="numeric" className={field} />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setNovo(null)} className="btn-ghost btn-sm">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!novo.templateId) return setNovo({ ...novo, step: 'editar', title: docKindLabel(novo.kind) });
                    run(
                      () => previewTemplateAction(patientId, novo.templateId, { professionalId: novo.professionalId || undefined, dias: novo.dias }),
                      (r) => setNovo({ ...novo, step: 'editar', body: r.html, kind: r.kind, title: r.title }),
                    );
                  }}
                  className="btn-primary btn-sm"
                >
                  Continuar
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="block text-sm">
                <span className="text-xs font-medium text-muted-foreground">Título para impressão</span>
                <input value={novo.title} onChange={(e) => setNovo({ ...novo, title: e.target.value })} className={field} />
              </label>
              <RichEditor label="Texto do documento" value={novo.body} onChange={(body) => setNovo({ ...novo, body })} variables={false} />
              {isClinicalKind(novo.kind) && <p className="text-xs text-muted-foreground">Documento clínico: fica com o prontuário e só quem vê o prontuário abre.</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setNovo(null)} className="btn-ghost btn-sm">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => saveDocumentAction(patientId, { templateId: novo.templateId || null, kind: novo.kind, title: novo.title, body: novo.body, professionalId: novo.professionalId || null, appointmentId: appointmentId ?? null }),
                      () => setNovo(null),
                    )
                  }
                  className="btn-primary btn-sm"
                >
                  {pending ? 'Salvando…' : 'Salvar documento'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {erro && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {erro}
        </p>
      )}
      {data.docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum documento ainda.</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.docs.map((d) => (
            <li key={d.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{d.title}</span>
                <span className="text-xs text-muted-foreground">
                  {docKindLabel(d.kind)} · {instantDateTimeBR(d.createdAt)}
                </span>
                {d.clinical && <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[11px]">clínico</span>}
                {d.signature && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SIG_CLS[d.signature]}`}>{SIGNATURE_LABEL[d.signature]}</span>}
                <span className="ml-auto flex gap-1">
                  <a href={`/pacientes/${patientId}/documentos/${d.id}`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">
                    <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Imprimir
                  </a>
                  {d.signature !== 'SIGNED' && (
                    <button type="button" disabled={pending} onClick={() => run(() => requestSignatureAction(d.id), (r) => setLink({ docId: d.id, url: r.url }))} className="btn-outline btn-sm">
                      Pedir assinatura
                    </button>
                  )}
                </span>
              </div>
              {link?.docId === d.id && (
                <div className="mt-2">
                  <ShareLink url={link.url} phone={phone} text={`Olá! Segue o documento "${d.title}" para você assinar:`} qrOpen />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}

// ─── Assinaturas ────────────────────────────────────────────────────────────

export function SignaturesTab({ data, phone }: { data: DocsOverview; phone: string }) {
  const [aberto, setAberto] = useState<string | null>(null);
  return (
    <Box title="Assinaturas">
      {data.signatures.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum pedido de assinatura ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Documento</th>
                <th scope="col" className="py-2 pr-3 font-medium">Pedido em</th>
                <th scope="col" className="py-2 pr-3 font-medium">Situação</th>
                <th scope="col" className="py-2 font-medium"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.signatures.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-3">
                    {s.document.title}
                    <span className="block text-xs text-muted-foreground">{docKindLabel(s.document.kind)}</span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{instantDateTimeBR(s.createdAt)}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SIG_CLS[s.state]}`}>{SIGNATURE_LABEL[s.state]}</span>
                    {s.signedAt && <span className="block text-xs text-muted-foreground">{instantDateTimeBR(s.signedAt)}</span>}
                  </td>
                  <td className="py-2">
                    {(s.state === 'PENDING' || s.state === 'VIEWED') && (
                      <button type="button" onClick={() => setAberto(aberto === s.id ? null : s.id)} className="btn-ghost btn-sm">
                        {aberto === s.id ? 'Fechar' : 'Link'}
                      </button>
                    )}
                    {aberto === s.id && <ShareLink url={s.url} phone={phone} text="Olá! Segue o documento para você assinar:" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Box>
  );
}

// ─── Anexos ─────────────────────────────────────────────────────────────────

export function AttachmentsTab({ patientId, data }: { patientId: string; data: DocsOverview }) {
  const { erro, pending, run } = useRun();
  const router = useRouter();
  const [pasta, setPasta] = useState<string>(data.folders[0]?.id ?? '');
  const [novaPasta, setNovaPasta] = useState<{ name: string; clinical: boolean } | null>(null);
  const [enviando, setEnviando] = useState<string[]>([]);
  const [falhas, setFalhas] = useState<string[]>([]);
  const [celular, setCelular] = useState<{ url: string; expiresAt: string } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const arq = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const arquivos = useMemo(() => data.files.filter((f) => (pasta ? f.folderId === pasta : !f.folderId)), [data.files, pasta]);

  const enviar = async (files: FileList | File[] | null) => {
    if (!files) return;
    const lista = Array.from(files);
    setFalhas([]);
    for (const f of lista) {
      setEnviando((x) => [...x, f.name]);
      const r = await directUpload(
        f,
        (m) => startUploadAction(patientId, { ...m, folderId: pasta || null }),
        (m) => finishUploadAction(patientId, { ...m, folderId: pasta || null }),
      );
      setEnviando((x) => x.filter((n) => n !== f.name));
      if (!r.ok) setFalhas((x) => [...x, `${f.name}: ${r.message}`]);
    }
    router.refresh();
  };

  return (
    <Box
      title="Anexos"
      action={
        <>
          {data.folders.length === 0 && (
            <button type="button" disabled={pending} onClick={() => run(() => loadDefaultFoldersAction(patientId))} className="btn-outline btn-sm">
              <Folder className="h-3.5 w-3.5" aria-hidden="true" /> Carregar pastas padrão
            </button>
          )}
          <button type="button" onClick={() => setNovaPasta({ name: '', clinical: true })} className="btn-ghost btn-sm">
            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" /> Nova pasta
          </button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pastas">
        {[{ id: '', name: 'Sem pasta' }, ...data.folders].map((f) => (
          <button
            key={f.id || 'sem'}
            type="button"
            aria-pressed={pasta === f.id}
            onClick={() => setPasta(f.id)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${pasta === f.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            <Folder className="h-3.5 w-3.5" aria-hidden="true" /> {f.name}
            <span className="text-xs tabular-nums">({data.files.filter((x) => (f.id ? x.folderId === f.id : !x.folderId)).length})</span>
          </button>
        ))}
      </div>
      {novaPasta && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createFolderAction(patientId, novaPasta.name, novaPasta.clinical), () => setNovaPasta(null));
          }}
        >
          <label className="sr-only" htmlFor="nova-pasta">
            Nome da pasta
          </label>
          <input id="nova-pasta" value={novaPasta.name} onChange={(e) => setNovaPasta({ ...novaPasta, name: e.target.value })} placeholder="Nome da pasta" className={`${field} max-w-xs`} />
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={novaPasta.clinical} onChange={(e) => setNovaPasta({ ...novaPasta, clinical: e.target.checked })} className="h-4 w-4 accent-primary" /> Clínica (fotos e exames)
          </label>
          <button type="submit" className="btn-primary btn-sm">
            Criar
          </button>
          <button type="button" onClick={() => setNovaPasta(null)} className="btn-ghost btn-sm">
            Cancelar
          </button>
        </form>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          void enviar(e.dataTransfer.files);
        }}
        className={`mt-3 rounded-xl border-2 border-dashed p-5 text-center text-sm ${arrastando ? 'border-primary bg-primary/5' : 'border-border'}`}
      >
        <p className="text-muted-foreground">Arraste fotos e PDFs aqui (até 10 MB cada)</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => arq.current?.click()} className="btn-outline btn-sm">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Escolher arquivos
          </button>
          <button type="button" onClick={() => cam.current?.click()} className="btn-outline btn-sm">
            <Camera className="h-3.5 w-3.5" aria-hidden="true" /> Câmera
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => createUploadSessionAction(patientId, pasta || null), (r) => setCelular({ url: r.url, expiresAt: r.expiresAt }))} className="btn-outline btn-sm">
            <Smartphone className="h-3.5 w-3.5" aria-hidden="true" /> Enviar pelo celular
          </button>
        </div>
        <input ref={arq} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void enviar(e.target.files)} />
        <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void enviar(e.target.files)} />
        {enviando.length > 0 && <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">Enviando {enviando.length}…</p>}
      </div>
      {celular && (
        <div className="mt-3 rounded-xl border border-border p-3">
          <p className="mb-2 text-sm">Leia o QR code com o celular. O link vale por 15 minutos e só sobe arquivos para esta pasta.</p>
          <ShareLink url={celular.url} text="Envie as fotos por aqui:" qrOpen />
        </div>
      )}
      {[erro, ...falhas].filter(Boolean).map((m) => (
        <p key={m} role="alert" className="mt-2 text-sm text-destructive">
          {m}
        </p>
      ))}

      {arquivos.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nada nesta pasta.</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {arquivos.map((f) => (
            <li key={f.id} className="overflow-hidden rounded-xl border border-border">
              {f.url && f.mimeType.startsWith('image/') ? (
                <a href={f.url} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={f.filename} className="h-36 w-full object-cover" />
                </a>
              ) : (
                <a href={f.url ?? '#'} target="_blank" rel="noreferrer" className="flex h-36 items-center justify-center bg-surface-alt text-sm text-muted-foreground">
                  PDF
                </a>
              )}
              <div className="space-y-1 p-2 text-xs">
                <p className="truncate font-medium" title={f.filename}>
                  {f.filename}
                </p>
                <p className="text-muted-foreground">{instantDateTimeBR(f.createdAt)}</p>
                <div className="flex flex-wrap items-center gap-1">
                  <label className="sr-only" htmlFor={`mover-${f.id}`}>
                    Mover {f.filename}
                  </label>
                  <select id={`mover-${f.id}`} value={f.folderId ?? ''} onChange={(e) => run(() => moveFileAction(f.id, e.target.value || null))} className="h-7 rounded border border-border bg-background px-1 text-xs">
                    <option value="">Sem pasta</option>
                    {data.folders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const n = prompt('Novo nome do arquivo:', f.filename);
                      if (n) run(() => renameFileAction(f.id, n));
                    }}
                    className="btn-ghost btn-sm"
                  >
                    Renomear
                  </button>
                  {f.canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Apagar "${f.filename}"? Não dá para desfazer.`)) run(() => deleteFileAction(f.id));
                      }}
                      className="btn-ghost btn-sm text-destructive"
                      aria-label={`Apagar ${f.filename}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}

// ─── Questionários ──────────────────────────────────────────────────────────

export function QuestionnairesTab({ patientId, data, phone }: { patientId: string; data: DocsOverview; phone: string }) {
  const { erro, pending, run } = useRun();
  const [qid, setQid] = useState(data.questionnaireOptions[0]?.id ?? '');
  const [link, setLink] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  return (
    <Box title="Questionários">
      {data.questionnaireOptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum questionário criado. Crie em Configurações › Questionários.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="text-xs font-medium text-muted-foreground">Questionário</span>
            <select value={qid} onChange={(e) => setQid(e.target.value)} className={field}>
              {data.questionnaireOptions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={pending || !qid} onClick={() => run(() => sendQuestionnaireAction(patientId, qid), (r) => setLink(r.url))} className="btn-primary btn-sm">
            Enviar questionário
          </button>
        </div>
      )}
      {link && (
        <div className="mt-3">
          <ShareLink url={link} phone={phone} text="Olá! Responda este questionário antes da consulta:" qrOpen />
        </div>
      )}
      {erro && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erro}
        </p>
      )}
      {data.questionnaires.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Questionário</th>
                <th scope="col" className="py-2 pr-3 font-medium">Pedido</th>
                <th scope="col" className="py-2 pr-3 font-medium">Abriu</th>
                <th scope="col" className="py-2 pr-3 font-medium">Respondeu</th>
                <th scope="col" className="py-2 font-medium"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.questionnaires.map((q) => (
                <tr key={q.id} className="align-top">
                  <td className="py-2 pr-3">{q.name}</td>
                  <td className="py-2 pr-3 tabular-nums">{instantDateTimeBR(q.createdAt)}</td>
                  <td className="py-2 pr-3 tabular-nums">{q.openedAt ? instantDateTimeBR(q.openedAt) : '—'}</td>
                  <td className="py-2 pr-3 tabular-nums">{q.answeredAt ? instantDateTimeBR(q.answeredAt) : q.expired ? 'Expirou' : '—'}</td>
                  <td className="py-2">
                    {q.answers ? (
                      <button type="button" onClick={() => setVer(ver === q.id ? null : q.id)} className="btn-ghost btn-sm">
                        {ver === q.id ? 'Fechar' : 'Ver respostas'}
                      </button>
                    ) : q.answeredAt && q.health ? (
                      <span className="text-xs text-muted-foreground">Só com o prontuário</span>
                    ) : null}
                    {ver === q.id && q.answers && (
                      <dl className="mt-2 space-y-1 text-xs">
                        {q.answers.questions.map((p) => {
                          const a = q.answers!.values[p.id];
                          return (
                            <div key={p.id}>
                              <dt className="text-muted-foreground">{p.label}</dt>
                              <dd className="font-medium">
                                {a ? (Array.isArray(a.v) ? a.v.join(', ') : a.v) : '—'}
                                {a?.obs && ` (${a.obs})`}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Box>
  );
}
