import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { QuoteDocument, type QuoteDocumentProps } from './quote-template';
import { ReceiptDocument, type ReceiptDocumentProps } from './receipt-template';
import { ContractDocument, type ContractDocumentProps } from './contract-template';
import { CouponDocument, type CouponDocumentProps } from './receipt-coupon';
import { CashReportDocument, type CashReportProps } from './cash-report';
import { RichDocument, type RichDocumentProps, type RichBlock, type SignatureProof } from './rich-document';
import { PatientCardDocument, PatientSheetDocument, type PatientCardProps, type PatientSheetProps } from './patient-sheet';

export { QuoteDocument, ReceiptDocument, ContractDocument, CouponDocument, CashReportDocument };
export type { QuoteDocumentProps, ReceiptDocumentProps, ContractDocumentProps, CouponDocumentProps, CashReportProps, PatientSheetProps, PatientCardProps, RichDocumentProps, RichBlock, SignatureProof };
export type { ClinicInfo, Person, TreatmentItem } from './theme';

// `renderToBuffer` is typed for a root <Document>; every template renders one,
// so the casts below are safe. Returns Uint8Array so no Node `Buffer` typings
// are required here, and the @react-pdf dependency stays inside this package.

/** Renders a quote to PDF bytes. */
export async function renderQuotePdf(props: QuoteDocumentProps): Promise<Uint8Array> {
  return renderToBuffer(createElement(QuoteDocument, props) as never);
}

/** Renders a payment receipt to PDF bytes. */
export async function renderReceiptPdf(props: ReceiptDocumentProps): Promise<Uint8Array> {
  return renderToBuffer(createElement(ReceiptDocument, props) as never);
}

/** Renders a service contract (built from a quote) to PDF bytes. */
export async function renderContractPdf(props: ContractDocumentProps): Promise<Uint8Array> {
  return renderToBuffer(createElement(ContractDocument, props) as never);
}

/** Renders a receipt as an 80 mm thermal-printer coupon. */
export async function renderCouponPdf(props: CouponDocumentProps): Promise<Uint8Array> {
  return renderToBuffer(createElement(CouponDocument, props) as never);
}

/** Renders the cash register report (closed, or partial while open). */
export async function renderCashReportPdf(props: CashReportProps): Promise<Uint8Array> {
  return renderToBuffer(createElement(CashReportDocument, props) as never);
}

/** Ficha do paciente (cadastro e, para quem pode, o resumo clínico). */
export async function renderPatientSheetPdf(props: PatientSheetProps): Promise<Uint8Array> {
  return renderToBuffer(createElement(PatientSheetDocument, props) as never);
}

/** Cartão do paciente no tamanho de cartão de visita, com o QR do agendamento online. */
export async function renderPatientCardPdf(props: PatientCardProps): Promise<Uint8Array> {
  return renderToBuffer(createElement(PatientCardDocument, props) as never);
}

/** Documento do paciente feito de um modelo (atestado, receita, termo), com a comprovação da assinatura quando houver. */
export async function renderRichDocumentPdf(props: RichDocumentProps): Promise<Uint8Array> {
  return renderToBuffer(createElement(RichDocument, props) as never);
}
