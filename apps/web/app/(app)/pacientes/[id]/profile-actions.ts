'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getTenantClient, prisma, Prisma } from '@clinicaiq/db';
import { capabilityBlocked, writeBlocked } from '@/lib/access';
import { currentAccess } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { typesOfGroup } from '@/lib/patient-events';
import { recordPatientEvent } from '@/lib/patient-timeline';
import { deleteObject, storageEnabled, uploadObject } from '@/lib/storage';
import { contentMatchesType, fileHead } from '@/lib/file-sniff';
import { isKind, KINDS } from '@/lib/odontogram';
import { loadTimelinePage, type TimelineItem } from './profile-data';

/**
 * Ações do perfil novo do paciente (spec 2026-11-18, F2): linha do tempo,
 * observações (fixar, aparecer na agenda, editar a própria), planos de
 * tratamento e foto. Todas conferem a clínica, o perfil e se a conta grava.
 */

type Result = { ok: true } | { ok: false; message: string };

async function ctx(cap: 'pacientes' | 'prontuario' = 'pacientes', write = true) {
  const acesso = await currentAccess();
  if (!acesso) return { ok: false as const, message: 'Entre de novo.' };
  if (!(await pacienteAgendaEnabled(acesso.tenantId))) return { ok: false as const, message: 'Função ainda não liberada para esta clínica.' };
  const bloqueio = (write ? await writeBlocked(acesso.tenantId) : null) ?? (await capabilityBlocked(acesso.tenantId, cap));
  if (bloqueio) return { ok: false as const, message: bloqueio };
  return { ok: true as const, tenantId: acesso.tenantId, userId: acesso.userId, role: acesso.role };
}

async function ownPatient(tenantId: string, patientId: string) {
  return Boolean(await prisma.patient.findFirst({ where: { id: patientId, tenantId, deletedAt: null }, select: { id: true } }));
}

// ─── Linha do tempo ─────────────────────────────────────────────────────────

export async function timelineAction(patientId: string, opts: { before?: string; group?: string }): Promise<{ items: TimelineItem[]; more: boolean }> {
  const c = await ctx('pacientes', false);
  if (!c.ok || !(await ownPatient(c.tenantId, patientId))) return { items: [], more: false };
  const before = opts.before ? new Date(opts.before) : undefined;
  return loadTimelinePage(c.tenantId, patientId, { before: before && !Number.isNaN(before.getTime()) ? before : undefined, types: opts.group ? typesOfGroup(opts.group) : undefined });
}

// ─── Observações ────────────────────────────────────────────────────────────

export async function setNoteFlags(noteId: string, flags: { pinned?: boolean; showInAgenda?: boolean }): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return c;
  const data: { pinned?: boolean; showInAgenda?: boolean } = {};
  if (typeof flags.pinned === 'boolean') data.pinned = flags.pinned;
  if (typeof flags.showInAgenda === 'boolean') data.showInAgenda = flags.showInAgenda;
  const nota = await getTenantClient(c.tenantId).patientNote.findFirst({ where: { id: noteId }, select: { patientId: true } });
  if (!nota) return { ok: false, message: 'Observação não encontrada.' };
  await prisma.patientNote.update({ where: { id: noteId, tenantId: c.tenantId }, data });
  revalidatePath(`/pacientes/${nota.patientId}`);
  return { ok: true };
}

/** Editar só a própria observação (dono e administrador podem as de todos). */
export async function editNote(noteId: string, content: string): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return c;
  const texto = (typeof content === 'string' ? content : '').trim().slice(0, 2000);
  if (!texto) return { ok: false, message: 'Escreva a observação.' };
  const nota = await getTenantClient(c.tenantId).patientNote.findFirst({ where: { id: noteId }, select: { patientId: true, userId: true } });
  if (!nota) return { ok: false, message: 'Observação não encontrada.' };
  if (nota.userId !== c.userId && c.role !== 'OWNER' && c.role !== 'ADMIN') return { ok: false, message: 'Só quem escreveu pode editar esta observação.' };
  await prisma.patientNote.update({ where: { id: noteId, tenantId: c.tenantId }, data: { content: texto } });
  revalidatePath(`/pacientes/${nota.patientId}`);
  return { ok: true };
}

