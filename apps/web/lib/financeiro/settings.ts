/**
 * Regras gerais do financeiro (`Tenant.settings.finance`). Puro: lê qualquer
 * coisa que venha do JSON e devolve um objeto completo, com os padrões.
 * Testado em `settings.test.ts`.
 */

export interface FinanceSettings {
  /** Exigir bandeira e NSU ao receber no cartão. */
  requireCardData: boolean;
  /** Recibo A4 com o cabeçalho da clínica e a margem de cima, em milímetros. */
  receiptHeader: boolean;
  receiptTopMarginMm: number;
  /** Juros e multa automáticos em título vencido. */
  lateChargesEnabled: boolean;
  finePercent: number;
  dailyInterestPercent: number;
  /** Juros dos títulos novos de uma renegociação (% ao mês) e o modo. */
  renegotiationInterestPercent: number;
  renegotiationInterestMode: 'SIMPLE' | 'PRICE';
  /** Receber em dinheiro só com o caixa aberto. */
  requireOpenCashForCash: boolean;
  /** Fechar o caixa com atendidos sem faturar: só avisa ou bloqueia. */
  closeWithUnbilled: 'WARN' | 'BLOCK';
  /** Conferência cega no fechamento do caixa. */
  blindCashCount: boolean;
  /** Bloquear o início do atendimento: nunca, só com o título, ou só pago. */
  blockStartWithoutPayment: 'OFF' | 'BILLED' | 'PAID';
  /** Criar o título sozinho quando o atendimento é concluído. */
  autoBillOnFinish: boolean;
  /** Mostrar valores dos procedimentos para o profissional. */
  showPricesToProfessional: boolean;
  /** Permitir mudar procedimentos depois de atendido. */
  editItemsAfterAttended: boolean;
  /** Limite de desconto de quem não tem um limite próprio, em %. */
  defaultMaxDiscountPercent: number;
  /** Obrigar CPF/CNPJ no cadastro de fornecedor. */
  requireSupplierDocument: boolean;
  /** Lançar a taxa do cartão no recebimento ou só na conciliação. */
  cardFeeWhen: 'RECEIPT' | 'RECONCILIATION';
  /** Avisar caixa aberto há mais de N dias (0 = não avisa). */
  openCashAlertDays: number;
  /** Avisar o dono quando um caixa fecha com diferença. */
  alertCashDifference: boolean;
  /** O profissional vê as próprias comissões. */
  professionalSeesCommissions: boolean;
  /** Comissões ligadas (sem exceção nem % no profissional, a regra padrão é 0: nada nasce). */
  commissionEnabled: boolean;
  /** Regra padrão da clínica para particular e convênio. */
  commissionParticular: CommissionDefault;
  commissionConvenio: CommissionDefault;
  /** Base: o preço da tabela do procedimento ou o valor cobrado (já com desconto). */
  commissionBase: 'CHARGED' | 'TABLE';
  /** Descontar o custo de material do procedimento da base. */
  commissionDeductCost: boolean;
  /** Quando a comissão nasce: no atendimento, no faturamento ou no recebimento (proporcional). */
  commissionWhen: 'EXECUTION' | 'BILLING' | 'RECEIPT';
  /** Categoria e conta da conta a pagar gerada ao faturar as comissões. */
  commissionCategoryId: string | null;
  commissionAccountId: string | null;
  /** Régua de cobrança pelo WhatsApp: ligada, dias antes, no dia, dias depois. */
  collectionEnabled: boolean;
  collectionDaysBefore: number;
  collectionOnDueDay: boolean;
  collectionDaysAfter: number[];
}

export interface CommissionDefault {
  mode: 'PERCENT' | 'FIXED';
  /** % ou reais (por item), conforme o modo. */
  value: number;
}

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  requireCardData: false,
  receiptHeader: true,
  receiptTopMarginMm: 0,
  lateChargesEnabled: false,
  finePercent: 2,
  dailyInterestPercent: 0.033,
  renegotiationInterestPercent: 0,
  renegotiationInterestMode: 'SIMPLE',
  requireOpenCashForCash: true,
  closeWithUnbilled: 'WARN',
  blindCashCount: false,
  blockStartWithoutPayment: 'OFF',
  autoBillOnFinish: false,
  showPricesToProfessional: true,
  editItemsAfterAttended: true,
  defaultMaxDiscountPercent: 10,
  requireSupplierDocument: false,
  cardFeeWhen: 'RECEIPT',
  openCashAlertDays: 1,
  alertCashDifference: true,
  professionalSeesCommissions: false,
  commissionEnabled: true,
  commissionParticular: { mode: 'PERCENT', value: 0 },
  commissionConvenio: { mode: 'PERCENT', value: 0 },
  commissionBase: 'CHARGED',
  commissionDeductCost: false,
  commissionWhen: 'EXECUTION',
  commissionCategoryId: null,
  commissionAccountId: null,
  collectionEnabled: false,
  collectionDaysBefore: 3,
  collectionOnDueDay: true,
  collectionDaysAfter: [3, 10],
};

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const pick = <T extends string>(v: unknown, options: readonly T[], d: T): T => (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : d);

