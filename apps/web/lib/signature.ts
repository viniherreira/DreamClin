/**
 * Assinatura por link e links públicos de questionário e de envio pelo
 * celular (spec 2026-11-18, F3). Puro: situação, validade e o código do link.
 */

export type SignatureState = 'PENDING' | 'VIEWED' | 'SIGNED' | 'REFUSED' | 'EXPIRED';

export const SIGNATURE_LABEL: Record<SignatureState, string> = {
  PENDING: 'Aguardando',
  VIEWED: 'Visualizado',
  SIGNED: 'Assinado',
  REFUSED: 'Recusado',
  EXPIRED: 'Expirado',
};

/** Vencido é calculado, não gravado: assinado e recusado não vencem. */
export function signatureState(r: { status: string; expiresAt: Date | string }, now: Date = new Date()): SignatureState {
  if (r.status === 'SIGNED' || r.status === 'REFUSED') return r.status;
  if (new Date(r.expiresAt).getTime() <= now.getTime()) return 'EXPIRED';
  return r.status === 'VIEWED' ? 'VIEWED' : 'PENDING';
}

export function canSign(r: { status: string; expiresAt: Date | string }, now: Date = new Date()): boolean {
  const s = signatureState(r, now);
  return s === 'PENDING' || s === 'VIEWED';
}

/** Validade padrão dos links: assinatura 7 dias, questionário 14 dias, envio pelo celular 15 minutos. */
export const LINK_TTL_MS = {
  signature: 7 * 24 * 60 * 60 * 1000,
  questionnaire: 14 * 24 * 60 * 60 * 1000,
  upload: 15 * 60 * 1000,
} as const;

/** CPF confere com o do cadastro? Só os dígitos; cadastro sem CPF aceita sem conferir. */
export function cpfMatches(typed: string, stored: string | null | undefined): boolean {
  const a = (typed ?? '').replace(/\D/g, '');
  const b = (stored ?? '').replace(/\D/g, '');
  if (!b) return true;
  return a === b;
}

/** Desenho da assinatura aceito: PNG em data URL, até ~200 KB. */
export function validDrawing(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('data:image/png;base64,') && v.length < 280_000;
}
