'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getTenantClient, prisma, type Prisma } from '@clinicaiq/db';
import { capabilityBlocked, hasCapability, writeBlocked } from '@/lib/access';
import { currentAccess } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { isClinicalKind, isDocKind, renderTemplate, sanitizeDocHtml } from '@/lib/doc-template';
import { LINK_TTL_MS, signatureState } from '@/lib/signature';
import { readQuestions } from '@/lib/questionnaire';
import { contentMatchesType } from '@/lib/file-sniff';
import { deleteObject, objectHead, signObject, signUploadUrl, storageEnabled } from '@/lib/storage';
import { recordPatientEvent } from '@/lib/patient-timeline';
import { docVariables, ensureDefaultFolders, newToken, readFolderDefaults } from '@/lib/patient-docs';
import { siteUrl } from '@/lib/company';

/**
 * Documentos, assinaturas, anexos e questionários do paciente (spec
 * 2026-11-18, F3). O que é clínico (atestado, receita, exame, laudo, fotos e
 * exames, respostas de saúde) só para quem vê o prontuário.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function ctx(write = true) {
  const acesso = await currentAccess();
  if (!acesso) return { ok: false as const, message: 'Entre de novo.' };
  if (!(await pacienteAgendaEnabled(acesso.tenantId))) return { ok: false as const, message: 'Função ainda não liberada para esta clínica.' };
  const bloqueio = (write ? await writeBlocked(acesso.tenantId) : null) ?? (await capabilityBlocked(acesso.tenantId, 'pacientes'));
  if (bloqueio) return { ok: false as const, message: bloqueio };
  const prontuario = await hasCapability(acesso.tenantId, 'prontuario');
  return { ok: true as const, tenantId: acesso.tenantId, userId: acesso.userId, role: acesso.role, prontuario };
}

async function ownPatient(tenantId: string, patientId: string) {
  return Boolean(await prisma.patient.findFirst({ where: { id: patientId, tenantId, deletedAt: null }, select: { id: true } }));
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;

// ─── Leitura ────────────────────────────────────────────────────────────────

export async function docsOverview(patientId: string) {
  const c = await ctx(false);
  if (!c.ok || !(await ownPatient(c.tenantId, patientId))) return null;
  const db = getTenantClient(c.tenantId);
  const [docs, sigs, folders, files, reqs, templates, questionnaires, professionals] = await Promise.all([
    db.patientDocument.findMany({
      where: { patientId, ...(c.prontuario ? {} : { clinical: false }) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, kind: true, title: true, clinical: true, createdAt: true, signatures: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, expiresAt: true, token: true } } },
    }),
    db.signatureRequest.findMany({
      where: { patientId, ...(c.prontuario ? {} : { document: { clinical: false } }) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true, status: true, expiresAt: true, signedAt: true, createdAt: true, method: true, document: { select: { id: true, title: true, kind: true } } },
    }),
    db.patientFolder.findMany({ where: { patientId, ...(c.prontuario ? {} : { clinical: false }) }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    db.patientFile.findMany({
      where: { patientId, ...(c.prontuario ? {} : { clinical: false }) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, folderId: true, bucketPath: true, createdAt: true, createdById: true, clinical: true },
    }),
    db.questionnaireRequest.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true, createdAt: true, openedAt: true, answeredAt: true, expiresAt: true, answers: true, questionnaire: { select: { name: true, health: true, questions: true } } },
    }),
    db.documentTemplate.findMany({ where: { active: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }], select: { id: true, kind: true, name: true } }),
    db.questionnaire.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.professional.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const base = siteUrl();
  const [podeApagarTudo] = await Promise.all([hasCapability(c.tenantId, 'anexos_apagar')]);
  return {
    canClinical: c.prontuario,
    docs: docs.map((d) => ({ ...d, signature: d.signatures[0] ? signatureState(d.signatures[0]) : null })),
    signatures: sigs.map((s) => ({ ...s, state: signatureState(s), url: `${base}/assinar/${s.token}` })),
    folders,
    files: await Promise.all(
      files.map(async ({ bucketPath, createdById, ...f }) => ({
        ...f,
        url: storageEnabled() ? await signObject(bucketPath, 900) : null,
        canDelete: podeApagarTudo || (c.role === 'PROFESSIONAL' && createdById === c.userId),
      })),
    ),
    questionnaires: reqs.map((r) => {
      const saude = r.questionnaire.health;
      const podeVer = !saude || c.prontuario;
      return {
        id: r.id,
        name: r.questionnaire.name,
        url: `${base}/questionario/${r.token}`,
        createdAt: r.createdAt,
        openedAt: r.openedAt,
        answeredAt: r.answeredAt,
        expired: !r.answeredAt && r.expiresAt < new Date(),
        health: saude,
        answers: podeVer && r.answers ? { questions: readQuestions(r.questionnaire.questions), values: r.answers as Record<string, { v: string | string[]; obs?: string }> } : null,
      };
    }),
    templates,
    questionnaireOptions: questionnaires,
    professionals,
  };
}

export type DocsOverview = NonNullable<Awaited<ReturnType<typeof docsOverview>>>;

// ─── Documentos ─────────────────────────────────────────────────────────────

/** O modelo com as variáveis do paciente já trocadas, para a pessoa revisar antes de salvar. */
export async function previewTemplateAction(patientId: string, templateId: string, opts: { professionalId?: string; dias?: string; procedure?: string }): Promise<Result<{ html: string; kind: string; title: string }>> {
  const c = await ctx(false);
  if (!c.ok) return c;
  const t = await getTenantClient(c.tenantId).documentTemplate.findFirst({ where: { id: templateId }, select: { body: true, kind: true, name: true } });
  if (!t) return { ok: false, message: 'Modelo não encontrado.' };
  if (isClinicalKind(t.kind) && !c.prontuario) return { ok: false, message: 'Documento clínico: só quem vê o prontuário.' };
  const v = await docVariables(c.tenantId, patientId, { professionalId: opts.professionalId, dias: opts.dias?.replace(/\D/g, '').slice(0, 3), procedure: opts.procedure?.slice(0, 80) });
  if (!v) return { ok: false, message: 'Paciente não encontrado.' };
  return { ok: true, html: sanitizeDocHtml(renderTemplate(t.body, v.vars, v.fields)), kind: t.kind, title: t.name };
}

