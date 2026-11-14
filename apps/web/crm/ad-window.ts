import { Prisma, type TenantPrismaClient } from '@clinicaiq/db';

/**
 * A janela grátis dos anúncios Click-to-WhatsApp (regra da Meta): a pessoa
 * chega por um anúncio, a clínica responde em até 24 horas e, a partir dessa
 * resposta, os modelos aprovados saem sem custo por 72 horas. É o tempo do
 * follow-up de quem veio de anúncio.
 *
 * O texto livre continua valendo só nas 24 horas desde a última mensagem da
 * pessoa (`windowOpen`, em `cloud.ts`); aqui é só a janela sem cobrança.
 * Nada é gravado: a janela sai das mensagens da conversa.
 */

export const AD_REPLY_MS = 24 * 60 * 60 * 1000;
export const AD_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface AdWindowMessage {
  direction: 'INBOUND' | 'OUTBOUND';
  at: Date;
  /** A mensagem chegou com o anúncio junto (`chat_messages.ad`). */
  fromAd: boolean;
  /** Envio que a Meta recusou não abre a janela. */
  failed?: boolean;
}

export type AdWindow =
  /** Aberta: modelos sem custo até `endsAt`. */
  | { state: 'open'; endsAt: Date }
  /** A pessoa veio do anúncio e ninguém respondeu: respondendo até `replyBy`, a janela abre. */
  | { state: 'waiting'; replyBy: Date }
  | null;

/** A janela agora, pelas mensagens da conversa (em qualquer ordem). */
export function adWindow(messages: readonly AdWindowMessage[], now: Date = new Date()): AdWindow {
  const anuncio = messages
    .filter((m) => m.direction === 'INBOUND' && m.fromAd)
    .reduce<Date | null>((ultimo, m) => (!ultimo || m.at > ultimo ? m.at : ultimo), null);
  if (!anuncio) return null;
  const limite = anuncio.getTime() + AD_REPLY_MS;
  const resposta = messages
    .filter((m) => m.direction === 'OUTBOUND' && !m.failed && m.at >= anuncio && m.at.getTime() <= limite)
    .reduce<Date | null>((primeira, m) => (!primeira || m.at < primeira ? m.at : primeira), null);
  if (!resposta) return now.getTime() < limite ? { state: 'waiting', replyBy: new Date(limite) } : null;
  const fim = resposta.getTime() + AD_WINDOW_MS;
  return now.getTime() < fim ? { state: 'open', endsAt: new Date(fim) } : null;
}

/** A janela de uma conversa, lida do banco: a última chegada por anúncio e a primeira resposta depois dela. */
export async function loadAdWindow(db: TenantPrismaClient, conversationId: string, now: Date = new Date()): Promise<AdWindow> {
  // Anúncio mais antigo que 24 h + 72 h já não tem janela.
  const desde = new Date(now.getTime() - AD_REPLY_MS - AD_WINDOW_MS);
  const chegada = await db.chatMessage.findFirst({
    where: { conversationId, direction: 'INBOUND', at: { gte: desde }, ad: { not: Prisma.DbNull } },
    orderBy: { at: 'desc' },
    select: { at: true },
  });
  if (!chegada) return null;
  const resposta = await db.chatMessage.findFirst({
    where: { conversationId, direction: 'OUTBOUND', status: { not: 'FAILED' }, at: { gte: chegada.at } },
    orderBy: { at: 'asc' },
    select: { at: true },
  });
  return adWindow(
    [
      { direction: 'INBOUND', at: chegada.at, fromAd: true },
      ...(resposta ? [{ direction: 'OUTBOUND' as const, at: resposta.at, fromAd: false }] : []),
    ],
    now,
  );
}
