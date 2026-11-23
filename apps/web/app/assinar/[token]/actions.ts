'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';
import { decrypt, prisma } from '@clinicaiq/db';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { canSign, cpfMatches, signatureState, validDrawing } from '@/lib/signature';
import { contentHash } from '@/lib/patient-docs';
import { recordPatientEvent } from '@/lib/patient-timeline';

/**
 * Assinatura por link (`/assinar/[token]`). Público: o token é a chave.
 * Abrir a página só lê; o "visualizado" vem do navegador do paciente (o robô
 * de pré-visualização do WhatsApp não conta), e assinar ou recusar grava.
 */

const tokenOk = (t: unknown): t is string => typeof t === 'string' && /^[\w-]{20,64}$/.test(t);

export async function getSignature(token: string) {
  if (!tokenOk(token)) return null;
  const r = await prisma.signatureRequest.findUnique({
    where: { token },
    select: {
      status: true,
      expiresAt: true,
      signedAt: true,
      tenant: { select: { name: true } },
      document: { select: { title: true, body: true, patientId: true } },
    },
  });
  if (!r) return null;
  const p = await prisma.patient.findUnique({ where: { id: r.document.patientId }, select: { name: true, socialName: true, cpfEncrypted: true } });
  return {
    state: signatureState(r),
    clinic: r.tenant.name,
    title: r.document.title,
    body: r.document.body,
    patientName: p?.socialName || p?.name || '',
    needsCpf: Boolean(p?.cpfEncrypted),
    signedAt: r.signedAt?.toISOString() ?? null,
  };
}

export async function markSignatureViewed(token: string): Promise<void> {
  if (!tokenOk(token)) return;
  await prisma.signatureRequest.updateMany({ where: { token, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'VIEWED', viewedAt: new Date() } });
}

type Result = { ok: true } | { ok: false; message: string };

export async function signDocument(token: string, input: { name: string; cpf: string; method: 'DRAWN' | 'ACCEPTED'; drawing?: string; agree: boolean }): Promise<Result> {
  if (!tokenOk(token)) return { ok: false, message: 'Link inválido.' };
  const h = await headers();
  const ip = clientIp(h);
  const limite = await rateLimit(`assinar:${ip}`, 20, 10 * 60 * 1000);
  if (!limite.ok) return { ok: false, message: 'Muitas tentativas. Espere alguns minutos e tente de novo.' };
  const r = await prisma.signatureRequest.findUnique({
    where: { token },
    select: { id: true, tenantId: true, patientId: true, status: true, expiresAt: true, document: { select: { id: true, title: true, body: true } }, tenant: { select: { name: true } } },
  });
  if (!r) return { ok: false, message: 'Link inválido.' };
  if (!canSign(r)) return { ok: false, message: signatureState(r) === 'SIGNED' ? 'Este documento já foi assinado.' : 'Este link não vale mais. Peça outro à clínica.' };
  if (!input.agree) return { ok: false, message: 'Marque que leu e concorda com o documento.' };
  const nome = (input.name ?? '').trim().slice(0, 120);
  if (nome.length < 3) return { ok: false, message: 'Escreva seu nome completo.' };
  const p = await prisma.patient.findUnique({ where: { id: r.patientId }, select: { name: true, cpfEncrypted: true } });
  let cpf = '';
  try {
    cpf = p?.cpfEncrypted ? decrypt(p.cpfEncrypted, process.env.ENCRYPTION_MASTER_KEY ?? '', r.tenantId) : '';
  } catch {}
  if (!cpfMatches(input.cpf, cpf)) return { ok: false, message: 'O CPF não confere com o cadastro da clínica.' };
  if (input.method === 'DRAWN' && !validDrawing(input.drawing)) return { ok: false, message: 'Desenhe a assinatura no quadro.' };
  const hash = contentHash({ title: r.document.title, body: r.document.body, clinic: r.tenant.name, patient: p?.name ?? '', code: r.document.id });
  const feito = await prisma.signatureRequest.updateMany({
    where: { id: r.id, status: { in: ['PENDING', 'VIEWED'] } },
    data: {
      status: 'SIGNED',
      signedAt: new Date(),
      method: input.method === 'DRAWN' ? 'DRAWN' : 'ACCEPTED',
      drawing: input.method === 'DRAWN' ? input.drawing : null,
      signerName: nome,
      ip,
      userAgent: (h.get('user-agent') ?? '').slice(0, 300),
      pdfHash: hash,
    },
  });
  if (!feito.count) return { ok: false, message: 'Este documento já foi assinado.' };
  after(() => recordPatientEvent(r.tenantId, r.patientId, 'document.signed', r.document.title, { actorLabel: 'Paciente pelo link', refType: 'document', refId: r.document.id }));
  return { ok: true };
}

export async function refuseDocument(token: string, reason: string): Promise<Result> {
  if (!tokenOk(token)) return { ok: false, message: 'Link inválido.' };
  const r = await prisma.signatureRequest.updateMany({
    where: { token, status: { in: ['PENDING', 'VIEWED'] }, expiresAt: { gt: new Date() } },
    data: { status: 'REFUSED', refusedAt: new Date(), refuseReason: (reason ?? '').trim().slice(0, 300) || null },
  });
  return r.count ? { ok: true } : { ok: false, message: 'Este link não vale mais.' };
}
