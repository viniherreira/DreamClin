import { describe, expect, it } from 'vitest';
import { ageKey, buildGoogleAudience, classifyGoogleError, customerLabel, customerNumber, genderKey, microsToCents, parseGoogleBreakdown, parseGoogleRow, readGoogleAdsSettings, streamResults } from './google-ads-rules';
import { buildAdHours, buildPlatforms } from './ads-rules';

describe('Google Ads: regras', () => {
  it('lê o id da conta em qualquer formato', () => {
    expect(customerNumber('123-456-7890')).toBe('1234567890');
    expect(customerNumber('customers/1234567890')).toBe('1234567890');
    expect(customerNumber(1234567890)).toBe('1234567890');
    expect(customerNumber('12345')).toBeNull();
    expect(customerNumber(null)).toBeNull();
    expect(customerLabel('1234567890')).toBe('123-456-7890');
  });

  it('dinheiro em milionésimos vira centavos', () => {
    expect(microsToCents('12340000')).toBe(1234);
    expect(microsToCents(5_000)).toBe(1);
    expect(microsToCents(undefined)).toBe(0);
    expect(microsToCents(-1)).toBe(0);
  });

  it('linha da API vira a linha da tela', () => {
    const r = parseGoogleRow({
      segments: { date: '2026-11-20' },
      campaign: { id: '987', name: 'Implante Pesquisa' },
      adGroupAd: { ad: { id: '555', name: null } },
      adGroup: { name: 'Grupo implante' },
      metrics: { costMicros: '25500000', impressions: '1200', clicks: '48', conversions: 6.7 },
    });
    expect(r).toEqual({
      day: '2026-11-20',
      campaignId: '987',
      campaignName: 'Implante Pesquisa',
      adId: '555',
      adName: 'Grupo implante',
      spendCents: 2550,
      impressions: 1200,
      reach: 0,
      clicks: 48,
      conversations: 7,
    });
    expect(parseGoogleRow({}).spendCents).toBe(0);
  });

  it('junta os lotes do searchStream', () => {
    expect(streamResults([{ results: [1, 2] }, { results: [3] }, {}])).toEqual([1, 2, 3]);
    expect(streamResults({ results: [4] })).toEqual([4]);
    expect(streamResults(null)).toEqual([]);
  });

  it('configuração guardada: sem token não há conexão', () => {
    expect(readGoogleAdsSettings({ googleAds: { customerId: '1234567890' } })).toBeNull();
    expect(readGoogleAdsSettings({ googleAds: { refreshTokenEncrypted: 'x', customerId: '123-456-7890', loginCustomerId: 'lixo' } })).toMatchObject({
      customerId: '1234567890',
      loginCustomerId: null,
    });
  });

  it('erros do Google em português', () => {
    expect(classifyGoogleError(429, {}).kind).toBe('rate');
    expect(classifyGoogleError(400, { error: 'invalid_grant' }).kind).toBe('auth');
    expect(classifyGoogleError(403, { error: { details: [{ errors: [{ errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' } }] }] } }).message).toContain('aprovação');
    expect(classifyGoogleError(403, {}).kind).toBe('permission');
    expect(classifyGoogleError(500, {}).kind).toBe('other');
  });
});

describe('Google Ads: recortes no formato dos gráficos', () => {
  const linha = (extra: object, conv = 2, clicks = 10) => ({ ...extra, metrics: { costMicros: '10000000', impressions: '100', clicks: String(clicks), conversions: conv } });

  it('rede e aparelho viram os lugares', () => {
    const rede = [parseGoogleBreakdown(linha({ segments: { adNetworkType: 'SEARCH' } }, 5), 'network'), parseGoogleBreakdown(linha({ segments: { adNetworkType: 'YOUTUBE_WATCH' } }, 1), 'network')];
    expect(buildPlatforms(rede).lines.map((l) => [l.label, l.value])).toEqual([['Pesquisa Google', 5], ['YouTube', 1]]);
    const aparelho = parseGoogleBreakdown(linha({ segments: { device: 'MOBILE' } }), 'device');
    expect(aparelho.keys.publisher_platform).toBe('Celular');
    expect(parseGoogleBreakdown(linha({ segments: { device: 'XYZ' } }), 'device').keys.publisher_platform).toBe('unknown');
  });

  it('idade e gênero', () => {
    expect(ageKey('AGE_RANGE_25_34')).toBe('25-34');
    expect(ageKey('AGE_RANGE_65_UP')).toBe('65+');
    expect(ageKey('AGE_RANGE_UNDETERMINED')).toBe('unknown');
    expect(genderKey('FEMALE')).toBe('female');
    expect(genderKey('UNDETERMINED')).toBe('unknown');
    const idades = [
      parseGoogleBreakdown(linha({ adGroupCriterion: { ageRange: { type: 'AGE_RANGE_35_44' } } }, 3), 'age'),
      parseGoogleBreakdown(linha({ adGroupCriterion: { ageRange: { type: 'AGE_RANGE_25_34' } } }, 4), 'age'),
      parseGoogleBreakdown(linha({ adGroupCriterion: { ageRange: { type: 'AGE_RANGE_UNDETERMINED' } } }, 9), 'age'),
    ];
    const generos = [
      parseGoogleBreakdown(linha({ adGroupCriterion: { gender: { type: 'FEMALE' } } }, 6), 'gender'),
      parseGoogleBreakdown(linha({ adGroupCriterion: { gender: { type: 'MALE' } } }, 2), 'gender'),
    ];
    const a = buildGoogleAudience(idades, generos);
    expect(a.metric).toBe('conversations');
    expect(a.ages.map((x) => [x.age, x.unknown])).toEqual([['25-34', 4], ['35-44', 3]]);
    expect(a.totals).toEqual({ female: 6, male: 2, unknown: 0 });
  });

  it('hora do dia', () => {
    const h = buildAdHours([parseGoogleBreakdown(linha({ segments: { hour: 14 } }, 7), 'hour'), parseGoogleBreakdown(linha({ segments: { hour: 9 } }, 2), 'hour')]);
    expect(h.peak).toBe(14);
    expect(h.hours[9]).toBe(2);
  });
});