/** Nova observação já com as marcas (usada também para fixar um recado vindo da conversa). */
export async function addNoteAction(patientId: string, content: string, flags: { pinned?: boolean; showInAgenda?: boolean } = {}): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return c;
  const texto = (typeof content === 'string' ? content : '').trim().slice(0, 2000);
  if (!texto) return { ok: false, message: 'Escreva a observação.' };
  if (!(await ownPatient(c.tenantId, patientId))) return { ok: false, message: 'Paciente não encontrado.' };
  await prisma.patientNote.create({ data: { tenantId: c.tenantId, patientId, userId: c.userId, content: texto, pinned: !!flags.pinned, showInAgenda: !!flags.showInAgenda } });
  revalidatePath(`/pacientes/${patientId}`);
  return { ok: true };
}

// ─── Planos de tratamento ───────────────────────────────────────────────────

async function nextPlanNumber(tx: Prisma.TransactionClient, tenantId: string) {
  // Trava consultiva: dois planos criados juntos não pegam o mesmo número.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plano:${tenantId}`}))`;
  const ultimo = await tx.treatmentPlan.findFirst({ where: { tenantId }, orderBy: { number: 'desc' }, select: { number: true } });
  return (ultimo?.number ?? 0) + 1;
}

/**
 * Plano a partir do odontograma: as marcações "a fazer" que ainda não estão
 * em outro plano em andamento viram itens, com o valor do procedimento.
 */
