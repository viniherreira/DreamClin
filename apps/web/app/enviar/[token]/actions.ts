'use server';

import { headers } from 'next/headers';
import { prisma } from '@clinicaiq/db';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { contentMatchesType } from '@/lib/file-sniff';
import { deleteObject, objectHead, signUploadUrl, storageEnabled } from '@/lib/storage';

/**
 * "Enviar pelo celular" (`/enviar/[token]`): por 15 minutos, quem tem o link
 * (a recepção ou o paciente) sobe fotos e PDFs para a pasta escolhida daquele
 * paciente. Nada além disso: não lista nem mostra os arquivos que já existem.
 */

const tokenOk = (t: unknown): t is string => typeof t === 'string' && /^[\w-]{20,64}$/.test(t);
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_UPLOADS = 30;

async function sessao(token: string) {
  if (!tokenOk(token)) return null;
  const s = await prisma.uploadSession.findUnique({ where: { token }, select: { id: true, tenantId: true, patientId: true, folderId: true, expiresAt: true, uploads: true } });
  if (!s || s.expiresAt <= new Date() || s.uploads >= MAX_UPLOADS) return null;
  return s;
}

export async function getUploadSession(token: string) {
  if (!tokenOk(token)) return null;
  const s = await prisma.uploadSession.findUnique({ where: { token }, select: { tenantId: true, patientId: true, folderId: true, expiresAt: true, uploads: true, tenant: { select: { name: true } } } });
  if (!s) return null;
  const [p, f] = await Promise.all([
    prisma.patient.findUnique({ where: { id: s.patientId }, select: { name: true, socialName: true } }),
    s.folderId ? prisma.patientFolder.findUnique({ where: { id: s.folderId }, select: { name: true } }) : null,
  ]);
  return {
    clinic: s.tenant.name,
    // Só o primeiro nome: o link pode estar na mão de outra pessoa.
    firstName: (p?.socialName || p?.name || '').split(' ')[0],
    folder: f?.name ?? 'Sem pasta',
    expiresAt: s.expiresAt.toISOString(),
    open: s.expiresAt > new Date() && s.uploads < MAX_UPLOADS,
  };
}

export async function startPhoneUpload(token: string, input: { name: string; type: string; size: number }): Promise<{ ok: true; url: string; path: string } | { ok: false; message: string }> {
  const limite = await rateLimit(`enviar:${clientIp(await headers())}`, 60, 10 * 60 * 1000);
  if (!limite.ok) return { ok: false, message: 'Muitos envios seguidos. Espere um pouco.' };
  const s = await sessao(token);
  if (!s) return { ok: false, message: 'Este link não vale mais. Peça outro QR code à clínica.' };
  if (!storageEnabled()) return { ok: false, message: 'Envio indisponível agora.' };
  if (!ALLOWED.has(input.type)) return { ok: false, message: 'Envie foto (JPG, PNG, WEBP, HEIC) ou PDF.' };
  if (!(input.size > 0) || input.size > MAX_BYTES) return { ok: false, message: 'Arquivo muito grande (até 10 MB).' };
  const safe = (input.name ?? 'foto').replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${s.tenantId}/${s.patientId}/${crypto.randomUUID()}-${safe}`;
  const url = await signUploadUrl(path);
  return url ? { ok: true, url, path } : { ok: false, message: 'Não foi possível preparar o envio.' };
}

export async function finishPhoneUpload(token: string, input: { path: string; name: string; type: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const s = await sessao(token);
  if (!s) return { ok: false, message: 'Este link não vale mais.' };
  if (!input.path?.startsWith(`${s.tenantId}/${s.patientId}/`) || input.path.includes('..')) return { ok: false, message: 'Envio inválido.' };
  const head = await objectHead(input.path);
  if (!head || head.size > MAX_BYTES || !ALLOWED.has(input.type) || !contentMatchesType(input.type, head.head)) {
    await deleteObject(input.path).catch(() => undefined);
    return { ok: false, message: 'O arquivo não é uma foto ou PDF válido.' };
  }
  const pasta = s.folderId ? await prisma.patientFolder.findFirst({ where: { id: s.folderId, tenantId: s.tenantId }, select: { clinical: true } }) : null;
  await prisma.$transaction([
    prisma.patientFile.create({
      data: {
        tenantId: s.tenantId,
        patientId: s.patientId,
        bucketPath: input.path,
        filename: (input.name ?? 'foto').slice(-120),
        mimeType: input.type,
        sizeBytes: head.size,
        folderId: s.folderId,
        clinical: pasta?.clinical ?? true,
        description: 'Enviado pelo celular',
      },
    }),
    prisma.uploadSession.update({ where: { id: s.id }, data: { uploads: { increment: 1 } } }),
  ]);
  return { ok: true };
}