export async function saveDocumentAction(
  patientId: string,
  input: { id?: string; templateId?: string | null; kind: string; title: string; body: string; professionalId?: string | null; appointmentId?: string | null },
): Promise<Result<{ id: string }>> {
  const c = await ctx();
  if (!c.ok) return c;
  if (!isDocKind(input.kind)) return { ok: false, message: 'Tipo de documento inválido.' };
  const clinico = isClinicalKind(input.kind);
  if (clinico && !c.prontuario) return { ok: false, message: 'Documento clínico: só quem vê o prontuário.' };
  if (!(await ownPatient(c.tenantId, patientId))) return { ok: false, message: 'Paciente não encontrado.' };
  const body = sanitizeDocHtml(input.body ?? '');
  if (!body.replace(/<[^>]+>/g, '').trim()) return { ok: false, message: 'O documento está vazio.' };
  const title = (input.title ?? '').trim().slice(0, 120) || 'Documento';
  if (input.professionalId && !(await prisma.professional.count({ where: { id: input.professionalId, tenantId: c.tenantId } }))) return { ok: false, message: 'Profissional não encontrado.' };
  if (input.appointmentId && !(await prisma.appointment.count({ where: { id: input.appointmentId, tenantId: c.tenantId, patientId } }))) return { ok: false, message: 'Agendamento não encontrado.' };
  if (input.id) {
    const atual = await getTenantClient(c.tenantId).patientDocument.findFirst({ where: { id: input.id, patientId }, select: { id: true, signatures: { where: { status: 'SIGNED' }, select: { id: true } } } });
    if (!atual) return { ok: false, message: 'Documento não encontrado.' };
    if (atual.signatures.length) return { ok: false, message: 'Documento já assinado não muda. Crie outro.' };
    await prisma.patientDocument.update({ where: { id: input.id, tenantId: c.tenantId }, data: { title, body, kind: input.kind, clinical: clinico, professionalId: input.professionalId || null } });
    revalidatePath(`/pacientes/${patientId}`);
    return { ok: true, id: input.id };
  }
  const d = await prisma.patientDocument.create({
    data: { tenantId: c.tenantId, patientId, templateId: input.templateId || null, kind: input.kind, title, body, clinical: clinico, professionalId: input.professionalId || null, appointmentId: input.appointmentId || null, createdById: c.userId },
  });
  await prisma.auditLog.create({ data: { tenantId: c.tenantId, userId: c.userId, action: 'DOCUMENT_ISSUED', entity: 'PatientDocument', entityId: d.id, metadata: { kind: input.kind } } });
  after(() => recordPatientEvent(c.tenantId, patientId, 'document.issued', title, { actorId: c.userId, refType: 'document', refId: d.id }));
  revalidatePath(`/pacientes/${patientId}`);
  return { ok: true, id: d.id };
}

