import type { DreLine } from './dre';

/**
 * O que toda clínica ganha ao abrir o financeiro pela primeira vez: o plano de
 * contas padrão, o caixa interno e as formas de recebimento. Puro.
 *
 * `key` identifica a categoria para o código (`FinancialCategory.systemKey`):
 * é por ela que o sistema acha "Procedimentos particulares" ou "Taxas de
 * cartão" mesmo que a clínica mude o nome.
 */

export type Direction = 'RECEIVABLE' | 'PAYABLE';

export interface DefaultSubcategory {
  key: string;
  name: string;
  dreLine: DreLine;
}

export interface DefaultCategory {
  key: string;
  name: string;
  direction: Direction;
  children: DefaultSubcategory[];
}

const sub = (key: string, name: string, dreLine: DreLine): DefaultSubcategory => ({ key, name, dreLine });

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  {
    key: 'receitas',
    name: 'Receitas',
    direction: 'RECEIVABLE',
    children: [
      sub('procedimentos_particulares', 'Procedimentos particulares', 'RECEITA_BRUTA'),
      sub('convenios', 'Convênios', 'RECEITA_BRUTA'),
      sub('venda_produtos', 'Venda de produtos', 'RECEITA_BRUTA'),
      sub('juros_recebidos', 'Juros recebidos', 'OUTRAS_RECEITAS'),
      sub('credito_carteira', 'Crédito na carteira do paciente', 'OUTRAS_RECEITAS'),
      sub('outras_receitas', 'Outras receitas', 'OUTRAS_RECEITAS'),
    ],
  },
  {
    key: 'deducoes',
    name: 'Deduções e impostos',
    direction: 'PAYABLE',
    children: [
      sub('simples_iss', 'Simples Nacional / ISS', 'IMPOSTOS'),
      sub('taxas_cartao', 'Taxas de cartão', 'DEDUCOES_RECEITA'),
      sub('descontos_concedidos', 'Descontos concedidos', 'DEDUCOES_RECEITA'),
      sub('devolucao_carteira', 'Devolução de crédito ao paciente', 'OUTRAS_DEDUCOES'),
    ],
  },
  {
    key: 'custos',
    name: 'Custos',
    direction: 'PAYABLE',
    children: [
      sub('materiais', 'Materiais e insumos', 'CUSTO_SERVICOS'),
      sub('laboratorio', 'Laboratório e próteses', 'CUSTO_SERVICOS'),
      sub('comissoes', 'Comissões e repasses', 'CUSTO_SERVICOS'),
    ],
  },
  {
    key: 'pessoal',
    name: 'Despesas com pessoal',
    direction: 'PAYABLE',
    children: [
      sub('salarios', 'Salários', 'DESPESAS_PESSOAL'),
      sub('pro_labore', 'Pró-labore', 'DESPESAS_PESSOAL'),
      sub('decimo_terceiro', '13º', 'DESPESAS_PESSOAL'),
      sub('ferias', 'Férias', 'DESPESAS_PESSOAL'),
      sub('fgts', 'FGTS', 'DESPESAS_PESSOAL'),
      sub('inss', 'INSS', 'DESPESAS_PESSOAL'),
      sub('beneficios', 'Benefícios', 'DESPESAS_PESSOAL'),
      sub('rescisoes', 'Rescisões', 'DESPESAS_PESSOAL'),
    ],
  },
  {
    key: 'administrativas',
    name: 'Despesas administrativas',
    direction: 'PAYABLE',
    children: [
      sub('aluguel', 'Aluguel', 'DESPESAS_ADMINISTRATIVAS'),
      sub('condominio', 'Condomínio', 'DESPESAS_ADMINISTRATIVAS'),
      sub('agua', 'Água', 'DESPESAS_ADMINISTRATIVAS'),
      sub('energia', 'Energia', 'DESPESAS_ADMINISTRATIVAS'),
      sub('internet_telefone', 'Internet e telefone', 'DESPESAS_ADMINISTRATIVAS'),
      sub('contabilidade', 'Contabilidade', 'DESPESAS_ADMINISTRATIVAS'),
      sub('sistemas', 'Sistemas e software', 'DESPESAS_ADMINISTRATIVAS'),
      sub('limpeza', 'Limpeza', 'DESPESAS_ADMINISTRATIVAS'),
      sub('manutencao', 'Manutenção', 'DESPESAS_ADMINISTRATIVAS'),
      sub('material_escritorio', 'Material de escritório', 'DESPESAS_ADMINISTRATIVAS'),
      sub('marketing', 'Marketing e anúncios', 'DESPESAS_ADMINISTRATIVAS'),
      sub('outras_despesas', 'Outras despesas', 'DESPESAS_ADMINISTRATIVAS'),
    ],
  },
  {
    key: 'financeiras',
    name: 'Despesas financeiras',
    direction: 'PAYABLE',
    children: [
      sub('tarifas_bancarias', 'Tarifas bancárias', 'DESPESAS_FINANCEIRAS'),
      sub('juros_pagos', 'Juros pagos', 'DESPESAS_FINANCEIRAS'),
      sub('antecipacao_cartao', 'Antecipação de cartão', 'DESPESAS_FINANCEIRAS'),
    ],
  },
  {
    key: 'investimentos',
    name: 'Investimentos',
    direction: 'PAYABLE',
    children: [sub('equipamentos', 'Equipamentos', 'INVESTIMENTOS_ATIVOS'), sub('obras', 'Obras e reformas', 'INVESTIMENTOS_ATIVOS')],
  },
];

