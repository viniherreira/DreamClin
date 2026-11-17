import React from 'react';
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { documentLabel, formatCurrency, type ClinicInfo } from './theme';

/**
 * Recibo em cupom, para impressora térmica de 80 mm.
 *
 * A bobina não tem altura fixa, mas o PDF precisa de uma: ela é estimada pelo
 * número de linhas, com folga, para o cupom não cortar nem sobrar papel demais.
 * Só preto, sem cor de fundo e sem logotipo: é o que a térmica imprime bem.
 */
export interface CouponDocumentProps {
  clinic: ClinicInfo;
  receipt: {
    number: string;
    payer: { name: string; document?: string };
    amount: number;
    amountText: string;
    /** dd/mm/aaaa */
    paidAt: string;
    reference: string;
    /** Cada meio do recebimento. */
    payments: { method: string; amount: number }[];
    /** Troco devolvido, se houve. */
    change?: number;
    receivedBy?: string;
    generatedAt: string;
  };
}

const MM = 2.8346;
const LARGURA = 80 * MM;

const linha = { borderBottomWidth: 0.7, borderBottomColor: '#000', borderBottomStyle: 'dashed' as const, marginVertical: 6 };
const par = { flexDirection: 'row' as const, justifyContent: 'space-between' as const, marginTop: 2 };

export function CouponDocument({ clinic, receipt }: CouponDocumentProps) {
  const linhasTexto = 22 + receipt.payments.length + Math.ceil(receipt.reference.length / 34) + Math.ceil(receipt.amountText.length / 38) + Math.ceil((clinic.address?.length ?? 0) / 38);
  const altura = Math.max(120 * MM, linhasTexto * 11 + 60);

  return (
    <Document title={`Recibo ${receipt.number}`} author={clinic.name} language="pt-BR">
      <Page size={[LARGURA, altura]} style={{ paddingVertical: 12, paddingHorizontal: 11, fontSize: 8, fontFamily: 'Helvetica', color: '#000' }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 10.5, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>{clinic.name}</Text>
          {clinic.document ? (
            <Text style={{ marginTop: 2 }}>
              {documentLabel(clinic.document)} {clinic.document}
            </Text>
          ) : null}
          {clinic.address ? <Text style={{ marginTop: 2, textAlign: 'center', lineHeight: 1.3 }}>{clinic.address}</Text> : null}
          {clinic.phone ? <Text style={{ marginTop: 2 }}>{clinic.phone}</Text> : null}
        </View>

        <View style={linha} />
        <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>RECIBO {receipt.number}</Text>
        <Text style={{ textAlign: 'center', marginTop: 2 }}>{receipt.paidAt}</Text>
        <View style={linha} />

        <Text style={{ fontFamily: 'Helvetica-Bold' }}>Recebemos de</Text>
        <Text style={{ marginTop: 2, lineHeight: 1.3 }}>{receipt.payer.name}</Text>
        {receipt.payer.document ? (
          <Text style={{ marginTop: 1 }}>
            {documentLabel(receipt.payer.document)} {receipt.payer.document}
          </Text>
        ) : null}
        <Text style={{ fontFamily: 'Helvetica-Bold', marginTop: 6 }}>Referente a</Text>
        <Text style={{ marginTop: 2, lineHeight: 1.3 }}>{receipt.reference}</Text>

        <View style={linha} />
        {receipt.payments.map((p, i) => (
          <View key={i} style={par}>
            <Text>{p.method}</Text>
            <Text>{formatCurrency(p.amount)}</Text>
          </View>
        ))}
        {receipt.change ? (
          <View style={par}>
            <Text>Troco</Text>
            <Text>{formatCurrency(receipt.change)}</Text>
          </View>
        ) : null}
        <View style={{ ...par, marginTop: 5 }}>
          <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>TOTAL</Text>
          <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{formatCurrency(receipt.amount)}</Text>
        </View>
        <Text style={{ marginTop: 3, lineHeight: 1.3 }}>({receipt.amountText})</Text>

        <View style={linha} />
        {receipt.receivedBy ? <Text>Recebido por: {receipt.receivedBy}</Text> : null}
        <Text style={{ marginTop: 16, textAlign: 'center' }}>________________________________</Text>
        <Text style={{ marginTop: 2, textAlign: 'center' }}>Assinatura</Text>
        <Text style={{ marginTop: 10, textAlign: 'center', fontSize: 6.5 }}>Emitido em {receipt.generatedAt}</Text>
      </Page>
    </Document>
  );
}
