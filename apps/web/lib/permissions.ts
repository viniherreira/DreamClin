/**
 * Quem pode o quê dentro de uma clínica.
 *
 * O enum `Role` existe no schema desde o começo e nunca foi consultado: qualquer
 * pessoa com login na clínica podia apagar profissional, ler prontuário
 * completo e trocar o plano. Hoje não há impacto porque todo mundo é OWNER, mas
 * no dia em que uma clínica cadastrar a recepcionista isso vira problema — e o
 * prontuário é dado sensível de saúde (LGPD art. 11).
 *
 * Módulo puro de propósito: sem Prisma, sem Clerk, sem `server-only`. A regra é
 * uma tabela e uma função, e as duas dão para testar sem banco.
 */

export type Role = 'OWNER' | 'ADMIN' | 'RECEPTIONIST' | 'PROFESSIONAL';

export type Capability =
  /** Agenda: marcar, remarcar, cancelar, bloquear horário. */
  | 'agenda'
  /** Cadastro do paciente: nome, contato, observações administrativas. */
  | 'pacientes'
  /** Prontuário clínico: anamnese, evolução, odontograma, exames. */
  | 'prontuario'
  /** Dinheiro: pagamentos, orçamentos, relatórios financeiros. */
  | 'financeiro'
  /** Configuração do dia a dia: horários, procedimentos, WhatsApp, mensagens. */
  | 'configuracoes'
  /** Disparo de mensagem em massa. */
  | 'campanhas'
  /** Quem entra na clínica: convidar, trocar perfil, tirar acesso, excluir
   *  profissional. É a chave da porta — quem tem isto pode dar isto a si mesmo. */
  | 'equipe'
  /** Assinatura e cobrança do SaaS. */
  | 'planos'
  /** LGPD: consentimentos, exclusão de dados e o registro de quem fez o quê. */
  | 'privacidade'
  /** CRM: leads, funil, tarefas e conversão em paciente. */
  | 'crm'
  /** CRM: etapas do funil, tags, motivos de perda e excluir lead. */
  | 'crm_config'
  // ── Financeiro completo (spec 2026-11-16). A capacidade `financeiro` acima
  // continua valendo para as telas antigas; estas são as do módulo novo.
  /** Ver contas a receber e a pagar e as movimentações. */
  | 'fin_ver'
  /** Receber: na agenda, no orçamento, na ficha e nas contas. */
  | 'fin_receber'
  /** Lançar e pagar contas a pagar. */
  | 'fin_pagar'
  /** Abrir, movimentar e fechar o próprio caixa. */
  | 'fin_caixa'
  /** Ver e fechar o caixa de outra pessoa. */
  | 'fin_caixas_outros'
  /** Estornar pagamento e cancelar título. */
  | 'fin_estornar'
  /** Renegociar dívida. */
  | 'fin_renegociar'
  /** Conferir, aprovar e faturar comissões. */
  | 'fin_comissoes'
  /** Ver as próprias comissões (o profissional, se a clínica liberar). */
  | 'fin_comissoes_proprias'
  /** Relatórios gerenciais: visão geral, fluxo de caixa e DRE. */
  | 'fin_relatorios'
  /** Configurações do financeiro: contas, categorias, formas, regras. */
  | 'fin_config'
  // ── Paciente e agenda (spec 2026-11-18).
  /** Exportar a lista de pacientes e a ficha (a recepção, só se a clínica liberar). */
  | 'pacientes_exportar'
  /** Excluir agendamento lançado por engano (some da agenda, fica na auditoria). */
  | 'agenda_excluir'
  /** Alterações em massa na agenda. */
  | 'agenda_massa'
  /** Apagar anexos do paciente (o profissional, só os que ele mesmo subiu). */
  | 'anexos_apagar'
  /** Escalas, tipos de atendimento, agendas, motivos de cancelamento e feriados. */
  | 'agenda_config';

/**
 * O que cada papel alcança.
 *
 * A clínica trabalha junto: quem atende precisa ver a agenda cheia, o cadastro,
 * o prontuário e quanto o paciente deve, sem depender do dono estar por perto.
 * Repartir isso em quatro perfis fazia a recepcionista bater numa parede no meio
 * do atendimento — e o dono acabaria dando o login dele para ela, que é o pior
 * dos dois mundos.
 *
 * O que fica trancado é o que não dá para desfazer nem faz parte de atender:
 * mexer em quem tem acesso, na cobrança e nos dados pessoais sob a LGPD.
 */
const ADMIN_ONLY: readonly Capability[] = ['equipe', 'planos', 'privacidade'];

const DIA_A_DIA: readonly Capability[] = [
  'agenda',
  'pacientes',
  'prontuario',
  'financeiro',
  'configuracoes',
  'campanhas',
];

