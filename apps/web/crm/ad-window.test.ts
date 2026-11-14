import { describe, expect, it } from 'vitest';
import { adWindow, type AdWindowMessage } from './ad-window';
import { conditionChips, hasConditions, parseConditions } from './stage-automation-rules';

const H = 3_600_000;
const t0 = new Date('2026-11-10T12:00:00Z');
const em = (h: number) => new Date(t0.getTime() + h * H);
const chegou = (h: number, fromAd = true): AdWindowMessage => ({ direction: 'INBOUND', at: em(h), fromAd });
const respondeu = (h: number, failed = false): AdWindowMessage => ({ direction: 'OUTBOUND', at: em(h), fromAd: false, failed });

describe('janela grátis do anúncio (72 h)', () => {
  it('sem anúncio não tem janela', () => {
    expect(adWindow([chegou(0, false), respondeu(1)], em(2))).toBeNull();
  });

  it('veio do anúncio e ninguém respondeu: espera a resposta por 24 h', () => {
    expect(adWindow([chegou(0)], em(5))).toEqual({ state: 'waiting', replyBy: em(24) });
    expect(adWindow([chegou(0)], em(25))).toBeNull();
  });

  it('respondeu em 24 h: 72 h grátis contadas da resposta', () => {
    const msgs = [chegou(0), respondeu(2), respondeu(10)];
    expect(adWindow(msgs, em(30))).toEqual({ state: 'open', endsAt: em(74) });
    // Passou das 24 h da conversa, mas a janela do anúncio segue.
    expect(adWindow(msgs, em(73))?.state).toBe('open');
    expect(adWindow(msgs, em(74))).toBeNull();
  });

  it('resposta depois de 24 h, ou que falhou, não abre a janela', () => {
    expect(adWindow([chegou(0), respondeu(25)], em(26))).toBeNull();
    expect(adWindow([chegou(0), respondeu(1, true)], em(2))).toEqual({ state: 'waiting', replyBy: em(24) });
  });

  it('vale o último anúncio; resposta de antes dele não conta', () => {
    const msgs = [chegou(0), respondeu(1), chegou(100), respondeu(101)];
    expect(adWindow(msgs, em(150))).toEqual({ state: 'open', endsAt: em(173) });
    expect(adWindow([respondeu(-1), chegou(0)], em(1))?.state).toBe('waiting');
  });

  it('a condição da automação: guarda, conta como condição e aparece no cartão', () => {
    const c = parseConditions({ adWindow: true });
    expect(c).toEqual({ adWindow: true });
    expect(hasConditions(c)).toBe(true);
    expect(conditionChips(c, { tags: new Map(), sources: {} })).toEqual(['Só na janela grátis do anúncio (72 h)']);
    expect(parseConditions({ adWindow: 'sim' })).toEqual({});
  });
});