export async function createPlanFromOdontogram(patientId: string, name?: string): Promise<Result> {
  const c = await ctx('prontuario');
  if (!c.ok) return c;
  if (!(await ownPatient(c.tenantId, patientId))) return { ok: false, message: 'Paciente não encontrado.' };
  const db = getTenantClient(c.tenantId);
  const [achados, emUso] = await Promise.all([
    db.toothFinding.findMany({
      where: { patientId, status: 'PLANNED' },
      orderBy: [{ toothNumber: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, toothNumber: true, kind: true, procedureId: true, procedure: { select: { name: true, basePrice: true } } },
    }),
    db.treatmentPlanItem.findMany({ where: { findingId: { not: null }, plan: { patientId, status: 'IN_PROGRESS' } }, select: { findingId: true } }),
  ]);
  const usados = new Set(emUso.map((u) => u.findingId));
  const livres = achados.filter((a) => !usados.has(a.id));
  if (!livres.length) return { ok: false, message: 'Nada novo a fazer no odontograma. Marque o que precisa ser feito e tente de novo.' };
  await prisma.$transaction(async (tx) => {
    const number = await nextPlanNumber(tx, c.tenantId);
    await tx.treatmentPlan.create({
      data: {
        tenantId: c.tenantId,
        patientId,
        number,
        name: (name ?? '').trim().slice(0, 80) || `Plano ${number}`,
        createdById: c.userId,
        items: {
          create: livres.map((f, order) => ({
            tenantId: c.tenantId,
            findingId: f.id,
            procedureId: f.procedureId,
            description: `${f.procedure?.name ?? (isKind(f.kind) ? KINDS[f.kind].label : f.kind)} · dente ${f.toothNumber}`,
            teeth: [f.toothNumber],
            priceCents: f.procedure ? Math.round(Number(f.procedure.basePrice) * 100) : 0,
            order,
          })),
        },
      },
    });
  });
  after(() => recordPatientEvent(c.tenantId, patientId, 'plan.created', `${livres.length} ${livres.length === 1 ? 'item' : 'itens'} do odontograma`, { actorId: c.userId }));
  revalidatePath(`/pacientes/${patientId}`);
  return { ok: true };
}

export async function createBlankPlan(patientId: string, name: string, professionalId?: string | null): Promise<Result> {
  const c = await ctx('prontuario');
  if (!c.ok) return c;
  if (!(await ownPatient(c.tenantId, patientId))) return { ok: false, message: 'Paciente não encontrado.' };
  if (professionalId && !(await prisma.professional.count({ where: { id: professionalId, tenantId: c.tenantId } }))) return { ok: false, message: 'Profissional não encontrado.' };
  await prisma.$transaction(async (tx) => {
    const number = await nextPlanNumber(tx, c.tenantId);
    await tx.treatmentPlan.create({ data: { tenantId: c.tenantId, patientId, number, name: name.trim().slice(0, 80) || `Plano ${number}`, professionalId: professionalId || null, createdById: c.userId } });
  });
  revalidatePath(`/pacientes/${patientId}`);
  return { ok: true };
}

export async function addPlanItem(planId: string, input: { description: string; priceCents: number; quantity?: number }): Promise<Result> {
  const c = await ctx('prontuario');
  if (!c.ok) return c;
  const plan = await getTenantClient(c.tenantId).treatmentPlan.findFirst({ where: { id: planId }, select: { patientId: true, status: true, _count: { select: { items: true } } } });
  if (!plan) return { ok: false, message: 'Plano não encontrado.' };
  if (plan.status !== 'IN_PROGRESS') return { ok: false, message: 'O plano já foi fechado.' };
  const desc = (input.description ?? '').trim().slice(0, 160);
  if (!desc) return { ok: false, message: 'Descreva o item.' };
  const preco = Math.max(0, Math.round(Number(input.priceCents) || 0));
  await prisma.treatmentPlanItem.create({ data: { tenantId: c.tenantId, planId, description: desc, priceCents: preco, quantity: Math.max(1, Math.min(99, Number(input.quantity) || 1)), order: plan._count.items } });
  revalidatePath(`/pacientes/${plan.patientId}`);
  return { ok: true };
}

export async function togglePlanItem(itemId: string, done: boolean): Promise<Result> {
  const c = await ctx('prontuario');
  if (!c.ok) return c;
  const item = await getTenantClient(c.tenantId).treatmentPlanItem.findFirst({ where: { id: itemId }, select: { plan: { select: { patientId: true, status: true } } } });
  if (!item) return { ok: false, message: 'Item não encontrado.' };
  if (item.plan.status !== 'IN_PROGRESS') return { ok: false, message: 'O plano já foi fechado.' };
  await prisma.treatmentPlanItem.update({ where: { id: itemId, tenantId: c.tenantId }, data: { doneAt: done ? new Date() : null } });
  revalidatePath(`/pacientes/${item.plan.patientId}`);
  return { ok: true };
}

export async function setPlanStatus(planId: string, status: 'IN_PROGRESS' | 'DONE' | 'CANCELLED'): Promise<Result> {
  const c = await ctx('prontuario');
  if (!c.ok) return c;
  if (!['IN_PROGRESS', 'DONE', 'CANCELLED'].includes(status)) return { ok: false, message: 'Situação inválida.' };
  const plan = await getTenantClient(c.tenantId).treatmentPlan.findFirst({ where: { id: planId }, select: { patientId: true } });
  if (!plan) return { ok: false, message: 'Plano não encontrado.' };
  await prisma.treatmentPlan.update({ where: { id: planId, tenantId: c.tenantId }, data: { status, closedAt: status === 'IN_PROGRESS' ? null : new Date() } });
  revalidatePath(`/pacientes/${plan.patientId}`);
  return { ok: true };
}

// ─── Foto ───────────────────────────────────────────────────────────────────

export async function uploadPatientPhoto(patientId: string, form: FormData): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return c;
  if (!storageEnabled()) return { ok: false, message: 'O armazenamento de arquivos não está ligado.' };
  if (!(await ownPatient(c.tenantId, patientId))) return { ok: false, message: 'Paciente não encontrado.' };
  const file = form.get('photo');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Escolha uma foto.' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, message: 'A foto pode ter até 5 MB.' };
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[file.type];
  if (!ext || !contentMatchesType(file.type, await fileHead(file))) return { ok: false, message: 'Envie uma foto em JPG, PNG ou WebP.' };
  const path = `${c.tenantId}/fotos/${patientId}-${Date.now()}.${ext}`;
  await uploadObject(path, file);
  const antigo = await prisma.patient.findFirst({ where: { id: patientId, tenantId: c.tenantId }, select: { photoPath: true } });
  await prisma.patient.update({ where: { id: patientId, tenantId: c.tenantId }, data: { photoPath: path, updatedById: c.userId } });
  if (antigo?.photoPath) await deleteObject(antigo.photoPath).catch(() => undefined);
  revalidatePath(`/pacientes/${patientId}`);
  return { ok: true };
}

export async function removePatientPhoto(patientId: string): Promise<Result> {
  const c = await ctx();
  if (!c.ok) return c;
  const p = await prisma.patient.findFirst({ where: { id: patientId, tenantId: c.tenantId }, select: { photoPath: true } });
  if (!p) return { ok: false, message: 'Paciente não encontrado.' };
  await prisma.patient.update({ where: { id: patientId, tenantId: c.tenantId }, data: { photoPath: null, updatedById: c.userId } });
  if (p.photoPath) await deleteObject(p.photoPath).catch(() => undefined);
  revalidatePath(`/pacientes/${patientId}`);
  return { ok: true };
}
