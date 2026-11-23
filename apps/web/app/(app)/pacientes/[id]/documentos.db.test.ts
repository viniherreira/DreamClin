import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: () => undefined,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'teste', 'x-forwarded-for': '10.0.0.9' }) }));

let logado: string | null = null;
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: logado }) }));

/**
 * Documentos (spec 2026-11-18, F3): links que não gravam ao abrir, assinatura
 * que confere o CPF e só vale uma vez, questionário que entra na anamnese,
 * envio pelo celular só dentro da validade, e documento clínico protegido.
 */
const envFile = resolve(__dirname, '..', '..', '..', '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('documentos do paciente (banco)', async () => {
  const { prisma, encrypt } = await import('@clinicaiq/db');
  const docs = await import('./docs-actions');
  const assinar = await import('@/app/assinar/[token]/actions');
  const quest = await import('@/app/questionario/[token]/actions');
  const enviar = await import('@/app/enviar/[token]/actions');
  const key = process.env.ENCRYPTION_MASTER_KEY!;

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await prisma.tenant.create({ data: { clerkOrgId: `dc_${suffix}`, name: 'Clínica Docs', slug: `dc-${suffix}`, settings: { privacy: { receptionSeesRecord: false } } } });
  await prisma.subscription.create({ data: { tenantId: tenant.id, tier: 'CLINICA', status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01'), complimentary: true } });
  const dono = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId: `user_dc_dono_${suffix}`, name: 'Dona', email: `dc-dono-${suffix}@teste.local`, role: 'OWNER' } });
  const recepcao = await prisma.user.create({ data: { tenantId: tenant.id, clerkUserId: `user_dc_rec_${suffix}`, name: 'Recepção', email: `dc-rec-${suffix}@teste.local`, role: 'RECEPTIONIST' } });
  const paciente = await prisma.patient.create({
    data: { tenantId: tenant.id, controlNumber: 1, name: 'Carla Souza', cpfEncrypted: encrypt('52998224725', key, tenant.id), phoneEncrypted: encrypt('11987650000', key, tenant.id), lgpdConsentAt: new Date() },
  });

  afterAll(async () => {
    const t = { tenantId: tenant.id };
    await prisma.signatureRequest.deleteMany({ where: t });
    await prisma.patientDocument.deleteMany({ where: t });
    await prisma.questionnaireRequest.deleteMany({ where: t });
    await prisma.questionnaire.deleteMany({ where: t });
    await prisma.uploadSession.deleteMany({ where: t });
    await prisma.patientFolder.deleteMany({ where: t });
    await prisma.anamnesis.deleteMany({ where: t });
    await prisma.documentTemplate.deleteMany({ where: t });
    await prisma.patientEvent.deleteMany({ where: t });
    await prisma.auditLog.deleteMany({ where: t });
    await prisma.patient.deleteMany({ where: t });
    await prisma.user.deleteMany({ where: t });
    await prisma.subscription.deleteMany({ where: t });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });

  it('modelo vira documento com as variáveis do paciente (nome civil) e o HTML limpo', async () => {
    logado = dono.clerkUserId;
    expect(await docs.saveTemplateAction({ kind: 'ATTENDANCE', name: 'Declaração', body: '<p>{paciente} esteve aqui em {data}.<script>x()</script></p>' })).toEqual({ ok: true });
    const t = await prisma.documentTemplate.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(t.body).not.toContain('script');
    const prev = await docs.previewTemplateAction(paciente.id, t.id, {});
    expect(prev).toMatchObject({ ok: true });
    if (!prev.ok) return;
    expect(prev.html).toContain('Carla Souza esteve aqui em');
  });

  it('a recepção sem prontuário não emite documento clínico', async () => {
    logado = recepcao.clerkUserId;
    const r = await docs.saveDocumentAction(paciente.id, { kind: 'PRESCRIPTION', title: 'Receita', body: '<p>Amoxicilina</p>' });
    expect(r).toMatchObject({ ok: false });
    const ok = await docs.saveDocumentAction(paciente.id, { kind: 'CONSENT', title: 'Termo', body: '<p>Concordo com o tratamento.</p>' });
    expect(ok).toMatchObject({ ok: true });
  });

  it('assinatura: abrir não grava; CPF errado é recusado; assina uma vez só', async () => {
    logado = recepcao.clerkUserId;
    const doc = await prisma.patientDocument.findFirstOrThrow({ where: { tenantId: tenant.id, kind: 'CONSENT' } });
    const pedido = await docs.requestSignatureAction(doc.id);
    expect(pedido).toMatchObject({ ok: true });
    if (!pedido.ok) return;
    const token = pedido.url.split('/').pop()!;

    expect((await assinar.getSignature(token))?.state).toBe('PENDING');
    expect((await prisma.signatureRequest.findUniqueOrThrow({ where: { token } })).status).toBe('PENDING');

    expect(await assinar.signDocument(token, { name: 'Carla Souza', cpf: '111.444.777-35', method: 'ACCEPTED', agree: true })).toMatchObject({ ok: false });
    expect(await assinar.signDocument(token, { name: 'Carla Souza', cpf: '529.982.247-25', method: 'ACCEPTED', agree: true })).toEqual({ ok: true });
    const s = await prisma.signatureRequest.findUniqueOrThrow({ where: { token } });
    expect(s.status).toBe('SIGNED');
    expect(s.ip).toBe('10.0.0.9');
    expect(s.pdfHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await assinar.signDocument(token, { name: 'Carla Souza', cpf: '52998224725', method: 'ACCEPTED', agree: true })).toMatchObject({ ok: false });
  });

  it('link vencido não assina', async () => {
    const doc = await prisma.patientDocument.findFirstOrThrow({ where: { tenantId: tenant.id, kind: 'CONSENT' } });
    const token = `vencido_${suffix}_abcdefghijk`;
    await prisma.signatureRequest.create({ data: { tenantId: tenant.id, patientId: paciente.id, documentId: doc.id, token, expiresAt: new Date(Date.now() - 1000) } });
    expect((await assinar.getSignature(token))?.state).toBe('EXPIRED');
    expect(await assinar.signDocument(token, { name: 'Carla Souza', cpf: '52998224725', method: 'ACCEPTED', agree: true })).toMatchObject({ ok: false });
  });

  it('questionário: responde uma vez e o sim/não vai para a anamnese', async () => {
    logado = dono.clerkUserId;
    expect(
      await docs.saveQuestionnaireAction({ name: 'Antes da consulta', health: true, questions: [{ id: 'a1', label: 'Tem alergia?', type: 'YESNO', options: [], required: true, anamnesisKey: 'allergy' }] }),
    ).toEqual({ ok: true });
    const q = await prisma.questionnaire.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const env = await docs.sendQuestionnaireAction(paciente.id, q.id);
    if (!env.ok) throw new Error(env.message);
    const token = env.url.split('/').pop()!;
    expect((await quest.getQuestionnaire(token))?.state).toBe('OPEN');
    expect((await prisma.questionnaireRequest.findUniqueOrThrow({ where: { token } })).openedAt).toBeNull();
    expect(await quest.submitQuestionnaire(token, {})).toMatchObject({ ok: false, errors: { a1: 'Obrigatório' } });
    expect(await quest.submitQuestionnaire(token, { a1: { v: 'Sim', obs: 'penicilina' } })).toEqual({ ok: true });
    expect(await quest.submitQuestionnaire(token, { a1: { v: 'Não' } })).toMatchObject({ ok: false });
    const an = await prisma.anamnesis.findFirstOrThrow({ where: { tenantId: tenant.id, patientId: paciente.id } });
    expect((an.answers as { items: Record<string, unknown> }).items.allergy).toEqual({ value: 'yes', detail: 'penicilina' });
  });

  it('respostas de saúde ficam fora da tela de quem não vê o prontuário', async () => {
    logado = recepcao.clerkUserId;
    const o = await docs.docsOverview(paciente.id);
    expect(o?.questionnaires[0].answeredAt).not.toBeNull();
    expect(o?.questionnaires[0].answers).toBeNull();
    logado = dono.clerkUserId;
    expect((await docs.docsOverview(paciente.id))?.questionnaires[0].answers).not.toBeNull();
  });

  it('envio pelo celular só vale dentro dos 15 minutos', async () => {
    const vencido = `upload_${suffix}_vencidoabcdef`;
    await prisma.uploadSession.create({ data: { tenantId: tenant.id, patientId: paciente.id, token: vencido, expiresAt: new Date(Date.now() - 1000) } });
    expect((await enviar.getUploadSession(vencido))?.open).toBe(false);
    expect(await enviar.startPhoneUpload(vencido, { name: 'a.jpg', type: 'image/jpeg', size: 1000 })).toMatchObject({ ok: false });
    expect(await enviar.finishPhoneUpload(vencido, { path: `${tenant.id}/${paciente.id}/x.jpg`, name: 'a.jpg', type: 'image/jpeg' })).toMatchObject({ ok: false });
  });

  it('pastas padrão: cria uma vez, sem repetir', async () => {
    logado = dono.clerkUserId;
    const a = await docs.loadDefaultFoldersAction(paciente.id);
    const b = await docs.loadDefaultFoldersAction(paciente.id);
    expect(a).toMatchObject({ ok: true, created: 4 });
    expect(b).toMatchObject({ ok: true, created: 0 });
  });
});
