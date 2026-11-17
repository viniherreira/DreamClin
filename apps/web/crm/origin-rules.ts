import { matchProcedures, type ProcedureLite } from './auto-tags-rules';

/**
 * A origem do lead pelos dados que a Meta manda junto com a primeira mensagem
 * de quem tocou num anúncio (`chat_messages.ad`): o id do anúncio, o título e
 * a imagem. Nunca pelo que a pessoa escreve, que muda a cada mensagem. Puro e
 * testado em `origin-rules.test.ts`; o banco fica em `origin.ts`.
 */

export interface AdMeta {
  adId: string | null;
  headline: string | null;
  body: string | null;
  imageUrl: string | null;
}

const texto = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** O anúncio guardado na mensagem, sem confiar na forma. Nulo quando não veio de anúncio. */
export function adMetaOf(raw: unknown): AdMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = texto(r.sourceId, 40);
  const tipo = texto(r.sourceType, 20)?.toLowerCase() ?? 'ad';
  const url = (v: unknown) => {
    const t = texto(v, 1000);
    return t && /^https:\/\//i.test(t) ? t : null;
  };
  const meta: AdMeta = {
    // Só anúncio tem id de anúncio (publicação impulsionada também manda sourceId, de post).
    adId: id && tipo === 'ad' && /^\d{5,25}$/.test(id) ? id : null,
    headline: texto(r.headline, 200),
    body: texto(r.body, 500),
    imageUrl: url(r.imageUrl) ?? url(r.thumbnailUrl),
  };
  return meta.adId || meta.headline || meta.body ? meta : null;
}

export interface TopicRule {
  topic: string;
  procedureId: string | null;
}

export interface TopicInput {
  /** O assunto que a clínica escolheu para o anúncio (vale mais). */
  forAd?: TopicRule | null;
  /** O assunto que a clínica escolheu para a campanha inteira. */
  forCampaign?: TopicRule | null;
  /** Os nomes que vêm da Meta, na ordem de confiança: campanha, anúncio, título, texto. */
  names: readonly (string | null | undefined)[];
  procedures: readonly ProcedureLite[];
}

export interface TopicResult extends TopicRule {
  /** De onde saiu: escolhido no anúncio, na campanha, ou achado no nome. */
  from: 'AD' | 'CAMPAIGN' | 'AUTO';
}

const primeiraMaiuscula = (s: string) => s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);

/**
 * O assunto do anúncio: o que a clínica escolheu (anúncio, depois campanha);
 * sem escolha, o primeiro procedimento achado nos nomes da Meta, um de cada
 * vez, na ordem (o nome da campanha costuma ser o mais certo). Nada achado: nulo.
 */
export function topicFor(i: TopicInput): TopicResult | null {
  if (i.forAd?.topic) return { ...i.forAd, from: 'AD' };
  if (i.forCampaign?.topic) return { ...i.forCampaign, from: 'CAMPAIGN' };
  for (const n of i.names) {
    if (!n) continue;
    const achado = matchProcedures(n, i.procedures)[0];
    if (!achado) continue;
    const nome = achado.procedureId ? i.procedures.find((p) => p.id === achado.procedureId)?.name : null;
    return { topic: nome?.trim() || primeiraMaiuscula(achado.tag), procedureId: achado.procedureId, from: 'AUTO' };
  }
  return null;
}

/** O texto curto do card: assunto, senão o nome do anúncio, senão o título. */
export function originShort(o: { topic: string | null; adName: string | null; headline: string | null }): string | null {
  return o.topic ?? o.adName ?? o.headline ?? null;
}

/** Limpa o assunto digitado (até 60 letras, sem espaço sobrando). */
export function cleanTopic(v: string): string {
  return v.replace(/\s+/g, ' ').trim().slice(0, 60);
}
