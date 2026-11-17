'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { guardCrmAction } from '@/crm/guard';
import { setAdTopic } from '@/crm/origin';

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const schema = z.object({
  scope: z.enum(['AD', 'CAMPAIGN']),
  externalId: z.string().regex(/^\d{5,25}$/),
  topic: z.string().max(120),
  procedureId: z.string().max(40).nullable(),
});

/** O assunto de um anúncio ou campanha (só gestor). Vale também para os leads que já vieram dele. */
export async function setAdTopicAction(input: z.input<typeof schema>): Promise<Result<{ leads: number }>> {
  const g = await guardCrmAction('crm_config');
  if (!g.ok) return g;
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Confira o assunto.' };
  const r = await setAdTopic(g.tenantId, p.data);
  if (r.ok) {
    revalidatePath('/crm/anuncios');
    revalidatePath('/crm');
    revalidatePath('/crm/leads');
  }
  return r;
}
