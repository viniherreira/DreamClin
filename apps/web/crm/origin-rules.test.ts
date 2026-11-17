import { describe, expect, it } from 'vitest';
import { adMetaOf, cleanTopic, originShort, topicFor } from './origin-rules';

const procs = [
  { id: 'p1', name: 'Implante unitário' },
  { id: 'p2', name: 'Prótese total' },
  { id: 'p3', name: 'Carga imediata' },
];

describe('origem pelo anúncio', () => {
  it('lê o anúncio da mensagem sem confiar na forma', () => {
    expect(adMetaOf(null)).toBeNull();
    expect(adMetaOf([])).toBeNull();
    expect(adMetaOf({ sourceType: 'ad' })).toBeNull();
    expect(adMetaOf({ sourceId: '120210000000001', sourceType: 'ad', headline: ' Implante em 1 dia ', imageUrl: 'http://x', thumbnailUrl: 'https://img' })).toEqual({
      adId: '120210000000001',
      headline: 'Implante em 1 dia',
      body: null,
      imageUrl: 'https://img',
    });
    // Publicação impulsionada: não é id de anúncio.
    expect(adMetaOf({ sourceId: '999999', sourceType: 'post', headline: 'Post' })?.adId).toBeNull();
    expect(adMetaOf({ sourceId: 'abc', sourceType: 'ad', headline: 'X' })?.adId).toBeNull();
  });

  it('o assunto escolhido vale mais: anúncio, depois campanha', () => {
    const forAd = { topic: 'Carga imediata', procedureId: 'p3' };
    const forCampaign = { topic: 'Implante', procedureId: 'p1' };
    expect(topicFor({ forAd, forCampaign, names: ['Prótese'], procedures: procs })).toEqual({ ...forAd, from: 'AD' });
    expect(topicFor({ forCampaign, names: ['Prótese'], procedures: procs })).toEqual({ ...forCampaign, from: 'CAMPAIGN' });
  });

  it('sem escolha, acha o procedimento no nome da campanha antes do título', () => {
    expect(topicFor({ names: ['[Leads] Prótese dentadura nov', 'Anúncio 3', 'Implante em 1 dia'], procedures: procs })).toEqual({
      topic: 'Prótese total',
      procedureId: 'p2',
      from: 'AUTO',
    });
    // "Implante com carga imediata" é carga imediata, não implante.
    expect(topicFor({ names: [null, 'Implante com carga imediata'], procedures: procs })?.topic).toBe('Carga imediata');
    // Procedimento que a clínica não cadastrou: o nome do dicionário.
    expect(topicFor({ names: ['Clareamento a laser'], procedures: procs })).toEqual({ topic: 'Clareamento', procedureId: null, from: 'AUTO' });
    expect(topicFor({ names: ['Campanha novembro'], procedures: procs })).toBeNull();
  });

  it('texto curto do card e assunto digitado', () => {
    expect(originShort({ topic: 'Implante', adName: 'Ad 1', headline: 'H' })).toBe('Implante');
    expect(originShort({ topic: null, adName: null, headline: 'H' })).toBe('H');
    expect(originShort({ topic: null, adName: null, headline: null })).toBeNull();
    expect(cleanTopic('  carga   imediata ')).toBe('carga imediata');
  });
});
