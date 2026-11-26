/**
 * O que muda entre as abas Meta e Google da tela Anúncios: nomes, explicações
 * e o que cada gerenciador informa. Os cartões e gráficos são os mesmos.
 */
export interface AdSource {
  key: 'meta' | 'google';
  /** Como aparece nos gráficos ("Meta", "Google"). */
  name: string;
  basePath: string;
  /** O resultado que o gerenciador conta: conversa no WhatsApp (Meta) ou conversão (Google). */
  result: { one: string; many: string; column: string; daily: string; costTitle: string; costHint: string; funnel: string };
  spendHint: string;
  /** A Meta informa quantas pessoas viram; o Google, na pesquisa, não. */
  showReach: boolean;
  /** Idade × gênero juntos (Meta) ou separados (Google). */
  audience: 'pyramid' | 'split';
  places: { title: string; subtitle: string; empty: string };
  audienceEmpty: string;
  footer: string;
  unmatched: string;
  /** Os leads desta fonte já chegam ligados ao CRM (agendou, fechou, retorno). */
  crm: boolean;
}

export const META_SOURCE: AdSource = {
  key: 'meta',
  name: 'Meta',
  basePath: '/crm/anuncios',
  result: {
    one: 'conversa',
    many: 'conversas',
    column: 'Conversas',
    daily: 'Conversas no WhatsApp',
    costTitle: 'Custo por conversa',
    costHint: 'Quanto custou, em média, cada pessoa que chamou no WhatsApp pelo anúncio.',
    funnel: 'Conversas no WhatsApp',
  },
  spendHint: 'Quanto a clínica pagou à Meta pelos anúncios neste período.',
  showReach: true,
  audience: 'pyramid',
  places: {
    title: 'Onde o anúncio rendeu',
    subtitle: 'Facebook, Instagram e os outros lugares',
    empty: 'A Meta não informou onde o anúncio apareceu neste período.',
  },
  audienceEmpty: 'A Meta não informou idade e gênero para este período.',
  footer:
    'Conta quem chegou pelo botão “Enviar mensagem” do anúncio. Quem viu o anúncio e chamou depois por conta própria aparece como WhatsApp direto. Agendou, compareceu e fechou vêm das etapas do funil do CRM. Idade, gênero, lugar e hora são informados pela Meta.',
  unmatched: 'de anúncios que não são desta conta de anúncios',
  crm: true,
};

export const GOOGLE_SOURCE: AdSource = {
  key: 'google',
  name: 'Google',
  basePath: '/crm/anuncios/google',
  result: {
    one: 'conversão',
    many: 'conversões',
    column: 'Conversões',
    daily: 'Conversões',
    costTitle: 'Custo por conversão',
    costHint: 'Quanto custou, em média, cada conversão que o Google Ads contou (clique no WhatsApp, ligação ou formulário, conforme a conta).',
    funnel: 'Conversões no Google',
  },
  spendHint: 'Quanto a clínica pagou ao Google pelos anúncios neste período.',
  showReach: false,
  audience: 'split',
  places: {
    title: 'Onde o anúncio rendeu',
    subtitle: 'Pesquisa do Google, YouTube, Display e os outros lugares',
    empty: 'O Google não informou onde o anúncio apareceu neste período.',
  },
  audienceEmpty: 'O Google não informou idade e gênero para este período.',
  footer:
    'Investimento, cliques e conversões vêm do Google Ads; “conversão” é o que a conta do Google marcou como resultado. Agendou, compareceu e fechou vêm das etapas do funil do CRM, para os leads que chegaram pelo Google.',
  unmatched: 'que não são desta conta do Google',
  // Liga quando os leads do Google chegarem pelo link de WhatsApp do Google.
  crm: false,
};