/** As categorias que o sistema usa sozinho, por origem do lançamento. */
export const SYSTEM_CATEGORY = {
  atendimento: 'procedimentos_particulares',
  convenio: 'convenios',
  orcamento: 'procedimentos_particulares',
  carteira: 'credito_carteira',
  devolucaoCarteira: 'devolucao_carteira',
  taxaCartao: 'taxas_cartao',
  comissao: 'comissoes',
  juros: 'juros_recebidos',
  antecipacao: 'antecipacao_cartao',
  outrasReceitas: 'outras_receitas',
  outrasDespesas: 'outras_despesas',
} as const;

export type MethodKind = 'CASH' | 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO' | 'TRANSFER' | 'CHECK' | 'WALLET' | 'INSURANCE' | 'OTHER';

export const METHOD_KINDS: readonly MethodKind[] = ['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'TRANSFER', 'CHECK', 'WALLET', 'INSURANCE', 'OTHER'];

export const METHOD_KIND_LABEL: Record<MethodKind, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  BOLETO: 'Boleto',
  TRANSFER: 'Transferência',
  CHECK: 'Cheque',
  WALLET: 'Carteira do paciente',
  INSURANCE: 'Convênio',
  OTHER: 'Outros',
};

export const isMethodKind = (v: unknown): v is MethodKind => typeof v === 'string' && (METHOD_KINDS as readonly string[]).includes(v);

export interface DefaultMethod {
  name: string;
  kind: MethodKind;
  usage: 'RECEIVE' | 'PAY' | 'BOTH';
  settlementType: 'SAME_DAY' | 'DAYS' | 'DAY_OF_MONTH';
  settlementValue?: number;
  maxInstallments?: number;
}

export const DEFAULT_METHODS: readonly DefaultMethod[] = [
  { name: 'Dinheiro', kind: 'CASH', usage: 'BOTH', settlementType: 'SAME_DAY' },
  { name: 'PIX', kind: 'PIX', usage: 'BOTH', settlementType: 'SAME_DAY' },
  { name: 'Cartão de crédito', kind: 'CREDIT_CARD', usage: 'BOTH', settlementType: 'DAYS', settlementValue: 30, maxInstallments: 12 },
  { name: 'Cartão de débito', kind: 'DEBIT_CARD', usage: 'BOTH', settlementType: 'DAYS', settlementValue: 1 },
  { name: 'Boleto', kind: 'BOLETO', usage: 'BOTH', settlementType: 'DAYS', settlementValue: 1 },
  { name: 'Transferência', kind: 'TRANSFER', usage: 'BOTH', settlementType: 'SAME_DAY' },
  { name: 'Cheque', kind: 'CHECK', usage: 'BOTH', settlementType: 'SAME_DAY' },
  { name: 'Carteira do paciente', kind: 'WALLET', usage: 'RECEIVE', settlementType: 'SAME_DAY' },
  { name: 'Convênio', kind: 'INSURANCE', usage: 'RECEIVE', settlementType: 'SAME_DAY' },
  { name: 'Outros', kind: 'OTHER', usage: 'BOTH', settlementType: 'SAME_DAY' },
];

/** Adivinha o tipo de uma forma antiga, que era só um texto ("Cartão de crédito", "Pix"). */
export function guessMethodKind(name: string): MethodKind {
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/pix/.test(n)) return 'PIX';
  if (/dinheiro|especie/.test(n)) return 'CASH';
  if (/debito/.test(n)) return 'DEBIT_CARD';
  if (/credito|cartao/.test(n)) return 'CREDIT_CARD';
  if (/boleto/.test(n)) return 'BOLETO';
  if (/transfer|ted|doc\b/.test(n)) return 'TRANSFER';
  if (/cheque/.test(n)) return 'CHECK';
  if (/convenio|plano/.test(n)) return 'INSURANCE';
  if (/carteira|credito do paciente/.test(n)) return 'WALLET';
  return 'OTHER';
}

export const ACCOUNT_KIND_LABEL = { CASH: 'Caixa interno', BANK: 'Conta bancária', DIGITAL: 'Conta digital' } as const;

export const CONTACT_KIND_LABEL = {
  SUPPLIER: 'Fornecedor',
  INSURANCE: 'Convênio',
  CARD_OPERATOR: 'Operadora de cartão',
  THIRD_PARTY: 'Profissional terceiro',
  OTHER: 'Outro',
} as const;

export const ORIGIN_LABEL = {
  MANUAL: 'Lançamento manual',
  APPOINTMENT: 'Agendamento',
  QUOTE: 'Orçamento',
  COMMISSION: 'Comissão',
  CARD_FEE: 'Taxa de cartão',
  RENEGOTIATION: 'Renegociação',
  WALLET: 'Carteira',
  RECURRENCE: 'Recorrência',
  TRANSFER: 'Transferência',
} as const;

export const DEFAULT_ACCOUNT_NAME = 'Caixa interno';
