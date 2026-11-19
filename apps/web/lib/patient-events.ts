/**
 * Os tipos de evento da linha do tempo do paciente ("Na clínica"), com o
 * rótulo do filtro e o grupo. Puro: a tela, o servidor e os testes leem daqui.
 * O texto de cada evento é gravado pronto (`summary`), sem dado de saúde: o
 * que é clínico diz só "Evolução registrada", e o conteúdo fica no prontuário.
 */

export const EVENT_GROUPS = {
  cadastro: 'Cadastro',
  agenda: 'Agenda',
  clinico: 'Prontuário',
  financeiro: 'Financeiro',
  documentos: 'Documentos',
  mensagens: 'Mensagens',
} as const;

export type EventGroup = keyof typeof EVENT_GROUPS;

export const EVENT_TYPES = {
  'patient.created': { group: 'cadastro', label: 'Cadastro' },
  'patient.updated': { group: 'cadastro', label: 'Cadastro alterado' },
  'patient.activated': { group: 'cadastro', label: 'Reativado' },
  'patient.deactivated': { group: 'cadastro', label: 'Inativado' },
  'insurance.linked': { group: 'cadastro', label: 'Convênio vinculado' },
  'appointment.created': { group: 'agenda', label: 'Agendamento criado' },
  'appointment.confirmed': { group: 'agenda', label: 'Confirmado' },
  'appointment.rescheduled': { group: 'agenda', label: 'Remarcado' },
  'appointment.cancelled': { group: 'agenda', label: 'Cancelado' },
  'appointment.missed': { group: 'agenda', label: 'Faltou' },
  'appointment.attended': { group: 'agenda', label: 'Atendido' },
  'appointment.deleted': { group: 'agenda', label: 'Agendamento excluído' },
  'waitlist.added': { group: 'agenda', label: 'Lista de espera' },
  'evolution.created': { group: 'clinico', label: 'Evolução registrada' },
  'quote.created': { group: 'financeiro', label: 'Orçamento criado' },
  'quote.sent': { group: 'financeiro', label: 'Orçamento enviado' },
  'quote.accepted': { group: 'financeiro', label: 'Orçamento aprovado' },
  'payment.received': { group: 'financeiro', label: 'Pagamento recebido' },
  'plan.created': { group: 'clinico', label: 'Plano de tratamento' },
  'document.issued': { group: 'documentos', label: 'Documento emitido' },
  'document.signed': { group: 'documentos', label: 'Documento assinado' },
  'questionnaire.sent': { group: 'documentos', label: 'Questionário enviado' },
  'questionnaire.answered': { group: 'documentos', label: 'Questionário respondido' },
  'whatsapp.sent': { group: 'mensagens', label: 'Mensagem de WhatsApp' },
  'crm.linked': { group: 'mensagens', label: 'Lead do CRM ligado' },
} as const satisfies Record<string, { group: EventGroup; label: string }>;

export type PatientEventType = keyof typeof EVENT_TYPES;

/** Marca interna do preenchimento do passado (não aparece na tela). */
export const BACKFILL_MARK = '_backfill';

export function isEventType(v: unknown): v is PatientEventType {
  return typeof v === 'string' && v in EVENT_TYPES;
}

export function eventGroup(type: string): EventGroup | null {
  return isEventType(type) ? EVENT_TYPES[type].group : null;
}

/** Os tipos de um grupo, para o filtro da linha do tempo. */
export function typesOfGroup(group: string): PatientEventType[] {
  return (Object.keys(EVENT_TYPES) as PatientEventType[]).filter((t) => EVENT_TYPES[t].group === group);
}

/** Por onde a confirmação chegou, em texto. */
export const CONFIRMATION_SOURCE_LABEL: Record<string, string> = {
  WHATSAPP: 'pelo WhatsApp',
  LINK: 'pelo link',
  PHONE: 'por telefone',
  RECEPTION: 'na recepção',
};