/** Pede a assinatura: um link de 7 dias. Abrir o link não grava nada; quem assina é o paciente. */
export async function requestSignatureAction(documentId: string): Promise<Result<{ url: string }>> {
  const c = await ctx();
  if (!c.ok) return c;
  const d = await getTenantClient(c.tenantId).patientDocument.findFirst({ where: { id: documentId }, select: { patientId: true, clinical: true } });
  if (!d) return { ok: false, message: 'Documento não encontrado.' };
  if (d.clinical && !c.prontuario) return { ok: false, message: 'Documento clínico: só quem vê o prontuário.' };
  const token = newToken();
  await prisma.signatureRequest.create({ data: { tenantId: c.tenantId, patientId: d.patientId, documentId, token, expiresAt: new Date(Date.now() + LINK_TTL_MS.signature), createdById: c.userId } });
  revalidatePath(`/pacientes/${d.patientId}`);
  return { ok: true, url: `${siteUrl()}/assinar/${token}` };
}

// ─── Questionários ──────────────────────────────────────────────────────────

export async function sendQuestionnaireAction(patientId: string, questionnaireId: string, appointmentId?: string | null): Promise<Result<{ url: string }>> {
  const c = await ctx();
  if (!c.ok) return c;
  if (!(await ownPatient(c.tenantId, patientId))) return { ok: false, message: 'Paciente não encontrado.' };
  const q = await getTenantClient(c.tenantId).questionnaire.findFirst({ where: { id: questionnaireId, active: true }, select: { name: true } });
  if (!q) return { ok: false, message: 'Questionário não encontrado.' };
  const token = newToken();
  await prisma.questionnaireRequest.create({
    data: { tenantId: c.tenantId, patientId, questionnaireId, token, expiresAt: new Date(Date.now() + LINK_TTL_MS.questionnaire), appointmentId: appointmentId || null, createdById: c.userId },
  });
  after(() => recordPatientEvent(c.tenantId, patientId, 'questionnaire.sent', q.name, { actorId: c.userId }));
  revalidatePath(`/pacientes/${patientId}`);
  return { ok: true, url: `${siteUrl()}/questionario/${token}` };
}

// ─── Pastas e anexos ────────────────────────────────────────────────────────

export async function loadDefaultFoldersAction(patientId: string): Promise<Result<{ created: number }>> {
  const c = await ctx();
  if (!c.ok) return c;
  if (!(await ownPatient(c.tenantId, patientId))) return { ok: false, message: 'Paciente não encontrado.' };
  const created = await ensureDefaultFolders(c.tenantId, patientId);
  revalidatePath(`/pacientes/${patientId}`);
  return { ok: true, created };
}

export async function createFolderAction(patientId: string, name: string, clinical: boolean): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return c;
  if (clinical && !c.prontuario) return { ok: false, message: 'Pasta clínica: só quem vê o prontuário.' };
  const nome = (name ?? '').trim().slice(0, 60);
  if (!nome) return { ok: false, message: 'Dê um nome à pasta.' };
  if (!(await ownPatient(c.tenantId, patientId))) return { ok: false, message: 'Paciente não encontrado.' };
  const igual = await getTenantClient(c.tenantId).patientFolder.findFirst({ where: { patientId, name: nome } });
  if (igual) return { ok: false, message: 'Já existe uma pasta com esse nome.' };
  await prisma.patientFolder.create({ data: { tenantId: c.tenantId, patientId, name: nome, clinical } });
  revalidatePath(`/pacientes/${patientId}`);
  return { ok: true };
}

