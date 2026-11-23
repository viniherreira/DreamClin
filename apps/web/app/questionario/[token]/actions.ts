'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';
import { prisma, type Prisma } from '@clinicaiq/db';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { anamnesisItemsFrom, cleanQuestionnaireAnswers, readQuestions } from '@/lib/questionnaire';
import { recordPatientEvent } from '@/lib/patient-timeline';
import { ANAMNESIS_QUESTIONS } from '@/app/(app)/pacientes/[id]/_components/anamnesis-questions';

/**
 * Questionário por link (`/questionario/[token]`). Público, o token é a chave.
 * Abrir só lê; "abriu" vem do navegador do paciente; responder grava uma vez.
 * Respostas de saúde entram na anamnese, marcadas "respondido pelo paciente".
 */

const tokenOk = (t: unknown): t is string => typeof t === 'string' && /^[\w-]{20,64}$/.test(t);

export async function getQuestionnaire(token: string) {
  if (!tokenOk(token)) return null;
  const r = await prisma.questionnaireRequest.findUnique({
    where: { token },
    select: { expiresAt: true, answeredAt: true, tenant: { select: { name: true } }, questionnaire: { select: { name: true, questions: true } }, patientId: true },
  });
  if (!r) return null;
  const p = await prisma.patient.findUnique({ where: { id: r.patientId }, select: { name: true, socialName: true } });
  const nome = (p?.socialName || p?.name || '').split(' ')[0];
  return {
    clinic: r.tenant.name,
    name: r.questionnaire.name,
    firstName: nome,
    questions: readQuestions(r.questionnaire.questions),
    state: r.answeredAt ? ('ANSWERED' as const) : r.expiresAt < new Date() ? ('EXPIRED' as const) : ('OPEN' as const),
  };
}

export async function markQuestionnaireOpened(token: string): Promise<void> {
  if (!tokenOk(token)) return;
  await prisma.questionnaireRequest.updateMany({ where: { token, openedAt: null }, data: { openedAt: new Date() } });
}

export async function submitQuestionnaire(token: string, answers: unknown): Promise<{ ok: true } | { ok: false; message: string; errors?: Record<string, string> }> {
  if (!tokenOk(token)) return { ok: false, message: 'Link inválido.' };
  const limite = await rateLimit(`questionario:${clientIp(await headers())}`, 20, 10 * 60 * 1000);
  if (!limite.ok) return { ok: false, message: 'Muitas tentativas. Espere alguns minutos.' };
  const r = await prisma.questionnaireRequest.findUnique({
    where: { token },
    select: { id: true, tenantId: true, patientId: true, expiresAt: true, answeredAt: true, questionnaire: { select: { name: true, health: true, questions: true } } },
  });
  if (!r) return { ok: false, message: 'Link inválido.' };
  if (r.answeredAt) return { ok: false, message: 'Este questionário já foi respondido. Obrigado!' };
  if (r.expiresAt < new Date()) return { ok: false, message: 'Este link não vale mais. Peça outro à clínica.' };
  const perguntas = readQuestions(r.questionnaire.questions);
  const { answers: limpas, errors } = cleanQuestionnaireAnswers(perguntas, answers);
  if (Object.keys(errors).length) return { ok: false, message: 'Responda as perguntas marcadas.', errors };

  const agora = new Date();
  const feito = await prisma.questionnaireRequest.updateMany({
    where: { id: r.id, answeredAt: null },
    data: { answeredAt: agora, answers: limpas as unknown as Prisma.InputJsonValue },
  });
  if (!feito.count) return { ok: false, message: 'Este questionário já foi respondido. Obrigado!' };

  // Saúde: o que é da anamnese padrão vai para a anamnese do paciente.
  if (r.questionnaire.health) {
    const itens = anamnesisItemsFrom(perguntas, limpas, new Set(ANAMNESIS_QUESTIONS.map((q) => q.key)));
    if (Object.keys(itens).length) {
      const atual = await prisma.anamnesis.findFirst({ where: { tenantId: r.tenantId, patientId: r.patientId }, select: { id: true, answers: true } });
      const antes = (atual?.answers ?? {}) as { items?: Record<string, unknown>; obs?: string };
      const novo = { ...antes, items: { ...(antes.items ?? {}), ...itens }, byPatientAt: agora.toISOString() } as Prisma.InputJsonValue;
      if (atual) await prisma.anamnesis.update({ where: { id: atual.id }, data: { answers: novo } });
      else await prisma.anamnesis.create({ data: { tenantId: r.tenantId, patientId: r.patientId, answers: novo } });
    }
  }
  after(() => recordPatientEvent(r.tenantId, r.patientId, 'questionnaire.answered', r.questionnaire.name, { actorLabel: 'Paciente pelo link' }));
  return { ok: true };
}