function commissionDefault(v: unknown, d: CommissionDefault): CommissionDefault {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const mode = pick(o.mode, ['PERCENT', 'FIXED'] as const, d.mode);
  return { mode, value: num(o.value, d.value, 0, mode === 'PERCENT' ? 100 : 100_000) };
}

export function cleanFinanceSettings(raw: unknown): FinanceSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_FINANCE_SETTINGS;
  return {
    requireCardData: bool(r.requireCardData, d.requireCardData),
    receiptHeader: bool(r.receiptHeader, d.receiptHeader),
    receiptTopMarginMm: Math.round(num(r.receiptTopMarginMm, d.receiptTopMarginMm, 0, 120)),
    lateChargesEnabled: bool(r.lateChargesEnabled, d.lateChargesEnabled),
    finePercent: num(r.finePercent, d.finePercent, 0, 20),
    dailyInterestPercent: num(r.dailyInterestPercent, d.dailyInterestPercent, 0, 5),
    renegotiationInterestPercent: num(r.renegotiationInterestPercent, d.renegotiationInterestPercent, 0, 20),
    renegotiationInterestMode: pick(r.renegotiationInterestMode, ['SIMPLE', 'PRICE'] as const, d.renegotiationInterestMode),
    requireOpenCashForCash: bool(r.requireOpenCashForCash, d.requireOpenCashForCash),
    closeWithUnbilled: pick(r.closeWithUnbilled, ['WARN', 'BLOCK'] as const, d.closeWithUnbilled),
    blindCashCount: bool(r.blindCashCount, d.blindCashCount),
    blockStartWithoutPayment: pick(r.blockStartWithoutPayment, ['OFF', 'BILLED', 'PAID'] as const, d.blockStartWithoutPayment),
    autoBillOnFinish: bool(r.autoBillOnFinish, d.autoBillOnFinish),
    showPricesToProfessional: bool(r.showPricesToProfessional, d.showPricesToProfessional),
    editItemsAfterAttended: bool(r.editItemsAfterAttended, d.editItemsAfterAttended),
    defaultMaxDiscountPercent: num(r.defaultMaxDiscountPercent, d.defaultMaxDiscountPercent, 0, 100),
    requireSupplierDocument: bool(r.requireSupplierDocument, d.requireSupplierDocument),
    cardFeeWhen: pick(r.cardFeeWhen, ['RECEIPT', 'RECONCILIATION'] as const, d.cardFeeWhen),
    openCashAlertDays: Math.round(num(r.openCashAlertDays, d.openCashAlertDays, 0, 60)),
    alertCashDifference: bool(r.alertCashDifference, d.alertCashDifference),
    professionalSeesCommissions: bool(r.professionalSeesCommissions, d.professionalSeesCommissions),
    commissionEnabled: bool(r.commissionEnabled, d.commissionEnabled),
    commissionParticular: commissionDefault(r.commissionParticular, d.commissionParticular),
    commissionConvenio: commissionDefault(r.commissionConvenio, d.commissionConvenio),
    commissionBase: pick(r.commissionBase, ['CHARGED', 'TABLE'] as const, d.commissionBase),
    commissionDeductCost: bool(r.commissionDeductCost, d.commissionDeductCost),
    commissionWhen: pick(r.commissionWhen, ['EXECUTION', 'BILLING', 'RECEIPT'] as const, d.commissionWhen),
    commissionCategoryId: typeof r.commissionCategoryId === 'string' && r.commissionCategoryId ? r.commissionCategoryId.slice(0, 64) : null,
    commissionAccountId: typeof r.commissionAccountId === 'string' && r.commissionAccountId ? r.commissionAccountId.slice(0, 64) : null,
    collectionEnabled: bool(r.collectionEnabled, d.collectionEnabled),
    collectionDaysBefore: Math.round(num(r.collectionDaysBefore, d.collectionDaysBefore, 0, 30)),
    collectionOnDueDay: bool(r.collectionOnDueDay, d.collectionOnDueDay),
    collectionDaysAfter: Array.isArray(r.collectionDaysAfter)
      ? [...new Set(r.collectionDaysAfter.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 90))].sort((a, b) => a - b).slice(0, 3)
      : d.collectionDaysAfter,
  };
}

/** Lê de `Tenant.settings` inteiro. */
export function readFinanceSettings(settings: unknown): FinanceSettings {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).finance : undefined;
  return cleanFinanceSettings(s);
}
