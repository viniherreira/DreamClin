import { describe, expect, it } from 'vitest';
import { CHANNEL_TAG, matchProcedures, procedureForTag, sameTag, tagKey } from './auto-tags-rules';

const tags = (text: string, procs: { id: string; name: string }[] = []) => matchProcedures(text, procs).map((m) => m.tag);

describe('tags de procedimento', () => {
  it.each([
    ['Oi, quero saber o valor do implante', ['implante']],
    ['Vocês fazem IMPLANTES?', ['implante']],
    ['quanto custa clareamento dental', ['clareamento']],
    ['queria colocar aparelho invisível no meu filho', ['aparelho']],
    ['quero fazer lentes de contato e clarear os dentes', ['clareamento', 'lentes de contato']],
    ['preciso tirar o dente do siso', ['extração']],
    ['faço botox e preenchimento labial?', ['botox', 'harmonização facial']],
    ['tenho uma cárie doendo', ['restauração']],
  ])('%s', (texto, esperado) => {
    expect(tags(texto).sort()).toEqual([...esperado].sort());
  });

  it('a mesma frase vira uma tag só, a mais precisa', () => {
    expect(tags('Vim das redes sociais e quero saber sobre Prótese Protocolo em Suzano!')).toEqual(['protocolo']);
    expect(tags('quero implante com carga imediata')).toEqual(['carga imediata']);
    expect(tags('IMPLANTES COM CARGA IMEDIATA')).toEqual(['carga imediata']);
    expect(tags('quero dentadura fixa')).toEqual(['protocolo']);
    // Duas coisas diferentes na mesma mensagem continuam duas tags.
    expect(tags('quero protocolo e também clareamento').sort()).toEqual(['clareamento', 'protocolo']);
    expect(tags('tenho prótese e quero um implante').sort()).toEqual(['implante', 'prótese']);
  });

  it('não acha palavra pela metade nem conversa sem procedimento', () => {
    expect(tags('Oi, bom dia! Qual o horário de vocês?')).toEqual([]);
    expect(tags('meu canal no youtube')).toEqual([]);
    expect(tags('implantação do sistema')).toEqual([]);
  });

  it('liga ao procedimento da clínica para o interesse', () => {
    const procs = [
      { id: 'p1', name: 'Implante unitário' },
      { id: 'p2', name: 'Clareamento a laser' },
    ];
    const m = matchProcedures('quero implante', procs);
    expect(m).toEqual([{ tag: 'implante', procedureId: 'p1', word: 'implante' }]);
    expect(matchProcedures('clareamento', procs)[0]?.procedureId).toBe('p2');
  });

  it('procedimento da clínica fora do dicionário vira tag pelo nome', () => {
    const procs = [
      { id: 'p9', name: 'Ozonioterapia' },
      { id: 'p8', name: 'Consulta de avaliação inicial completa' },
    ];
    expect(matchProcedures('vocês fazem ozonioterapia?', procs)).toEqual([{ tag: 'ozonioterapia', procedureId: 'p9', word: 'Ozonioterapia' }]);
    // Nome comprido demais não vira palavra de busca (ruído).
    expect(tags('quero uma consulta de avaliação inicial completa', procs)).toEqual([]);
  });
});

describe('tags de canal', () => {
  it('canais com tag; manual e outro sem', () => {
    expect(CHANNEL_TAG.WHATSAPP?.name).toBe('whatsapp');
    expect(CHANNEL_TAG.INDICACAO?.name).toBe('indicação');
    expect(CHANNEL_TAG.MANUAL).toBeUndefined();
    expect(CHANNEL_TAG.OUTRO).toBeUndefined();
  });
});

describe('nome da tag', () => {
  it('acento, maiúscula, hífen e espaço não fazem outra tag', () => {
    expect(tagKey('Prótese')).toBe(tagKey('protese'));
    expect(tagKey('carga-imediata')).toBe(tagKey('Carga  Imediata'));
    expect(tagKey('harmonização_facial')).toBe('harmonizacao facial');
    expect(tagKey('implante')).not.toBe(tagKey('implantes de dente'));
  });

  it('acha a tag que já existe', () => {
    const lista = [{ id: 'a', name: 'prótese' }, { id: 'b', name: 'carga imediata' }];
    expect(sameTag(lista, 'PROTESE')?.id).toBe('a');
    expect(sameTag(lista, 'carga-imediata')?.id).toBe('b');
    expect(sameTag(lista, 'implante')).toBeUndefined();
    expect(sameTag(lista, '  ')).toBeUndefined();
  });
});

describe('tag vira interesse', () => {
  const procs = [
    { id: 'imp', name: 'Implante unitário' },
    { id: 'ozo', name: 'Ozonioterapia' },
    { id: 'pro', name: 'Prótese total' },
  ];
  it('pelo dicionário e pelo nome do procedimento', () => {
    expect(procedureForTag('implante', procs)).toBe('imp');
    expect(procedureForTag('Implante', procs)).toBe('imp');
    expect(procedureForTag('protese', procs)).toBe('pro');
    expect(procedureForTag('ozonioterapia', procs)).toBe('ozo');
  });
  it('tag que não é procedimento não vira nada', () => {
    expect(procedureForTag('facebook', procs)).toBeNull();
    expect(procedureForTag('follow-up', procs)).toBeNull();
    expect(procedureForTag('clareamento', procs)).toBeNull();
  });
});