/**
 * O CRM é da equipe toda: recepção, profissionais, administração e o dono
 * atendem o WhatsApp e movem os negócios. Quem configura o CRM não sai daqui:
 * sai do cargo no CRM (`lib/crm-roles.ts`, Gestor), que a guarda consulta no
 * lugar de `crm_config`. O `crm_config` abaixo é só o padrão de quem ainda não
 * tem cargo escolhido.
 *
 * O papel é só metade da porta: a clínica também precisa ter o módulo
 * contratado (`Subscription.crmEnabled`), conferido em `crm/guard.ts`.
 */
const CRM: readonly Capability[] = ['crm'];
const CRM_ADMIN: readonly Capability[] = ['crm', 'crm_config'];

/**
 * Financeiro novo. A recepção trabalha sem depender do dono (recebe, lança,
 * opera o caixa, renegocia); fica trancado o que é difícil de desfazer ou é
 * de gestão: estorno, caixa dos outros, comissões, relatórios e configuração.
 * O profissional só vê as próprias comissões, e só se a clínica liberar
 * (`Tenant.settings.finance.professionalSeesCommissions`, conferido em `fin/guard.ts`).
 */
const FIN_RECEPCAO: readonly Capability[] = ['fin_ver', 'fin_receber', 'fin_pagar', 'fin_caixa', 'fin_renegociar', 'fin_comissoes_proprias'];
const FIN_GESTAO: readonly Capability[] = [...FIN_RECEPCAO, 'fin_caixas_outros', 'fin_estornar', 'fin_comissoes', 'fin_relatorios', 'fin_config'];

/**
 * Paciente e agenda: a recepção configura o dia a dia da agenda; exportar,
 * excluir, mexer em massa e apagar anexos ficam com quem responde pela clínica.
 * Exportar pela recepção depende da clínica (`Tenant.settings.patients.receptionCanExport`,
 * conferido em `lib/access.ts`); apagar anexo pelo profissional, só os dele (na action).
 */
const PAC_GESTAO: readonly Capability[] = ['pacientes_exportar', 'agenda_excluir', 'agenda_massa', 'anexos_apagar', 'agenda_config'];

const GRANTS: Record<Role, readonly Capability[]> = {
  OWNER: [...DIA_A_DIA, ...ADMIN_ONLY, ...CRM_ADMIN, ...FIN_GESTAO, ...PAC_GESTAO],
  ADMIN: [...DIA_A_DIA, ...ADMIN_ONLY, ...CRM_ADMIN, ...FIN_GESTAO, ...PAC_GESTAO],
  RECEPTIONIST: [...DIA_A_DIA, ...CRM, ...FIN_RECEPCAO, 'agenda_config'],
  PROFESSIONAL: [...DIA_A_DIA, ...CRM, 'fin_comissoes_proprias'],
};

/**
 * Papel usado quando não conseguimos determinar o de verdade. O menor de todos:
 * se a consulta falhar ou o valor vier estranho, o certo é conceder de menos.
 */
export const LEAST_PRIVILEGE: Role = 'PROFESSIONAL';

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && value in GRANTS;
}

export function can(role: string | null | undefined, capability: Capability): boolean {
  // Papel que não reconhecemos não entra no CRM: o menor privilégio cobre a
  // rotina da clínica, não as conversas de toda a equipe.
  if (!isRole(role) && (capability === 'crm' || capability === 'crm_config')) return false;
  const papel = isRole(role) ? role : LEAST_PRIVILEGE;
  return GRANTS[papel].includes(capability);
}

/** Rótulos para a mensagem que a pessoa lê na tela. */
const LABEL: Record<Capability, string> = {
  agenda: 'a agenda',
  pacientes: 'o cadastro de pacientes',
  prontuario: 'o prontuário clínico',
  financeiro: 'o financeiro',
  configuracoes: 'as configurações da clínica',
  campanhas: 'as campanhas',
  equipe: 'a gestão de quem tem acesso',
  planos: 'o plano e a cobrança',
  privacidade: 'os dados de privacidade e o histórico de alterações',
  crm: 'o CRM',
  crm_config: 'a configuração do funil do CRM',
  fin_ver: 'as contas e movimentações do financeiro',
  fin_receber: 'os recebimentos',
  fin_pagar: 'as contas a pagar',
  fin_caixa: 'o caixa',
  fin_caixas_outros: 'o caixa de outras pessoas',
  fin_estornar: 'estornos e cancelamentos',
  fin_renegociar: 'as renegociações',
  fin_comissoes: 'o faturamento de comissões',
  fin_comissoes_proprias: 'as comissões',
  fin_relatorios: 'os relatórios gerenciais do financeiro',
  fin_config: 'as configurações do financeiro',
  pacientes_exportar: 'exportar pacientes',
  agenda_excluir: 'excluir agendamentos',
  agenda_massa: 'as alterações em massa da agenda',
  anexos_apagar: 'apagar anexos',
  agenda_config: 'as configurações da agenda',
};

export function capabilityDeniedMessage(capability: Capability): string {
  return `Seu perfil não tem acesso a ${LABEL[capability]}. Fale com o responsável pela clínica.`;
}
