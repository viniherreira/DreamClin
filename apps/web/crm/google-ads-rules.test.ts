import { describe, expect, it } from 'vitest';
import { classifyGoogleError, customerLabel, customerNumber, microsToCents, parseGoogleRow, readGoogleAdsSettings, streamResults } from './google-ads-rules';

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
