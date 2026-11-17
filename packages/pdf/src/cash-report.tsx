import React from 'react';
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { color, DocFooter, DocHeader, formatCurrency, s, type ClinicInfo } from './theme';

/**
 * Relatório do caixa: quem abriu e fechou, o resumo (entradas, saídas,
 * reforços, sangrias), a conferência por meio de pagamento, o recebido por
 * profissional e a lista dos movimentos. Serve para o caixa fechado e, como
 * parcial, para o caixa ainda aberto.
 */
export interface CashReportProps {
  clinic: ClinicInfo;
  cash: {
    /** "12" */
    code: string;
    open: boolean;
    userName: string;
    unitName?: string;
    accountName: string;
    /** dd/mm/aaaa hh:mm */
    openedAt: string;
    closedAt?: string;
    closedByName?: string;
    opening: number;
    summary: { receipts: number; payments: number; reinforcements: number; withdrawals: number; reversals: number };
    /** Por meio: o esperado e, no caixa fechado, o contado e a diferença. */
    methods: { label: string; expected: number; counted?: number; diff?: number }[];
    justification?: string;
    byProfessional: { name: string; amount: number }[];
    movements: { code: string; at: string; kind: string; detail: string; method: string; amount: number; reversed: boolean }[];
    generatedAt: string;
  };
}

const th = { fontSize: 7, fontFamily: 'Helvetica-Bold' as const, color: color.muted, textTransform: 'uppercase' as const, letterSpacing: 0.5 };
const row = { flexDirection: 'row' as const, paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: color.line };
const right = { textAlign: 'right' as const };

function Resumo({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ width: '33.33%', paddingVertical: 4 }}>
      <Text style={s.label}>{label}</Text>
      <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: color.ink }}>{formatCurrency(value)}</Text>
    </View>
  );
}

export function CashReportDocument({ clinic, cash }: CashReportProps) {
  const conferido = cash.methods.some((m) => m.counted !== undefined);
  return (
    <Document title={`Caixa ${cash.code} · ${cash.userName}`} author={clinic.name} language="pt-BR">
      <Page size="A4" style={s.page}>
        <DocHeader
          clinic={clinic}
          kind={cash.open ? 'Caixa (parcial)' : 'Relatório do caixa'}
          code={`Nº ${cash.code}`}
          meta={[
            { label: 'Aberto em', value: cash.openedAt },
            ...(cash.closedAt ? [{ label: 'Fechado em', value: cash.closedAt }] : []),
          ]}
        />

        <View style={{ ...s.box, flexDirection: 'row', flexWrap: 'wrap' }}>
          <View style={{ width: '33.33%' }}>
            <Text style={s.label}>Responsável</Text>
            <Text style={s.bold}>{cash.userName}</Text>
          </View>
          <View style={{ width: '33.33%' }}>
            <Text style={s.label}>Conta</Text>
            <Text style={s.bold}>
              {cash.accountName}
              {cash.unitName ? ` · ${cash.unitName}` : ''}
            </Text>
          </View>
          <View style={{ width: '33.33%' }}>
            <Text style={s.label}>{cash.closedAt ? 'Fechado por' : 'Situação'}</Text>
            <Text style={s.bold}>{cash.closedAt ? (cash.closedByName ?? cash.userName) : 'Aberto'}</Text>
          </View>
        </View>

        <Text style={{ ...s.sectionTitle, marginTop: 16 }}>Resumo</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Resumo label="Troco inicial" value={cash.opening} />
          <Resumo label="Recebimentos" value={cash.summary.receipts} />
          <Resumo label="Pagamentos" value={cash.summary.payments} />
          <Resumo label="Reforços" value={cash.summary.reinforcements} />
          <Resumo label="Sangrias" value={cash.summary.withdrawals} />
          <Resumo label="Estornos" value={cash.summary.reversals} />
        </View>

        <Text style={{ ...s.sectionTitle, marginTop: 14 }}>{conferido ? 'Conferência por meio de pagamento' : 'Esperado por meio de pagamento'}</Text>
        <View style={{ ...row, backgroundColor: color.soft, borderBottomWidth: 0 }}>
          <Text style={{ ...th, width: conferido ? '34%' : '60%' }}>Meio</Text>
          <Text style={{ ...th, ...right, width: conferido ? '22%' : '40%' }}>Esperado</Text>
          {conferido ? <Text style={{ ...th, ...right, width: '22%' }}>Contado</Text> : null}
          {conferido ? <Text style={{ ...th, ...right, width: '22%' }}>Diferença</Text> : null}
        </View>
        {cash.methods.map((m, i) => (
          <View key={i} style={row}>
            <Text style={{ width: conferido ? '34%' : '60%' }}>{m.label}</Text>
            <Text style={{ ...right, width: conferido ? '22%' : '40%' }}>{formatCurrency(m.expected)}</Text>
            {conferido ? <Text style={{ ...right, width: '22%' }}>{formatCurrency(m.counted ?? 0)}</Text> : null}
            {conferido ? <Text style={{ ...right, width: '22%', ...(m.diff ? s.bold : s.muted) }}>{m.diff ? formatCurrency(m.diff) : 'Bateu'}</Text> : null}
          </View>
        ))}
        {cash.justification ? (
          <View style={{ ...s.box, marginTop: 8 }}>
            <Text style={s.label}>Justificativa da diferença</Text>
            <Text style={{ lineHeight: 1.4 }}>{cash.justification}</Text>
          </View>
        ) : null}

        {cash.byProfessional.length > 0 ? (
          <View wrap={false}>
            <Text style={{ ...s.sectionTitle, marginTop: 14 }}>Recebido por profissional</Text>
            {cash.byProfessional.map((p, i) => (
              <View key={i} style={row}>
                <Text style={{ width: '70%' }}>{p.name}</Text>
                <Text style={{ ...right, width: '30%' }}>{formatCurrency(p.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={{ ...s.sectionTitle, marginTop: 14 }}>Movimentos</Text>
        <View style={{ ...row, backgroundColor: color.soft, borderBottomWidth: 0 }} fixed>
          <Text style={{ ...th, width: '8%' }}>Nº</Text>
          <Text style={{ ...th, width: '15%' }}>Quando</Text>
          <Text style={{ ...th, width: '42%' }}>Lançamento</Text>
          <Text style={{ ...th, width: '17%' }}>Meio</Text>
          <Text style={{ ...th, ...right, width: '18%' }}>Valor</Text>
        </View>
        {cash.movements.length === 0 ? <Text style={{ ...s.muted, marginTop: 6 }}>Nenhum movimento neste caixa.</Text> : null}
        {cash.movements.map((m, i) => (
          <View key={i} style={row} wrap={false}>
            <Text style={{ width: '8%' }}>{m.code}</Text>
            <Text style={{ width: '15%' }}>{m.at}</Text>
            <View style={{ width: '42%', paddingRight: 6 }}>
              <Text style={s.bold}>
                {m.kind}
                {m.reversed ? ' (estornado)' : ''}
              </Text>
              {m.detail ? <Text style={{ ...s.muted, fontSize: 8, marginTop: 1 }}>{m.detail}</Text> : null}
            </View>
            <Text style={{ width: '17%' }}>{m.method}</Text>
            <Text style={{ ...right, width: '18%' }}>{formatCurrency(m.amount)}</Text>
          </View>
        ))}

        <DocFooter clinic={clinic} issuedAt={cash.generatedAt} />
      </Page>
    </Document>
  );
}
