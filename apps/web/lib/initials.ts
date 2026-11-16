/**
 * Iniciais de um nome, para o avatar.
 *
 * Nome de WhatsApp vem com emoji ("Ana 🦋", "🙂"). Pegar `palavra[0]` corta o
 * emoji no meio: sobra meio caractere, que o servidor escreve de um jeito e o
 * navegador de outro, e a página quebra ao carregar. Aqui só letra e número
 * contam, lidos por caractere inteiro.
 */
const LETRA = /[\p{L}\p{N}]/u;

const primeira = (palavra: string) => Array.from(palavra).find((ch) => LETRA.test(ch)) ?? '';

/** "Rita Campos" → "RC" (primeira e última palavra). Sem letra nenhuma, "?". */
export function initials(name: string): string {
  const letras = name.trim().split(/\s+/).map(primeira).filter(Boolean);
  if (letras.length === 0) return '?';
  return (letras[0] + (letras.length > 1 ? letras[letras.length - 1] : '')).toUpperCase();
}

/** "Maria da Silva" → "MD" (as duas primeiras palavras), como nos avatares de paciente. */
export function leadingInitials(name: string): string {
  const letras = name.trim().split(/\s+/).map(primeira).filter(Boolean);
  if (letras.length === 0) return '?';
  return letras.slice(0, 2).join('').toUpperCase();
}

/** As `n` primeiras letras do nome, em maiúsculas ("Odontologia" → "OD"). */
export function firstLetters(name: string, n = 1): string {
  const letras = Array.from(name).filter((ch) => LETRA.test(ch));
  return letras.length === 0 ? '?' : letras.slice(0, n).join('').toUpperCase();
}
