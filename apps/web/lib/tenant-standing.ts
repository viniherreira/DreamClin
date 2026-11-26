import { prisma } from '@clinicaiq/db';
import { resolveAccess } from './subscription';

/**
 * Das clínicas dadas, as que estão em só leitura: teste grátis acabou sem
 * plano, fatura vencida além da tolerância, ou assinatura cancelada e
 * encerrada. Clínica sem linha de assinatura nenhuma não entra (na produção não
 * há nenhuma; toda clínica nasce com o teste grátis).
 *
 * Serve para o que roda sozinho (lembretes, aniversários, automações do CRM,
 * transmissões, agendamento online). A clínica nessa situação não consegue
 * remarcar, confirmar nem responder pelo sistema, então mandar mensagem em nome
 * dela só cria pergunta sem resposta. Pagou, volta tudo no mesmo dia.
 *
 * Erro no banco libera em vez de bloquear: um tropeço aqui não pode calar os
 * lembretes de todas as clínicas que estão em dia.
 */
export async function readonlyTenants(tenantIds: Iterable<string>, now: Date = new Date()): Promise<Set<string>> {
  const ids = [...new Set(tenantIds)];
  if (ids.length === 0) return new Set();
  try {
    const subs = await prisma.subscription.findMany({
      where: { tenantId: { in: ids } },
      select: {
        tenantId: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        graceEndsAt: true,
        cancelledAt: true,
        complimentary: true,
        asaasSubscriptionId: true,
      },
    });
    return new Set(
      subs
        .filter((s) => resolveAccess({ ...s, billingLinked: Boolean(s.asaasSubscriptionId) }, now).level !== 'full')
        .map((s) => s.tenantId),
    );
  } catch (e) {
    console.error('[plano] não deu para conferir as assinaturas; seguindo sem bloquear', e instanceof Error ? e.message : e);
    return new Set();
  }
}

/** Uma clínica só. */
export async function tenantReadonly(tenantId: string, now: Date = new Date()): Promise<boolean> {
  return (await readonlyTenants([tenantId], now)).has(tenantId);
}

/** O motivo gravado na mensagem que não saiu. */
export const READONLY_SEND_MESSAGE = 'Não enviada: o plano da clínica está sem acesso completo.';
