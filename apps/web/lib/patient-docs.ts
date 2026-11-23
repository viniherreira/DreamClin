import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { getTenantClient, prisma } from '@clinicaiq/db';
import { renderRichDocumentPdf, type SignatureProof } from '@clinicaiq/pdf';
import { docHtmlToBlocks, docKindLabel } from './doc-template';
import { loadClinicInfo, readEncrypted } from './documents';
import { answerText, readCustomAnswers } from './patient-fields';
import { ageFromBirth, CLINIC_TZ, instantDateLongBR, instantDateTimeBR, instantTimeBR, wallDateBR } from './tz';

/**
 * Documentos do paciente no servidor (spec 2026-11-18, F3): valores das
 * variáveis, o PDF (com a comprovação da assinatura), o código SHA-256 do
 * conteúdo, os links públicos e as pastas padrão.
 */

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** SHA-256 do conteúdo do documento (título + texto + clínica + paciente): o que a comprovação identifica. */
export function contentHash(parts: { title: string; body: string; clinic: string; patient: string; code: string }): string {
  return createHash('sha256').update(JSON.stringify([parts.code, parts.clinic, parts.patient, parts.title, parts.body])).digest('hex');
}

export const DEFAULT_FOLDERS = [
  { name: 'Exames', clinical: true },
  { name: 'Raio-X', clinical: true },
  { name: 'Fotos antes e depois', clinical: true },
  { name: 'Documentos pessoais', clinical: false },
] as const;

/** O padrão de pastas da clínica (`Tenant.settings.patients.folders`), ou o do DreamClin. */
export function readFolderDefaults(settings: unknown): { name: string; clinical: boolean }[] {
  const raw = (settings as { patients?: { folders?: unknown } } | null)?.patients?.folders;
  if (!Array.isArray(raw)) return DEFAULT_FOLDERS.map((f) => ({ ...f }));
  const out = raw
    .filter((f) => f && typeof f.name === 'string' && f.name.trim())
    .map((f) => ({ name: String(f.name).trim().slice(0, 60), clinical: f.clinical !== false }))
    .slice(0, 20);
  return out.length ? out : DEFAULT_FOLDERS.map((f) => ({ ...f }));
}

/** Cria as pastas padrão que faltam no paciente ("Carregar pastas padrão" e no cadastro novo). */
export async function ensureDefaultFolders(tenantId: string, patientId: string): Promise<number> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const padrao = readFolderDefaults(t?.settings);
  const r = await prisma.patientFolder.createMany({
    data: padrao.map((f, order) => ({ tenantId, patientId, name: f.name, clinical: f.clinical, order })),
    skipDuplicates: true,
  });
  return r.count;
}

/** Os valores das variáveis do modelo para este paciente. */
export async function docVariables(tenantId: string, patientId: string, opts: { professionalId?: string | null; procedure?: string; dias?: string } = {}) {
  const db = getTenantClient(tenantId);
  const [p, prof, tenant, campos] = await Promise.all([
    db.patient.findFirst({ where: { id: patientId }, select: { name: true, cpfEncrypted: true, birthDate: true, street: true, addressNumber: true, complement: true, neighborhood: true, city: true, state: true, customFields: true } }),
    opts.professionalId ? db.professional.findFirst({ where: { id: opts.professionalId }, select: { name: true, registration: true } }) : null,
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, city: true } }),
    db.patientCustomField.findMany({ where: { active: true }, select: { id: true, label: true, type: true } }),
  ]);
  if (!p) return null;
  const agora = new Date();
  const idade = ageFromBirth(p.birthDate);
  const respostas = readCustomAnswers(p.customFields);
  const fields: Record<string, string> = {};
  for (const c of campos) {
    const t = answerText(c, respostas[c.id]);
    if (t) fields[c.label.trim().toLowerCase()] = t;
  }
  return {
    vars: {
      // Documento oficial: o nome civil (`name`), não o social.
      paciente: p.name,
      cpf: readEncrypted(p.cpfEncrypted, tenantId)?.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
      nascimento: p.birthDate ? wallDateBR(p.birthDate) : undefined,
      idade: idade !== null ? `${idade} anos` : undefined,
      endereco: [[p.street, p.addressNumber].filter(Boolean).join(', '), p.complement, p.neighborhood, [p.city, p.state].filter(Boolean).join('/')].filter(Boolean).join(' - ') || undefined,
      data: new Intl.DateTimeFormat('pt-BR', { timeZone: CLINIC_TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(agora),
      hora: instantTimeBR(agora),
      profissional: prof?.name,
      registro_profissional: prof?.registration ?? undefined,
      clinica: tenant?.name,
      cidade: tenant?.city ?? undefined,
      procedimento: opts.procedure,
      dias: opts.dias,
    },
    fields,
  };
}

/** O PDF de um documento; com `proof`, a página de comprovação vai junto. */
export async function renderPatientDocumentPdf(tenantId: string, documentId: string, proof?: SignatureProof): Promise<Uint8Array | null> {
  const d = await prisma.patientDocument.findFirst({ where: { id: documentId, tenantId } });
  if (!d) return null;
  const [clinic, prof, t] = await Promise.all([
    loadClinicInfo(tenantId),
    d.professionalId ? prisma.professional.findFirst({ where: { id: d.professionalId, tenantId }, select: { name: true, registration: true } }) : null,
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { city: true } }),
  ]);
  return renderRichDocumentPdf({
    clinic,
    title: d.title || docKindLabel(d.kind),
    code: `DOC-${d.id.slice(-6).toUpperCase()}`,
    blocks: docHtmlToBlocks(d.body),
    signer: prof ? { name: prof.name, registration: prof.registration ?? undefined } : undefined,
    issuedAt: instantDateTimeBR(d.createdAt),
    placeDate: `${t?.city ? `${t.city}, ` : ''}${instantDateLongBR(d.createdAt)}.`,
    proof,
  });
}
