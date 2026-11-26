'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  archiveCustomField,
  deleteOrigin,
  getPatientSettings,
  reorderCustomFields,
  saveCustomField,
  saveOrigin,
  savePatientRules,
  type CustomFieldInput,
  type PatientSettingsData,
} from '../patient-settings-actions';
import { CUSTOM_FIELD_TYPES, OPTIONAL_REQUIRABLE, parseOptions } from '@/lib/patient-fields';

const inputCls = 'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

function usePatientSettings() {
  const [data, setData] = useState<PatientSettingsData | null>(null);
  const carregar = useCallback(async () => setData(await getPatientSettings()), []);
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

function Feedback({ erro, aviso }: { erro: string; aviso: string }) {
  return (
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
}

// ─── Campos obrigatórios ────────────────────────────────────────────────────

export function PatientRulesPanel() {
  const { data, carregar } = usePatientSettings();
  const [req, setReq] = useState<string[] | null>(null);
  const [exportar, setExportar] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    if (data) {
      setReq(data.settings.required);
      setExportar(data.settings.receptionCanExport);
    }
  }, [data]);
  if (!data || !req) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return (
    <Box title="Campos do cadastro" desc="Nome, data de nascimento e celular são sempre obrigatórios. Marque o que mais a clínica quer exigir.">
      <fieldset>
        <legend className="text-sm font-medium">Também obrigatórios</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {OPTIONAL_REQUIRABLE.map((o) => (
            <label key={o.key} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={req.includes(o.key)} onChange={(e) => setReq(e.target.checked ? [...req, o.key] : req.filter((k) => k !== o.key))} className="h-4 w-4 accent-primary" />
              {o.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">O CPF obrigatório ainda deixa a recepção escolher &ldquo;Preencher depois&rdquo; no primeiro passo do cadastro.</p>
      </fieldset>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={exportar} onChange={(e) => setExportar(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
        <span>A recepção pode exportar a lista de pacientes (dono e administrador sempre podem).</span>
      </label>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErro('');
              setAviso('');
              const r = await savePatientRules({ required: req, receptionCanExport: exportar });
              if (!r.ok) setErro(r.message);
              else {
                setAviso('Salvo.');
                await carregar();
              }
            })
          }
          className="btn-primary btn-md"
        >
          {pending ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
      <Feedback erro={erro} aviso={aviso} />
    </Box>
  );
}

// ─── Origens ────────────────────────────────────────────────────────────────

export function PatientOriginsPanel() {
  const { data, carregar } = usePatientSettings();
  const [nome, setNome] = useState('');
  const [editando, setEditando] = useState<{ id: string; name: string } | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, ok: string) =>
    start(async () => {
      setErro('');
      setAviso('');
      const r = await fn();
      if (!r.ok) return setErro(r.message);
      setAviso(ok);
      setNome('');
      setEditando(null);
      await carregar();
    });
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const ativas = data.origins.filter((o) => o.active);
  return (
    <Box title="Origens do paciente" desc="De onde o paciente veio. Aparece no cadastro, nos filtros e nos relatórios.">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {ativas.map((o) => (
          <li key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            {editando?.id === o.id ? (
              <>
                <label htmlFor={`orig-${o.id}`} className="sr-only">
                  Nome da origem
                </label>
                <input id={`orig-${o.id}`} value={editando.name} onChange={(e) => setEditando({ ...editando, name: e.target.value })} className={inputCls} autoFocus />
                <button type="button" disabled={pending} onClick={() => run(() => saveOrigin({ id: o.id, name: editando.name }), 'Origem renomeada.')} className="btn-primary btn-sm">
                  Salvar
                </button>
                <button type="button" onClick={() => setEditando(null)} className="btn-ghost btn-sm">
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <span className="flex-1">{o.name}</span>
                <button type="button" onClick={() => setEditando({ id: o.id, name: o.name })} className="btn-ghost btn-sm" aria-label={`Renomear ${o.name}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Tirar a origem "${o.name}" da lista? Os cadastros que já têm continuam com ela.`)) run(() => deleteOrigin(o.id), 'Origem removida.');
                  }}
                  className="btn-ghost btn-sm"
                  aria-label={`Tirar ${o.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveOrigin({ name: nome }), 'Origem criada.');
        }}
      >
        <label htmlFor="nova-origem" className="sr-only">
          Nova origem
        </label>
        <input id="nova-origem" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nova origem (ex.: Panfleto)" className={inputCls} />
        <button type="submit" disabled={pending || !nome.trim()} className="btn-primary btn-md">
          <Plus className="h-4 w-4" aria-hidden="true" /> Criar
        </button>
      </form>
      <Feedback erro={erro} aviso={aviso} />
    </Box>
  );
}

// ─── Informações adicionais ─────────────────────────────────────────────────

const VAZIO: CustomFieldInput = { label: '', type: 'SHORT_TEXT', options: '', required: false, hasNote: false, highlight: false, active: true };

export function PatientCustomFieldsPanel() {
  const { data, carregar } = usePatientSettings();
  const [edit, setEdit] = useState<CustomFieldInput | null>(null);
  const [previa, setPrevia] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [pending, start] = useTransition();
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const ativos = data.fields.filter((f) => f.active);
  const comOpcoes = edit && (edit.type === 'SINGLE' || edit.type === 'MULTI');

  const mover = (i: number, d: -1 | 1) => {
    const ids = ativos.map((f) => f.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    start(async () => {
      await reorderCustomFields(ids);
      await carregar();
    });
  };

  return (
    <Box
      title="Informações adicionais"
      desc="Campos próprios da clínica no cadastro do paciente (ex.: usa aparelho? time do coração?). Resposta destacada vira alerta no topo da ficha e na agenda."
    >
      {ativos.length === 0 && !edit && <p className="mb-3 text-sm text-muted-foreground">Nenhum campo ainda.</p>}
      {ativos.length > 0 && (
        <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
          {ativos.map((f, i) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <div className="flex flex-col">
                <button type="button" disabled={i === 0 || pending} onClick={() => mover(i, -1)} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label={`Subir ${f.label}`}>
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button type="button" disabled={i === ativos.length - 1 || pending} onClick={() => mover(i, 1)} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label={`Descer ${f.label}`}>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <span className="flex-1 font-medium">{f.label}</span>
              <span className="text-xs text-muted-foreground">{CUSTOM_FIELD_TYPES.find((t) => t.value === f.type)?.label}</span>
              {f.required && <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[11px]">obrigatório</span>}
              {f.highlight && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-800 dark:bg-red-950/50 dark:text-red-200">destaque</span>}
              <button
                type="button"
                onClick={() => {
                  setPrevia(false);
                  setEdit({ id: f.id, label: f.label, type: f.type, options: f.options.join('\n'), required: f.required, hasNote: f.hasNote, highlight: f.highlight, active: true });
                }}
                className="btn-ghost btn-sm"
                aria-label={`Editar ${f.label}`}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!confirm(`Desligar "${f.label}"? Ele some do cadastro, mas as respostas já dadas continuam guardadas.`)) return;
                  start(async () => {
                    const r = await archiveCustomField(f.id);
                    if (!r.ok) setErro(r.message);
                    await carregar();
                  });
                }}
                className="btn-ghost btn-sm"
                aria-label={`Desligar ${f.label}`}
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
            <div>
              <label htmlFor="cf-label" className="text-xs font-medium text-muted-foreground">
                Nome do campo
              </label>
              <input id="cf-label" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} className={inputCls} autoFocus />
            </div>
            <div>
              <label htmlFor="cf-type" className="text-xs font-medium text-muted-foreground">
                Tipo
              </label>
              <select id="cf-type" value={edit.type} disabled={Boolean(edit.id)} onChange={(e) => setEdit({ ...edit, type: e.target.value })} className={inputCls}>
                {CUSTOM_FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {edit.id && <p className="mt-1 text-xs text-muted-foreground">O tipo não muda depois de criado.</p>}
            </div>
            {comOpcoes && (
              <div className="sm:col-span-2">
                <label htmlFor="cf-options" className="text-xs font-medium text-muted-foreground">
                  Opções (uma por linha)
                </label>
                <textarea id="cf-options" rows={4} value={edit.options} onChange={(e) => setEdit({ ...edit, options: e.target.value })} className={`${inputCls} h-auto py-2`} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={edit.required} onChange={(e) => setEdit({ ...edit, required: e.target.checked })} className="h-4 w-4 accent-primary" /> Obrigatório
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={edit.hasNote} onChange={(e) => setEdit({ ...edit, hasNote: e.target.checked })} className="h-4 w-4 accent-primary" /> Tem observação
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={edit.highlight} onChange={(e) => setEdit({ ...edit, highlight: e.target.checked })} className="h-4 w-4 accent-primary" /> Destacar a resposta
            </label>
          </div>
          {previa && (
            <div className="rounded-lg border border-dashed border-border bg-surface-alt/40 p-3" aria-label="Pré-visualização">
              <p className="text-sm font-medium">
                {edit.label || 'Nome do campo'}
                {edit.required && <span className="ml-0.5 text-destructive">*</span>}
              </p>
              {comOpcoes ? (
                <div className="mt-1 flex flex-wrap gap-3 text-sm">
                  {parseOptions(edit.options).map((o) => (
                    <span key={o} className="inline-flex items-center gap-1.5">
                      <span className={`inline-block h-3.5 w-3.5 border border-border ${edit.type === 'SINGLE' ? 'rounded-full' : 'rounded-sm'}`} aria-hidden="true" />
                      {o}
                    </span>
                  ))}
                </div>
              ) : (
                <div className={`mt-1 rounded-md border border-border bg-background ${edit.type === 'LONG_TEXT' ? 'h-16' : 'h-9'}`} aria-hidden="true" />
              )}
              {edit.hasNote && <div className="mt-1 h-9 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">Observação</div>}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setPrevia(!previa)} className="btn-ghost btn-sm">
              <Eye className="h-3.5 w-3.5" aria-hidden="true" /> {previa ? 'Esconder prévia' : 'Pré-visualizar'}
            </button>
            <button type="button" onClick={() => setEdit(null)} className="btn-outline btn-sm">
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setErro('');
                  setAviso('');
                  const r = await saveCustomField(edit);
                  if (!r.ok) return setErro(r.message);
                  setAviso(edit.id ? 'Campo atualizado.' : 'Campo criado.');
                  setEdit(null);
                  await carregar();
                })
              }
              className="btn-primary btn-sm"
            >
              {pending ? 'Salvando…' : 'Salvar campo'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEdit({ ...VAZIO })} className="btn-outline btn-md">
          <Plus className="h-4 w-4" aria-hidden="true" /> Novo campo
        </button>
      )}
      <Feedback erro={erro} aviso={aviso} />
    </Box>
  );
}
