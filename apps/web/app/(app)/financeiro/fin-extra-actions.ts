'use server';

import { decrypt } from '@clinicaiq/db';
import { finRead, finWrite } from '@/fin/guard';
import { receiptBundle } from '@/fin/receipt';
import { contentMatchesType, fileHead } from '@/lib/file-sniff';
import { formatCents } from '@/lib/financeiro/money';
import { normalizeBrazilPhone } from '@/lib/phone';
import { deleteObject, signObject, storageEnabled, uploadObject } from '@/lib/storage';

/**
 * Anexos das contas (comprovante, nota, boleto) e o recibo pelo WhatsApp.
 */

type Result = { ok: true } | { ok: false; message: string };
const fail = (message: string): Result => ({ ok: false, message });

const ATTACH_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const ATTACH_MAX = 10 * 1024 * 1024;

/** Anexa um arquivo a uma conta. Fica no depósito privado; o link é assinado e curto. */
export async function uploadTitleAttachment(titleId: string, formData: FormData): Promise<Result> {
  const gate = await finWrite('fin_ver');
  if (!gate.ok) return gate;
  const { db, tenantId, userId } = gate.ctx;
  const t = await db.financialTitle.findFirst({ where: { id: titleId }, select: { direction: true } });
  if (!t) return fail('Conta não encontrada.');
  if (!gate.ctx.can(t.direction === 'RECEIVABLE' ? 'fin_receber' : 'fin_pagar')) return fail('Seu acesso não permite anexar nesta conta.');
  if (!storageEnabled()) return fail('O armazenamento de arquivos ainda não foi configurado.');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return fail('Selecione um arquivo.');
  if (!ATTACH_MIME.has(file.type)) return fail('Formato não suportado. Use JPG, PNG, WEBP ou PDF.');
  if (!contentMatchesType(file.type, await fileHead(file))) return fail('O arquivo não é do formato que diz ser. Envie a imagem ou o PDF original.');
  if (file.size > ATTACH_MAX) return fail('Arquivo muito grande (máximo de 10 MB).');
  if ((await db.financialAttachment.count({ where: { titleId } })) >= 10) return fail('Cada conta aceita até 10 anexos.');

  const seguro = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const bucketPath = `${tenantId}/financeiro/${titleId}/${crypto.randomUUID()}-${seguro}`;
  try {
    await uploadObject(bucketPath, file);
  } catch {
    return fail('Não foi possível enviar o arquivo. Tente de novo.');
  }
  const a = await db.financialAttachment.create({ data: { tenantId, titleId, bucketPath, filename: file.name.slice(-120), mimeType: file.type, sizeBytes: file.size, createdById: userId } });
  await db.auditLog.create({ data: { tenantId, userId, action: 'CREATE', entity: 'FinancialAttachment', entityId: a.id } });
  return { ok: true };
}

/** Link curto (10 minutos) para abrir um anexo. */
export async function attachmentUrl(id: string): Promise<string | null> {
  const gate = await finRead('fin_ver');
  if (!gate.ok || !storageEnabled()) return null;
  const a = await gate.ctx.db.financialAttachment.findFirst({ where: { id }, select: { bucketPath: true } });
  return a ? signObject(a.bucketPath, 600) : null;
}

export async function deleteTitleAttachment(id: string): Promise<Result> {
  const gate = await finWrite('fin_ver');
  if (!gate.ok) return gate;
  const { db, tenantId, userId } = gate.ctx;
  const a = await db.financialAttachment.findFirst({ where: { id }, select: { id: true, bucketPath: true } });
  if (!a) return fail('Anexo não encontrado.');
  if (storageEnabled()) await deleteObject(a.bucketPath).catch(() => undefined);
  await db.financialAttachment.deleteMany({ where: { id } });
  await db.auditLog.create({ data: { tenantId, userId, action: 'DELETE', entity: 'FinancialAttachment', entityId: id } });
  return { ok: true };
}

/**
 * O texto do recibo e o número do paciente, para abrir a conversa no WhatsApp
 * já escrita. Nulo se o recebimento não for de paciente, se ele pediu para não
 * receber mensagens ou se não tiver telefone válido.
 */
export async function receiptShare(receiptGroupId: string): Promise<{ phone: string; text: string } | null> {
  const gate = await finRead('fin_receber');
  if (!gate.ok) return null;
  const { db, tenantId } = gate.ctx;
  const recibo = await receiptBundle(receiptGroupId);
  if (!recibo?.patientId) return null;
  const p = await db.patient.findFirst({ where: { id: recibo.patientId }, select: { name: true, phoneEncrypted: true, whatsappOptOut: true } });
  if (!p || p.whatsappOptOut) return null;
  let phone = '';
  try {
    phone = normalizeBrazilPhone(decrypt(p.phoneEncrypted, process.env.ENCRYPTION_MASTER_KEY ?? '', tenantId)) ?? '';
  } catch {
    phone = '';
  }
  if (!phone) return null;
  const r = recibo.coupon.receipt;
  const text = [
    `Olá, ${p.name.split(' ')[0]}! Segue o seu recibo da ${recibo.coupon.clinic.name}.`,
    '',
    `Recibo ${r.number} · ${r.paidAt}`,
    `Valor recebido: ${formatCents(Math.round(r.amount * 100))}`,
    ...r.payments.map((x) => `${x.method}: ${formatCents(Math.round(x.amount * 100))}`),
    `Referente a ${r.reference}.`,
    '',
    'Obrigado!',
  ].join('\n');
  return { phone, text };
}