async function folderOf(tenantId: string, patientId: string, folderId: string | null | undefined) {
  if (!folderId) return null;
  return getTenantClient(tenantId).patientFolder.findFirst({ where: { id: folderId, patientId }, select: { id: true, clinical: true } });
}

/** Passo 1 do envio: confere o arquivo e devolve o endereço para o navegador mandar direto ao armazenamento. */
export async function startUploadAction(patientId: string, input: { name: string; type: string; size: number; folderId?: string | null }): Promise<Result<{ url: string; path: string }>> {
  const c = await ctx();
  if (!c.ok) return c;
  if (!storageEnabled()) return { ok: false, message: 'O armazenamento de arquivos não está ligado.' };
  if (!(await ownPatient(c.tenantId, patientId))) return { ok: false, message: 'Paciente não encontrado.' };
  if (!ALLOWED_MIME.has(input.type)) return { ok: false, message: 'Formato não suportado. Use JPG, PNG, WEBP, HEIC ou PDF.' };
  if (!(input.size > 0) || input.size > MAX_BYTES) return { ok: false, message: 'Arquivo muito grande (até 10 MB).' };
  const pasta = await folderOf(c.tenantId, patientId, input.folderId);
  if (input.folderId && !pasta) return { ok: false, message: 'Pasta não encontrada.' };
  if ((pasta?.clinical ?? true) && !c.prontuario) return { ok: false, message: 'Fotos e exames: só quem vê o prontuário.' };
  const safe = (input.name ?? 'arquivo').replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${c.tenantId}/${patientId}/${crypto.randomUUID()}-${safe}`;
  const url = await signUploadUrl(path);
  if (!url) return { ok: false, message: 'Não foi possível preparar o envio. Tente de novo.' };
  return { ok: true, url, path };
}

/** Passo 2: o arquivo chegou? Confere tamanho e tipo de verdade e só então registra. */
export async function finishUploadAction(patientId: string, input: { path: string; name: string; type: string; folderId?: string | null; appointmentId?: string | null }): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return c;
  if (!input.path?.startsWith(`${c.tenantId}/${patientId}/`) || input.path.includes('..')) return { ok: false, message: 'Envio inválido.' };
  const pasta = await folderOf(c.tenantId, patientId, input.folderId);
  const clinico = pasta?.clinical ?? true;
  if (clinico && !c.prontuario) return { ok: false, message: 'Fotos e exames: só quem vê o prontuário.' };
  const head = await objectHead(input.path);
  if (!head || head.size > MAX_BYTES || !ALLOWED_MIME.has(input.type) || !contentMatchesType(input.type, head.head)) {
    await deleteObject(input.path).catch(() => undefined);
    return { ok: false, message: 'O arquivo não é do formato que diz ser, ou passou de 10 MB.' };
  }
  if (input.appointmentId && !(await prisma.appointment.count({ where: { id: input.appointmentId, tenantId: c.tenantId, patientId } }))) return { ok: false, message: 'Agendamento não encontrado.' };
  const f = await prisma.patientFile.create({
    data: {
      tenantId: c.tenantId,
      patientId,
      bucketPath: input.path,
      filename: (input.name ?? 'arquivo').slice(-120),
      mimeType: input.type,
      sizeBytes: head.size,
      folderId: pasta?.id ?? null,
      appointmentId: input.appointmentId || null,
      clinical: clinico,
      createdById: c.userId,
    },
  });
  await prisma.auditLog.create({ data: { tenantId: c.tenantId, userId: c.userId, action: 'CREATE', entity: 'PatientFile', entityId: f.id } });
  revalidatePath(`/pacientes/${patientId}`);
  return { ok: true };
}

export async function moveFileAction(fileId: string, folderId: string | null): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return c;
  const f = await getTenantClient(c.tenantId).patientFile.findFirst({ where: { id: fileId }, select: { patientId: true, clinical: true } });
  if (!f) return { ok: false, message: 'Arquivo não encontrado.' };
  if (f.clinical && !c.prontuario) return { ok: false, message: 'Sem acesso ao prontuário.' };
  const pasta = await folderOf(c.tenantId, f.patientId, folderId);
  if (folderId && !pasta) return { ok: false, message: 'Pasta não encontrada.' };
  // Mudar de uma pasta clínica para uma comum (ou o contrário) muda quem vê.
  if (pasta && pasta.clinical !== f.clinical && !c.prontuario) return { ok: false, message: 'Sem acesso ao prontuário.' };
  await prisma.patientFile.update({ where: { id: fileId, tenantId: c.tenantId }, data: { folderId, ...(pasta ? { clinical: pasta.clinical } : {}) } });
  revalidatePath(`/pacientes/${f.patientId}`);
  return { ok: true };
}

export async function renameFileAction(fileId: string, name: string): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return c;
  const nome = (name ?? '').trim().slice(0, 120);
  if (!nome) return { ok: false, message: 'Dê um nome ao arquivo.' };
  const f = await getTenantClient(c.tenantId).patientFile.findFirst({ where: { id: fileId }, select: { patientId: true, clinical: true } });
  if (!f) return { ok: false, message: 'Arquivo não encontrado.' };
  if (f.clinical && !c.prontuario) return { ok: false, message: 'Sem acesso ao prontuário.' };
  await prisma.patientFile.update({ where: { id: fileId, tenantId: c.tenantId }, data: { filename: nome } });
  revalidatePath(`/pacientes/${f.patientId}`);
  return { ok: true };
}

/** Apagar: dono e administrador; o profissional, só o que ele mesmo subiu. */
export async function deleteFileAction(fileId: string): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return c;
  const f = await getTenantClient(c.tenantId).patientFile.findFirst({ where: { id: fileId }, select: { patientId: true, clinical: true, bucketPath: true, createdById: true } });
  if (!f) return { ok: false, message: 'Arquivo não encontrado.' };
  const pode = (await hasCapability(c.tenantId, 'anexos_apagar')) || (c.role === 'PROFESSIONAL' && f.createdById === c.userId);
  if (!pode) return { ok: false, message: 'Seu perfil não apaga anexos.' };
  if (f.clinical && !c.prontuario) return { ok: false, message: 'Sem acesso ao prontuário.' };
  if (storageEnabled()) await deleteObject(f.bucketPath).catch(() => undefined);
  await prisma.patientFile.delete({ where: { id: fileId } });
  await prisma.auditLog.create({ data: { tenantId: c.tenantId, userId: c.userId, action: 'DELETE', entity: 'PatientFile', entityId: fileId } });
  revalidatePath(`/pacientes/${f.patientId}`);
  return { ok: true };
}

/** "Enviar pelo celular": link de 15 minutos, só para este paciente e esta pasta. */
export async function createUploadSessionAction(patientId: string, folderId: string | null): Promise<Result<{ url: string; expiresAt: string }>> {
  const c = await ctx();
  if (!c.ok) return c;
  if (!storageEnabled()) return { ok: false, message: 'O armazenamento de arquivos não está ligado.' };
  if (!(await ownPatient(c.tenantId, patientId))) return { ok: false, message: 'Paciente não encontrado.' };
  const pasta = await folderOf(c.tenantId, patientId, folderId);
  if (folderId && !pasta) return { ok: false, message: 'Pasta não encontrada.' };
  if ((pasta?.clinical ?? true) && !c.prontuario) return { ok: false, message: 'Fotos e exames: só quem vê o prontuário.' };
  const token = newToken();
  const expiresAt = new Date(Date.now() + LINK_TTL_MS.upload);
  await prisma.uploadSession.create({ data: { tenantId: c.tenantId, patientId, folderId: pasta?.id ?? null, token, expiresAt, createdById: c.userId } });
  return { ok: true, url: `${siteUrl()}/enviar/${token}`, expiresAt: expiresAt.toISOString() };
}

// ─── Configurações: modelos, questionários e pastas padrão ──────────────────

async function cfg() {
  const acesso = await currentAccess();
  if (!acesso) return { ok: false as const, message: 'Entre de novo.' };
  if (!(await pacienteAgendaEnabled(acesso.tenantId))) return { ok: false as const, message: 'Função ainda não liberada para esta clínica.' };
  const bloqueio = (await writeBlocked(acesso.tenantId)) ?? (await capabilityBlocked(acesso.tenantId, 'configuracoes'));
  if (bloqueio) return { ok: false as const, message: bloqueio };
  return { ok: true as const, tenantId: acesso.tenantId, userId: acesso.userId };
}

export async function listTemplatesAction() {
  const acesso = await currentAccess();
  if (!acesso || !(await pacienteAgendaEnabled(acesso.tenantId))) return { templates: [], questionnaires: [], folders: [] };
  const db = getTenantClient(acesso.tenantId);
  const [templates, questionnaires, t] = await Promise.all([
    db.documentTemplate.findMany({ where: { active: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }], select: { id: true, kind: true, name: true, body: true } }),
    db.questionnaire.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, health: true, questions: true } }),
    prisma.tenant.findUnique({ where: { id: acesso.tenantId }, select: { settings: true } }),
  ]);
  return { templates, questionnaires: questionnaires.map((q) => ({ ...q, questions: readQuestions(q.questions) })), folders: readFolderDefaults(t?.settings) };
}

export async function saveTemplateAction(input: { id?: string; kind: string; name: string; body: string }): Promise<Result> {
  const c = await cfg();
  if (!c.ok) return c;
  if (!isDocKind(input.kind)) return { ok: false, message: 'Tipo inválido.' };
  const name = (input.name ?? '').trim().slice(0, 80);
  if (!name) return { ok: false, message: 'Dê um nome ao modelo.' };
  const body = sanitizeDocHtml(input.body ?? '');
  if (input.id) {
    const r = await prisma.documentTemplate.updateMany({ where: { id: input.id, tenantId: c.tenantId }, data: { kind: input.kind, name, body } });
    if (!r.count) return { ok: false, message: 'Modelo não encontrado.' };
  } else await prisma.documentTemplate.create({ data: { tenantId: c.tenantId, kind: input.kind, name, body } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

export async function archiveTemplateAction(id: string): Promise<Result> {
  const c = await cfg();
  if (!c.ok) return c;
  await prisma.documentTemplate.updateMany({ where: { id, tenantId: c.tenantId }, data: { active: false } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

export async function saveQuestionnaireAction(input: { id?: string; name: string; health: boolean; questions: unknown }): Promise<Result> {
  const c = await cfg();
  if (!c.ok) return c;
  const name = (input.name ?? '').trim().slice(0, 80);
  if (!name) return { ok: false, message: 'Dê um nome ao questionário.' };
  const questions = readQuestions(input.questions);
  if (!questions.length) return { ok: false, message: 'Coloque pelo menos uma pergunta.' };
  const data = { name, health: input.health !== false, questions: questions as unknown as Prisma.InputJsonValue };
  if (input.id) {
    const r = await prisma.questionnaire.updateMany({ where: { id: input.id, tenantId: c.tenantId }, data });
    if (!r.count) return { ok: false, message: 'Questionário não encontrado.' };
  } else await prisma.questionnaire.create({ data: { ...data, tenantId: c.tenantId } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

export async function archiveQuestionnaireAction(id: string): Promise<Result> {
  const c = await cfg();
  if (!c.ok) return c;
  await prisma.questionnaire.updateMany({ where: { id, tenantId: c.tenantId }, data: { active: false } });
  revalidatePath('/configuracoes');
  return { ok: true };
}

export async function saveFolderDefaultsAction(folders: { name: string; clinical: boolean }[]): Promise<Result> {
  const c = await cfg();
  if (!c.ok) return c;
  const lista = readFolderDefaults({ patients: { folders } });
  const t = await prisma.tenant.findUnique({ where: { id: c.tenantId }, select: { settings: true } });
  const atual = (t?.settings ?? {}) as Record<string, unknown>;
  await prisma.tenant.update({
    where: { id: c.tenantId },
    data: { settings: JSON.parse(JSON.stringify({ ...atual, patients: { ...((atual.patients as Record<string, unknown>) ?? {}), folders: lista } })) as Prisma.InputJsonValue },
  });
  revalidatePath('/configuracoes');
  return { ok: true };
}
