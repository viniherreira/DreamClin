import React from 'react';
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { color, DocFooter, DocHeader, s, type ClinicInfo } from './theme';

/**
 * Ficha do paciente: o cadastro em folha A4, com o resumo clínico para quem
 * pode ver o prontuário. Opções: cabeçalho da clínica, rodapé, título e linhas
 * em branco no fim da folha para anotar à mão.
 */
export interface PatientSheetProps {
  clinic: ClinicInfo;
  title: string;
  header: boolean;
  footer: boolean;
  /** Quantas linhas em branco no fim (0 = nenhuma). */
  blankLines: number;
  sections: { title: string; rows: { label: string; value: string }[] }[];
  issuedAt: string;
  code: string;
}

export function PatientSheetDocument({ clinic, title, header, footer, blankLines, sections, issuedAt, code }: PatientSheetProps) {
  return (
    <Document title={title} author={clinic.name} language="pt-BR">
      <Page size="A4" style={s.page}>
        {header ? (
          <DocHeader clinic={clinic} kind={title} code={code} />
        ) : (
          <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold', color: color.ink, marginBottom: 14 }}>{title}</Text>
        )}
        {sections.map((sec) => (
          <View key={sec.title} style={{ marginBottom: 12 }} wrap={false}>
            <Text style={s.sectionTitle}>{sec.title}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {sec.rows.map((r) => (
                <View key={r.label} style={{ width: '50%', paddingRight: 10, marginBottom: 6 }}>
                  <Text style={s.label}>{r.label}</Text>
                  <Text style={{ fontSize: 9.5, color: r.value ? color.body : color.faint }}>{r.value || 'Não informado'}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
        {blankLines > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={s.sectionTitle}>Anotações</Text>
            {Array.from({ length: blankLines }, (_, i) => (
              <View key={i} style={{ borderBottomWidth: 0.6, borderBottomColor: color.line, height: 20 }} />
            ))}
          </View>
        )}
        {footer && <DocFooter clinic={clinic} issuedAt={issuedAt} />}
      </Page>
    </Document>
  );
}

/**
 * Cartão do paciente, no tamanho de um cartão de visita (85 × 55 mm): logo da
 * clínica, nome, número de controle e o QR code do agendamento online.
 */
export interface PatientCardProps {
  clinic: ClinicInfo;
  patientName: string;
  controlNumber: string;
  /** PNG do QR code em data URL. */
  qr: string;
  /** Imagem de fundo opcional (data URL ou caminho baixado no servidor). */
  background?: string;
  phone?: string;
}

const MM = 2.8346;

export function PatientCardDocument({ clinic, patientName, controlNumber, qr, background, phone }: PatientCardProps) {
  return (
    <Document title={`Cartão de ${patientName}`} author={clinic.name} language="pt-BR">
      <Page size={[85 * MM, 55 * MM]} style={{ padding: 0, fontFamily: 'Helvetica', color: color.ink }}>
        {background && <Image src={background} style={{ position: 'absolute', top: 0, left: 0, width: 85 * MM, height: 55 * MM }} fixed />}
        <View style={{ flexDirection: 'row', padding: 10, height: 55 * MM }}>
          <View style={{ flex: 1, justifyContent: 'space-between' }}>
            <View>
              {clinic.logo ? (
                <Image src={clinic.logo} style={{ height: 22, objectFit: 'contain', alignSelf: 'flex-start' }} />
              ) : (
                <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: color.accent }}>{clinic.name}</Text>
              )}
            </View>
            <View>
              <Text style={{ fontSize: 6, color: color.muted, letterSpacing: 0.6 }}>PACIENTE</Text>
              <Text style={{ fontSize: 10.5, fontFamily: 'Helvetica-Bold' }}>{patientName}</Text>
              <Text style={{ fontSize: 7.5, color: color.muted, marginTop: 2 }}>Nº {controlNumber}</Text>
            </View>
            <Text style={{ fontSize: 6.5, color: color.muted }}>{[phone ?? clinic.phone, clinic.cityState].filter(Boolean).join('  ·  ')}</Text>
          </View>
          <View style={{ width: 30 * MM, alignItems: 'center', justifyContent: 'center' }}>
            <Image src={qr} style={{ width: 27 * MM, height: 27 * MM }} />
            <Text style={{ fontSize: 5.5, color: color.muted, marginTop: 2, textAlign: 'center' }}>Agende pelo celular</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
