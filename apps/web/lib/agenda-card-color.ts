/**
 * A cor cheia de um horário na grade da agenda: a do rótulo (escolha de quem
 * marcou), senão a do procedimento (ou da categoria dele), senão a do
 * profissional. O texto vai branco ou escuro, o que ler melhor sobre ela.
 */

/** As cores dos rótulos (nomes, `label-colors.ts`) em tom forte, para fundo cheio. */
const LABEL_HEX: Record<string, string> = {
  gray: '#64748B',
  blue: '#2563EB',
  teal: '#0D9488',
  green: '#16A34A',
  amber: '#D97706',
  orange: '#EA580C',
  red: '#DC2626',
  pink: '#DB2777',
  violet: '#7C3AED',
};

const FALLBACK = '#64748B';
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function asHex(c: string | null | undefined): string | null {
  if (!c) return null;
  const t = c.trim();
  if (LABEL_HEX[t]) return LABEL_HEX[t];
  return HEX.test(t) ? t : null;
}

export function cardColor(c: { label?: string | null; procedure?: string | null; professional?: string | null }): string {
  return asHex(c.label) ?? asHex(c.procedure) ?? asHex(c.professional) ?? FALLBACK;
}

/** Luminância relativa (WCAG) de um "#RGB" ou "#RRGGBB". */
function luminance(hex: string): number {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Texto claro (branco) ou escuro sobre a cor: o que der mais contraste. */
export function readableOn(hex: string): 'light' | 'dark' {
  const l = luminance(HEX.test(hex) ? hex : FALLBACK);
  // Contraste com branco (1.0) contra o com quase preto (#0F172A, ~0.009).
  const comBranco = 1.05 / (l + 0.05);
  const comEscuro = (l + 0.05) / 0.059;
  return comBranco >= comEscuro ? 'light' : 'dark';
}
