/**
 * Qual nome do paciente aparece onde.
 *
 * Com nome social preenchido, ele é o nome de toda a tela (agenda, perfil,
 * busca) e das mensagens. O nome civil fica para os documentos oficiais:
 * recibo, contrato, atestado, receita, declaração. Puro, para a tela e o
 * servidor responderem igual.
 */

export interface PatientNameLike {
  name: string;
  socialName?: string | null;
}

/** O nome que a pessoa usa: o social, quando houver. */
export function displayName(p: PatientNameLike): string {
  const social = p.socialName?.trim();
  return social ? social : p.name;
}

/** O nome dos documentos oficiais: sempre o civil. */
export function officialName(p: PatientNameLike): string {
  return p.name;
}

/** "Maria (nome civil: José da Silva)" para quem precisa conferir a identidade. */
export function nameWithCivil(p: PatientNameLike): string {
  const social = p.socialName?.trim();
  return social && social !== p.name ? `${social} (nome civil: ${p.name})` : p.name;
}
