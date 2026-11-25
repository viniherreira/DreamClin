'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, Trash2, UserRound, X } from 'lucide-react';
import { checkCpfAction, createPatient, pickPatientsAction, updatePatient } from '../actions';
import type { PatientFormState } from '../actions';
import { nationalPhone } from '@/lib/phone';
import { ageFromBirth, instantDateTimeBR } from '@/lib/tz';
import {
  BLOOD_TYPES,
  CONTACT_KINDS,
  EDUCATION_OPTIONS,
  MARITAL_OPTIONS,
  PRIORITY_TYPES,
  SEX_OPTIONS,
  type CustomAnswers,
  type CustomFieldDef,
  type RequirableKey,
} from '@/lib/patient-fields';

import { DateField } from '@/components/ui/date-field';
// ─── Máscaras ────────────────────────────────────────────────────────────────

function maskCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, (_, a, b, c, e) => (e ? `${a}.${b}.${c}-${e}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a));
}

function maskPhone(v: string) {
  const todos = v.replace(/\D/g, '');
  const d = (todos.length > 11 && todos.startsWith('55') ? todos.slice(2) : todos).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, (_, a, b, c) => (c ? `(${a}) ${b}-${c}` : b ? `(${a}) ${b}` : a ? `(${a}` : ''));
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, (_, a, b, c) => (c ? `(${a}) ${b}-${c}` : `(${a}) ${b}`));
}

function maskCep(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.replace(/(\d{5})(\d{0,3})/, (_, a, b) => (b ? `${a}-${b}` : a));
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 aria-[invalid=true]:border-destructive';

// ─── Peças ───────────────────────────────────────────────────────────────────

function Field({ id, label, required, error, hint, children, wide }: { id: string; label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const aria = (id: string, error?: string) => ({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : undefined });

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Escolher outro paciente (responsável financeiro, quem indicou). */
function PatientPick({
  id,
  name,
  label,
  initial,
  excludeId,
}: {
  id: string;
  name: string;
  label: string;
  initial: { id: string; name: string; controlNumber: number } | null;
  excludeId?: string;
}) {
  const [sel, setSel] = useState(initial);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ id: string; name: string; controlNumber: number }[]>([]);
  const [, start] = useTransition();
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes([]);
      return;
    }
    const t = setTimeout(() => start(async () => setRes((await pickPatientsAction(q)).filter((r) => r.id !== excludeId))), 250);
    return () => clearTimeout(t);
  }, [q, excludeId]);
  return (
    <div className="space-y-1">
      <input type="hidden" name={name} value={sel?.id ?? ''} />
      {sel ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-alt/50 px-3 py-2 text-sm">
          <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1 truncate font-medium">{sel.name}</span>
          <span className="text-xs text-muted-foreground">nº {sel.controlNumber}</span>
          <button type="button" onClick={() => setSel(null)} aria-label={`Tirar ${label.toLowerCase()}`} className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paciente pelo nome ou nº" className={`${inputCls} pl-8`} autoComplete="off" />
          {res.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg" role="listbox" aria-label={label}>
              {res.map((r) => (
                <li key={r.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => {
                      setSel(r);
                      setQ('');
                    }}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground">nº {r.controlNumber}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Dados ───────────────────────────────────────────────────────────────────

export interface InsuranceRow {
  id?: string;
  insurerId?: string | null;
  insurerName: string;
  planName?: string | null;
  cardNumber?: string | null;
  validUntil?: string | null;
  active?: boolean;
}

export interface PatientFullData {
  id?: string;
  controlNumber?: number;
  active?: boolean;
  name?: string;
  socialName?: string;
  nickname?: string;
  birthDate?: string;
  cpf?: string;
  foreigner?: boolean;
  nationality?: string;
  foreignDoc?: string;
  rg?: string;
  rgIssuer?: string;
  gender?: string;
  genderIdentity?: string;
  email?: string;
  phone?: string;
  phone2?: string;
  landline?: string;
  landlineExt?: string;
  otherContacts?: { kind: string; number: string }[];
  zipCode?: string;
  street?: string;
  addressNumber?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  financialResponsible?: { id: string; name: string; controlNumber: number } | null;
  financialResponsibleText?: string;
  insurances?: InsuranceRow[];
  cns?: string;
  bloodType?: string;
  maritalStatus?: string;
  spouseName?: string;
  motherName?: string;
  fatherName?: string;
  legalGuardian?: string;
  priority?: boolean;
  priorityType?: string;
  profession?: string;
  education?: string;
  hobby?: string;
  referredBy?: string;
  referredByPatient?: { id: string; name: string; controlNumber: number } | null;
  originId?: string;
  birthdayMessages?: boolean;
  notes?: string;
  customFields?: CustomAnswers;
  lgpdConsentAt?: Date | null;
  marketingConsentAt?: Date | null;
}

type TabId = 'dados' | 'comercial' | 'complementar' | 'marketing' | 'adicionais';

/** Em que aba mora cada campo: o erro do servidor abre a aba certa. */
const FIELD_TAB: Record<string, TabId> = {
  name: 'dados', socialName: 'dados', birthDate: 'dados', cpf: 'dados', foreignDoc: 'dados', rg: 'dados', gender: 'dados', email: 'dados', phone: 'dados',
  phone2: 'dados', landline: 'dados', zipCode: 'dados', street: 'dados', addressNumber: 'dados', lgpdConsent: 'dados',
  financialResponsibleId: 'comercial', insurances: 'comercial',
  controlNumber: 'complementar', cns: 'complementar', motherName: 'complementar', fatherName: 'complementar',
  originId: 'marketing', referredById: 'marketing', profession: 'marketing',
};

export function PatientFormFull({
  patient,
  origins,
  fields,
  required,
  insurers,
  afterCreate,
}: {
  patient?: PatientFullData;
  origins: { id: string; name: string }[];
  fields: CustomFieldDef[];
  required: RequirableKey[];
  /** Convênios do cadastro de clientes e fornecedores (financeiro novo). */
  insurers: { id: string; name: string }[];
  afterCreate?: (patientId: string) => Promise<string>;
}) {
  const router = useRouter();
  const isEdit = Boolean(patient?.id);
  const baseId = useId();
  const [step, setStep] = useState<'cpf' | 'form'>(isEdit || patient?.cpf ? 'form' : 'cpf');
  const [cpfLater, setCpfLater] = useState(false);
  const [tab, setTab] = useState<TabId>('dados');
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const [cpf, setCpf] = useState(patient?.cpf ? maskCpf(patient.cpf) : '');
  const [phone, setPhone] = useState(patient?.phone ? maskPhone(nationalPhone(patient.phone)) : '');
  const [phone2, setPhone2] = useState(patient?.phone2 ? maskPhone(nationalPhone(patient.phone2)) : '');
  const [landline, setLandline] = useState(patient?.landline ? maskPhone(patient.landline) : '');
  const [cep, setCep] = useState(patient?.zipCode ? maskCep(patient.zipCode) : '');
  const [cepMsg, setCepMsg] = useState<string | null>(null);
  const [birthDate, setBirthDate] = useState(patient?.birthDate ?? '');
  const [foreigner, setForeigner] = useState(Boolean(patient?.foreigner));
  const [priority, setPriority] = useState(Boolean(patient?.priority));
  const [contacts, setContacts] = useState(patient?.otherContacts ?? []);
  const [insurances, setInsurances] = useState<InsuranceRow[]>(patient?.insurances ?? []);
  const [answers, setAnswers] = useState<CustomAnswers>(patient?.customFields ?? {});

  const streetRef = useRef<HTMLInputElement>(null);
  const neighborhoodRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLSelectElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const ativos = fields.filter((f) => f.active);
  const req = useMemo(() => new Set(required), [required]);
  const err = (f: string) => errors[f]?.[0];

  const tabs: { id: TabId; label: string }[] = [
    { id: 'dados', label: 'Dados do paciente' },
    { id: 'comercial', label: 'Comercial e financeiro' },
    { id: 'complementar', label: 'Dados complementares' },
    { id: 'marketing', label: 'Marketing' },
    ...(ativos.length ? [{ id: 'adicionais' as const, label: 'Informações adicionais' }] : []),
  ];
  const tabTemErro = (t: TabId) => Object.keys(errors).some((k) => (k.startsWith('cf_') ? 'adicionais' : (FIELD_TAB[k] ?? 'dados')) === t);

  async function fetchCep(raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 8) return;
    setCepMsg(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data.erro) {
        setCepMsg('CEP não encontrado. Digite o endereço.');
        return;
      }
      if (streetRef.current) streetRef.current.value = data.logradouro ?? '';
      if (neighborhoodRef.current) neighborhoodRef.current.value = data.bairro ?? '';
      if (cityRef.current) cityRef.current.value = data.localidade ?? '';
      if (stateRef.current) stateRef.current.value = data.uf ?? '';
    } catch {
      setCepMsg('Não foi possível buscar o CEP agora. Digite o endereço.');
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setServerError(null);
    const formData = new FormData(e.currentTarget);
    formData.set('otherContacts', JSON.stringify(contacts));
    formData.set('insurances', JSON.stringify(insurances));
    formData.set('customFields', JSON.stringify(answers));
    if (cpfLater) formData.set('cpfLater', '1');
    startTransition(async () => {
      try {
        const result: PatientFormState = isEdit && patient?.id ? await updatePatient(patient.id, null, formData) : await createPatient(null, formData);
        if (result.success) {
          window.location.href = !isEdit && afterCreate ? await afterCreate(result.patientId) : `/pacientes/${result.patientId}`;
        } else {
          setErrors(result.errors);
          if (result.message) setServerError(result.message);
          const primeiro = Object.keys(result.errors)[0];
          if (primeiro) setTab(primeiro.startsWith('cf_') ? 'adicionais' : (FIELD_TAB[primeiro] ?? 'dados'));
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } catch {
        setServerError('Ocorreu um erro inesperado. Tente novamente.');
      }
    });
  }

  if (step === 'cpf') return <CpfStep initial={cpf} onContinue={(v) => { setCpf(v); setStep('form'); }} onLater={() => { setCpfLater(true); setStep('form'); }} />;

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
      {serverError && (
        <div role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {serverError}
        </div>
      )}

      <div role="tablist" aria-label="Partes do cadastro" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${tab === t.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
            {tabTemErro(t.id) && <span className="h-2 w-2 rounded-full bg-destructive" aria-label="tem campo para corrigir" />}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden="true" />}
          </button>
        ))}
      </div>

      {/* ── Dados do paciente ─────────────────────────────────────────── */}
      <div role="tabpanel" id={`${baseId}-panel-dados`} aria-labelledby={`${baseId}-tab-dados`} hidden={tab !== 'dados'} className="space-y-4">
        <Group title="Identificação">
          <Field id="name" label="Nome completo" required error={err('name')} wide>
            <input {...aria('name', err('name'))} name="name" type="text" autoFocus defaultValue={patient?.name} className={inputCls} placeholder="Nome civil, como no documento" />
          </Field>
          <Field id="socialName" label="Nome social" error={err('socialName')} hint="Quando preenchido, é o nome usado na tela e nas mensagens.">
            <input {...aria('socialName', err('socialName'))} name="socialName" type="text" defaultValue={patient?.socialName ?? ''} className={inputCls} />
          </Field>
          <Field id="nickname" label="Como prefere ser chamado" error={err('nickname')}>
            <input {...aria('nickname', err('nickname'))} name="nickname" type="text" defaultValue={patient?.nickname ?? ''} className={inputCls} />
          </Field>
          <Field id="birthDate" label="Data de nascimento" required error={err('birthDate')}>
            <div className="flex items-center gap-2">
              <DateField {...aria('birthDate', err('birthDate'))} name="birthDate" value={birthDate} onChange={(v) => setBirthDate(v)} className={inputCls} />
              {birthDate && ageFromBirth(birthDate) !== null && <span className="shrink-0 text-xs text-muted-foreground">{ageFromBirth(birthDate)} anos</span>}
            </div>
          </Field>
          <Field id="gender" label="Sexo" required={req.has('sex')} error={err('gender')}>
            <select {...aria('gender', err('gender'))} name="gender" defaultValue={patient?.gender ?? ''} className={inputCls}>
              <option value="">Selecione</option>
              {SEX_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="genderIdentity" label="Gênero" error={err('genderIdentity')} hint="Opcional.">
            <input {...aria('genderIdentity', err('genderIdentity'))} name="genderIdentity" type="text" defaultValue={patient?.genderIdentity ?? ''} className={inputCls} />
          </Field>
          <div className="sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="foreigner" value="1" checked={foreigner} onChange={(e) => setForeigner(e.target.checked)} className="h-4 w-4 accent-primary" />
              Estrangeiro (sem CPF)
            </label>
          </div>
          {foreigner ? (
            <>
              <Field id="nationality" label="Nacionalidade" error={err('nationality')}>
                <input {...aria('nationality', err('nationality'))} name="nationality" type="text" defaultValue={patient?.nationality ?? ''} className={inputCls} />
              </Field>
              <Field id="foreignDoc" label="Passaporte ou documento" required={req.has('cpf') && !cpfLater} error={err('foreignDoc')}>
                <input {...aria('foreignDoc', err('foreignDoc'))} name="foreignDoc" type="text" defaultValue={patient?.foreignDoc ?? ''} className={inputCls} />
              </Field>
            </>
          ) : (
            <>
              <Field id="cpf" label="CPF" required={req.has('cpf') && !cpfLater} error={err('cpf')} hint={cpfLater && !cpf ? 'Ficou para depois.' : undefined}>
                <input {...aria('cpf', err('cpf'))} name="cpf" type="text" inputMode="numeric" value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} className={inputCls} placeholder="000.000.000-00" />
              </Field>
              <Field id="nationality" label="Nacionalidade" error={err('nationality')}>
                <input {...aria('nationality', err('nationality'))} name="nationality" type="text" defaultValue={patient?.nationality ?? 'Brasileira'} className={inputCls} />
              </Field>
            </>
          )}
          <Field id="rg" label="RG" required={req.has('rg')} error={err('rg')}>
            <input {...aria('rg', err('rg'))} name="rg" type="text" defaultValue={patient?.rg ?? ''} className={inputCls} />
          </Field>
          <Field id="rgIssuer" label="Órgão expedidor" error={err('rgIssuer')}>
            <input {...aria('rgIssuer', err('rgIssuer'))} name="rgIssuer" type="text" defaultValue={patient?.rgIssuer ?? ''} className={inputCls} placeholder="SSP-SP" />
          </Field>
        </Group>

        <Group title="Contato">
          <Field id="phone" label="Celular (WhatsApp)" required error={err('phone')}>
            <input {...aria('phone', err('phone'))} name="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} className={inputCls} placeholder="(11) 99999-9999" />
          </Field>
          <Field id="email" label="E-mail" required={req.has('email')} error={err('email')}>
            <input {...aria('email', err('email'))} name="email" type="email" defaultValue={patient?.email ?? ''} className={inputCls} />
          </Field>
          <Field id="phone2" label="Outro celular" error={err('phone2')}>
            <input {...aria('phone2', err('phone2'))} name="phone2" type="tel" inputMode="tel" value={phone2} onChange={(e) => setPhone2(maskPhone(e.target.value))} className={inputCls} />
          </Field>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Field id="landline" label="Telefone fixo" error={err('landline')}>
              <input {...aria('landline', err('landline'))} name="landline" type="tel" inputMode="tel" value={landline} onChange={(e) => setLandline(maskPhone(e.target.value))} className={inputCls} />
            </Field>
            <Field id="landlineExt" label="Ramal">
              <input id="landlineExt" name="landlineExt" type="text" inputMode="numeric" defaultValue={patient?.landlineExt ?? ''} className={inputCls} />
            </Field>
          </div>
          <div className="sm:col-span-2 space-y-2">
            <p className="text-sm font-medium">Outros contatos</p>
            {contacts.map((c, i) => (
              <div key={i} className="flex gap-2">
                <select
                  aria-label={`Tipo do contato ${i + 1}`}
                  value={c.kind}
                  onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
                  className={`${inputCls} w-36`}
                >
                  {CONTACT_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                <input
                  aria-label={`Número do contato ${i + 1}`}
                  value={c.number}
                  onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, number: maskPhone(e.target.value) } : x)))}
                  className={inputCls}
                  inputMode="tel"
                />
                <button type="button" onClick={() => setContacts(contacts.filter((_, j) => j !== i))} aria-label={`Tirar contato ${i + 1}`} className="btn-ghost btn-sm">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            {contacts.length < 10 && (
              <button type="button" onClick={() => setContacts([...contacts, { kind: 'Recado', number: '' }])} className="btn-outline btn-sm">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Adicionar contato
              </button>
            )}
          </div>
        </Group>

        <Group title="Endereço">
          <Field id="zipCode" label="CEP" required={req.has('zipCode')} error={err('zipCode')} hint={cepMsg ?? undefined}>
            <input
              {...aria('zipCode', err('zipCode'))}
              name="zipCode"
              type="text"
              inputMode="numeric"
              value={cep}
              onChange={(e) => setCep(maskCep(e.target.value))}
              onBlur={(e) => fetchCep(e.target.value)}
              className={inputCls}
              placeholder="00000-000"
            />
          </Field>
          <div className="hidden sm:block" />
          <Field id="street" label="Rua" required={req.has('address')} error={err('street')} wide>
            <input ref={streetRef} {...aria('street', err('street'))} name="street" type="text" defaultValue={patient?.street ?? ''} className={inputCls} />
          </Field>
          <Field id="addressNumber" label="Número" required={req.has('address')} error={err('addressNumber')}>
            <input {...aria('addressNumber', err('addressNumber'))} name="addressNumber" type="text" defaultValue={patient?.addressNumber ?? ''} className={inputCls} />
          </Field>
          <Field id="complement" label="Complemento">
            <input id="complement" name="complement" type="text" defaultValue={patient?.complement ?? ''} className={inputCls} />
          </Field>
          <Field id="neighborhood" label="Bairro">
            <input ref={neighborhoodRef} id="neighborhood" name="neighborhood" type="text" defaultValue={patient?.neighborhood ?? ''} className={inputCls} />
          </Field>
          <Field id="city" label="Cidade">
            <input ref={cityRef} id="city" name="city" type="text" defaultValue={patient?.city ?? ''} className={inputCls} />
          </Field>
          <Field id="state" label="UF">
            <select ref={stateRef} id="state" name="state" defaultValue={patient?.state ?? ''} className={inputCls}>
              <option value="">Selecione</option>
              {UFS.map((uf) => (
                <option key={uf}>{uf}</option>
              ))}
            </select>
          </Field>
        </Group>
      </div>

      {/* ── Comercial e financeiro ───────────────────────────────────── */}
      <div role="tabpanel" id={`${baseId}-panel-comercial`} aria-labelledby={`${baseId}-tab-comercial`} hidden={tab !== 'comercial'} className="space-y-4">
        <Group title="Responsável financeiro">
          <div className="sm:col-span-2 space-y-1">
            <label htmlFor={`${baseId}-resp`} className="block text-sm font-medium">
              Paciente responsável
            </label>
            <PatientPick id={`${baseId}-resp`} name="financialResponsibleId" label="Responsável financeiro" initial={patient?.financialResponsible ?? null} excludeId={patient?.id} />
            <p className="text-xs text-muted-foreground">Recibos e cobranças saem no nome dele. Útil para menor de idade.</p>
          </div>
          <Field id="financialResponsibleText" label="Ou só o nome (quem não é paciente)" wide>
            <input id="financialResponsibleText" name="financialResponsibleText" type="text" defaultValue={patient?.financialResponsibleText ?? ''} className={inputCls} />
          </Field>
        </Group>

        <fieldset className="rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Convênios</legend>
          <p className="mb-3 text-xs text-muted-foreground">Particular sempre vale. A agenda usa a carteirinha e a validade daqui.</p>
          <div className="space-y-3">
            {insurances.map((ins, i) => (
              <div key={ins.id ?? `n${i}`} className={`grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-5 ${ins.active === false ? 'opacity-60' : ''}`}>
                <div className="sm:col-span-2">
                  <label className="text-xs text-muted-foreground" htmlFor={`${baseId}-ins-${i}`}>
                    Convênio
                  </label>
                  {insurers.length ? (
                    <select
                      id={`${baseId}-ins-${i}`}
                      value={ins.insurerId ?? ''}
                      onChange={(e) => {
                        const it = insurers.find((x) => x.id === e.target.value);
                        setInsurances(insurances.map((x, j) => (j === i ? { ...x, insurerId: it?.id ?? null, insurerName: it?.name ?? x.insurerName } : x)));
                      }}
                      className={inputCls}
                    >
                      <option value="">{ins.insurerName && !ins.insurerId ? ins.insurerName : 'Escolha'}</option>
                      {insurers.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`${baseId}-ins-${i}`}
                      value={ins.insurerName}
                      onChange={(e) => setInsurances(insurances.map((x, j) => (j === i ? { ...x, insurerName: e.target.value } : x)))}
                      className={inputCls}
                    />
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor={`${baseId}-plan-${i}`}>
                    Plano
                  </label>
                  <input id={`${baseId}-plan-${i}`} value={ins.planName ?? ''} onChange={(e) => setInsurances(insurances.map((x, j) => (j === i ? { ...x, planName: e.target.value } : x)))} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor={`${baseId}-card-${i}`}>
                    Carteirinha
                  </label>
                  <input id={`${baseId}-card-${i}`} value={ins.cardNumber ?? ''} onChange={(e) => setInsurances(insurances.map((x, j) => (j === i ? { ...x, cardNumber: e.target.value } : x)))} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor={`${baseId}-val-${i}`}>
                    Validade
                  </label>
                  <DateField id={`${baseId}-val-${i}`} value={ins.validUntil ?? ''} onChange={(v) => setInsurances(insurances.map((x, j) => (j === i ? { ...x, validUntil: v } : x)))} className={inputCls} />
                </div>
                <div className="flex items-center justify-between gap-2 sm:col-span-5">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={ins.active !== false} onChange={(e) => setInsurances(insurances.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} className="h-4 w-4 accent-primary" />
                    Ativo
                  </label>
                  {!ins.id && (
                    <button type="button" onClick={() => setInsurances(insurances.filter((_, j) => j !== i))} className="btn-ghost btn-sm">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Tirar
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setInsurances([...insurances, { insurerName: '', active: true }])} className="btn-outline btn-sm">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Adicionar convênio
            </button>
          </div>
        </fieldset>
      </div>

      {/* ── Dados complementares ─────────────────────────────────────── */}
      <div role="tabpanel" id={`${baseId}-panel-complementar`} aria-labelledby={`${baseId}-tab-complementar`} hidden={tab !== 'complementar'} className="space-y-4">
        <Group title="Registro">
          <Field id="controlNumber" label="Número de controle" error={err('controlNumber')} hint={isEdit ? 'Gerado pelo sistema. Dá para trocar se a clínica usa outra numeração.' : 'Deixe em branco para o próximo número.'}>
            <input {...aria('controlNumber', err('controlNumber'))} name="controlNumber" type="text" inputMode="numeric" defaultValue={patient?.controlNumber ?? ''} className={inputCls} />
          </Field>
          <Field id="cns" label="Cartão do SUS (CNS)" error={err('cns')}>
            <input {...aria('cns', err('cns'))} name="cns" type="text" inputMode="numeric" defaultValue={patient?.cns ?? ''} className={inputCls} />
          </Field>
          <Field id="bloodType" label="Tipo sanguíneo">
            <select id="bloodType" name="bloodType" defaultValue={patient?.bloodType ?? ''} className={inputCls}>
              <option value="">Não informado</option>
              {BLOOD_TYPES.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
          <Field id="maritalStatus" label="Estado civil">
            <select id="maritalStatus" name="maritalStatus" defaultValue={patient?.maritalStatus ?? ''} className={inputCls}>
              <option value="">Selecione</option>
              {MARITAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="spouseName" label="Nome do cônjuge">
            <input id="spouseName" name="spouseName" type="text" defaultValue={patient?.spouseName ?? ''} className={inputCls} />
          </Field>
          <Field id="legalGuardian" label="Responsável legal">
            <input id="legalGuardian" name="legalGuardian" type="text" defaultValue={patient?.legalGuardian ?? ''} className={inputCls} />
          </Field>
          <Field id="motherName" label="Nome da mãe" required={req.has('motherName')} error={err('motherName')}>
            <input {...aria('motherName', err('motherName'))} name="motherName" type="text" defaultValue={patient?.motherName ?? ''} className={inputCls} />
          </Field>
          <Field id="fatherName" label="Nome do pai">
            <input id="fatherName" name="fatherName" type="text" defaultValue={patient?.fatherName ?? ''} className={inputCls} />
          </Field>
        </Group>
        <Group title="Atendimento prioritário">
          <div className="sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="priority" value="1" checked={priority} onChange={(e) => setPriority(e.target.checked)} className="h-4 w-4 accent-primary" />
              Tem atendimento prioritário
            </label>
          </div>
          {priority && (
            <Field id="priorityType" label="Motivo">
              <select id="priorityType" name="priorityType" defaultValue={patient?.priorityType ?? ''} className={inputCls}>
                <option value="">Escolha</option>
                {PRIORITY_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </Group>
        <Group title="Observações">
          <Field id="notes" label="Observações gerais" wide>
            <textarea id="notes" name="notes" rows={3} defaultValue={patient?.notes ?? ''} className={`${inputCls} resize-y`} />
          </Field>
        </Group>
      </div>

      {/* ── Marketing ────────────────────────────────────────────────── */}
      <div role="tabpanel" id={`${baseId}-panel-marketing`} aria-labelledby={`${baseId}-tab-marketing`} hidden={tab !== 'marketing'} className="space-y-4">
        <Group title="Perfil">
          <Field id="profession" label="Profissão">
            <input id="profession" name="profession" type="text" defaultValue={patient?.profession ?? ''} className={inputCls} />
          </Field>
          <Field id="education" label="Escolaridade">
            <select id="education" name="education" defaultValue={patient?.education ?? ''} className={inputCls}>
              <option value="">Não informada</option>
              {EDUCATION_OPTIONS.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </Field>
          <Field id="hobby" label="Hobby" wide>
            <input id="hobby" name="hobby" type="text" defaultValue={patient?.hobby ?? ''} className={inputCls} />
          </Field>
        </Group>
        <Group title="Como conheceu a clínica">
          <Field id="originId" label="Origem do paciente" required={req.has('origin')} error={err('originId')}>
            <select {...aria('originId', err('originId'))} name="originId" defaultValue={patient?.originId ?? ''} className={inputCls}>
              <option value="">Não informada</option>
              {origins.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="hidden sm:block" />
          <div className="space-y-1">
            <label htmlFor={`${baseId}-ref`} className="block text-sm font-medium">
              Indicado por (paciente)
            </label>
            <PatientPick id={`${baseId}-ref`} name="referredById" label="Indicado por" initial={patient?.referredByPatient ?? null} excludeId={patient?.id} />
          </div>
          <Field id="referredBy" label="Ou quem indicou (nome)">
            <input id="referredBy" name="referredBy" type="text" defaultValue={patient?.referredBy ?? ''} className={inputCls} />
          </Field>
        </Group>
        <Group title="Mensagens">
          <div className="sm:col-span-2 space-y-3">
            <input type="hidden" name="birthdayMessages" value="0" />
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="birthdayMessages" value="1" defaultChecked={patient?.birthdayMessages !== false} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>Recebe os parabéns da clínica pelo WhatsApp no aniversário.</span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="marketingConsent" value="1" defaultChecked={Boolean(patient?.marketingConsentAt)} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>
                Autoriza receber <strong>promoções e novidades</strong> da clínica pelo WhatsApp. Opcional: os lembretes de consulta saem de qualquer forma.
              </span>
            </label>
            {isEdit && patient?.marketingConsentAt && <p className="text-xs text-muted-foreground">Autorizado em {instantDateTimeBR(patient.marketingConsentAt)}</p>}
          </div>
        </Group>
      </div>

      {/* ── Informações adicionais ───────────────────────────────────── */}
      {ativos.length > 0 && (
        <div role="tabpanel" id={`${baseId}-panel-adicionais`} aria-labelledby={`${baseId}-tab-adicionais`} hidden={tab !== 'adicionais'} className="space-y-4">
          <fieldset className="rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-semibold">Informações adicionais</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {ativos.map((f) => (
                <CustomFieldInput key={f.id} def={f} value={answers[f.id]} error={err(`cf_${f.id}`)} onChange={(v) => setAnswers({ ...answers, [f.id]: v })} />
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {!isEdit && (
        <div className="rounded-xl border border-border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" name="lgpdConsent" value="1" className="mt-0.5 h-4 w-4 accent-primary" aria-describedby={err('lgpdConsent') ? 'lgpd-error' : undefined} />
            <span className="text-sm text-muted-foreground">
              O paciente autoriza guardar e usar os dados pessoais para o atendimento, conforme a <strong className="text-foreground">LGPD</strong>. A data e a hora do aceite ficam registradas.
            </span>
          </label>
          {err('lgpdConsent') && (
            <p id="lgpd-error" role="alert" className="mt-1 text-xs text-destructive">
              {err('lgpdConsent')}
            </p>
          )}
        </div>
      )}
      {isEdit && patient?.lgpdConsentAt && <p className="px-1 text-xs text-muted-foreground">Consentimento LGPD registrado em {instantDateTimeBR(patient.lgpdConsentAt)}</p>}

      <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-3 border-t border-border bg-canvas/95 px-1 py-3 backdrop-blur">
        <button type="button" onClick={() => router.back()} className="btn-outline btn-md">
          Cancelar
        </button>
        <button type="submit" disabled={isPending} className="btn-primary btn-md">
          {isPending ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Cadastrar paciente'}
        </button>
      </div>
    </form>
  );
}

/** Uma informação adicional no formulário, conforme o tipo. */
function CustomFieldInput({ def, value, error, onChange }: { def: CustomFieldDef; value?: { v: string | string[]; obs?: string }; error?: string; onChange: (v: { v: string | string[]; obs?: string }) => void }) {
  const id = `cf-${def.id}`;
  const v = value?.v ?? (def.type === 'MULTI' ? [] : '');
  const set = (nv: string | string[]) => onChange({ v: nv, ...(value?.obs ? { obs: value.obs } : {}) });
  const wide = def.type === 'LONG_TEXT' || def.type === 'MULTI';
  return (
    <div className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      {def.type === 'MULTI' || def.type === 'SINGLE' ? (
        <fieldset aria-describedby={error ? `${id}-error` : undefined}>
          <legend className="text-sm font-medium">
            {def.label}
            {def.required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
          </legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
            {def.options.map((o) => {
              const marcado = Array.isArray(v) ? v.includes(o) : v === o;
              return (
                <label key={o} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type={def.type === 'MULTI' ? 'checkbox' : 'radio'}
                    name={id}
                    checked={marcado}
                    onChange={() => {
                      if (def.type === 'SINGLE') set(o);
                      else {
                        const lista = Array.isArray(v) ? v : [];
                        set(marcado ? lista.filter((x) => x !== o) : [...lista, o]);
                      }
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  {o}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <>
          <label htmlFor={id} className="block text-sm font-medium">
            {def.label}
            {def.required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
          </label>
          {def.type === 'LONG_TEXT' ? (
            <textarea id={id} rows={3} value={typeof v === 'string' ? v : ''} onChange={(e) => set(e.target.value)} className={`${inputCls} resize-y`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} />
          ) : (
            <input
              id={id}
              type={def.type === 'DATE' ? 'date' : 'text'}
              inputMode={def.type === 'NUMBER' ? 'decimal' : undefined}
              value={typeof v === 'string' ? v : ''}
              onChange={(e) => set(e.target.value)}
              className={inputCls}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
            />
          )}
        </>
      )}
      {def.hasNote && (
        <input
          aria-label={`Observação de ${def.label}`}
          value={value?.obs ?? ''}
          onChange={(e) => onChange({ v, obs: e.target.value })}
          placeholder="Observação"
          className={`${inputCls} mt-1`}
        />
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** "CPF primeiro": pergunta o CPF antes do resto; o repetido abre o cadastro que já existe. */
function CpfStep({ initial, onContinue, onLater }: { initial: string; onContinue: (cpf: string) => void; onLater: () => void }) {
  const [cpf, setCpf] = useState(initial);
  const [erro, setErro] = useState<string | null>(null);
  const [achou, setAchou] = useState<{ id: string; name: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border bg-surface p-6 shadow-card">
      <h2 className="text-base font-semibold">Qual o CPF do paciente?</h2>
      <p className="mt-1 text-sm text-muted-foreground">Assim a clínica não cadastra a mesma pessoa duas vezes.</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setErro(null);
          setAchou(null);
          start(async () => {
            const r = await checkCpfAction(cpf);
            if (!r.ok) setErro(r.message);
            else if (r.found) setAchou(r.found);
            else onContinue(cpf);
          });
        }}
      >
        <label htmlFor="cpf-first" className="sr-only">
          CPF
        </label>
        <input
          id="cpf-first"
          autoFocus
          inputMode="numeric"
          value={cpf}
          onChange={(e) => setCpf(maskCpf(e.target.value))}
          placeholder="000.000.000-00"
          className={`${inputCls} text-base`}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? 'cpf-first-error' : undefined}
        />
        {erro && (
          <p id="cpf-first-error" role="alert" className="text-xs text-destructive">
            {erro}
          </p>
        )}
        {achou && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Este CPF já é de <strong>{achou.name}</strong>.
            <div className="mt-2">
              <Link href={`/pacientes/${achou.id}`} className="btn-primary btn-sm">
                Abrir o cadastro
              </Link>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" onClick={onLater} className="btn-ghost btn-sm">
            Preencher depois
          </button>
          <button type="submit" disabled={pending || cpf.replace(/\D/g, '').length !== 11} className="btn-primary btn-md">
            {pending ? 'Conferindo…' : 'Continuar'}
          </button>
        </div>
      </form>
    </div>
  );
}
