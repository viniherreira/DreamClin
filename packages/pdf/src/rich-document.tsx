import React from 'react';
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { color, DocFooter, DocHeader, s, Signature, type ClinicInfo, type Person } from './theme';

/**
 * Documento do paciente feito a partir de um modelo da clínica (atestado,
 * receita, termo…): o texto formatado chega em blocos já limpos, sai em A4 com
 * cabeçalho e rodapé da clínica e a assinatura do profissional. Assinado por
 * link, ganha a página de comprovação no fim.
 */

export interface RichRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  size?: number;
}

export type RichBlock =
  | { type: 'p' | 'h2' | 'h3'; runs: RichRun[] }
  | { type: 'li'; ordered: boolean; index: number; runs: RichRun[] }
  | { type: 'table'; rows: { header: boolean; cells: RichRun[][] }[] };

export interface SignatureProof {
  signedAt: string;
  signerName: string;
  cpf?: string;
  method: 'DRAWN' | 'ACCEPTED';
  drawing?: string;
  ip?: string;
  userAgent?: string;
  hash: string;
  code: string;
}

export interface RichDocumentProps {
  clinic: ClinicInfo;
  title: string;
  code: string;
  blocks: RichBlock[];
  signer?: Person;
  issuedAt: string;
  /** "São Paulo, 3 de outubro de 2026." */
  placeDate?: string;
  proof?: SignatureProof;
}

function runStyle(r: RichRun) {
  const font = r.bold && r.italic ? 'Helvetica-BoldOblique' : r.bold ? 'Helvetica-Bold' : r.italic ? 'Helvetica-Oblique' : 'Helvetica';
  return {
    fontFamily: font,
    ...(r.underline ? { textDecoration: 'underline' as const } : {}),
    ...(r.color ? { color: r.color } : {}),
    ...(r.size ? { fontSize: Math.max(7, Math.min(28, r.size * 0.75)) } : {}),
  };
}

function Runs({ runs }: { runs: RichRun[] }) {
  return (
    <>
      {runs.map((r, i) => (
        <Text key={i} style={runStyle(r)}>
          {r.text}
        </Text>
      ))}
    </>
  );
}

export function RichDocument({ clinic, title, code, blocks, signer, issuedAt, placeDate, proof }: RichDocumentProps) {
  return (
    <Document title={title} author={clinic.name} language="pt-BR">
      <Page size="A4" style={s.page}>
        <DocHeader clinic={clinic} kind={title} code={code} />
        <View style={{ marginTop: 6 }}>
          {blocks.map((b, i) => {
            if (b.type === 'table') {
              return (
                <View key={i} style={{ marginVertical: 6, borderWidth: 0.6, borderColor: color.line }}>
                  {b.rows.map((row, r) => (
                    <View key={r} style={{ flexDirection: 'row', backgroundColor: row.header ? color.soft : undefined, borderBottomWidth: r === b.rows.length - 1 ? 0 : 0.6, borderBottomColor: color.line }}>
                      {row.cells.map((cell, c) => (
                        <Text key={c} style={{ flex: 1, padding: 4, fontSize: 9, fontFamily: row.header ? 'Helvetica-Bold' : 'Helvetica', borderLeftWidth: c ? 0.6 : 0, borderLeftColor: color.line }}>
                          <Runs runs={cell} />
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              );
            }
            if (b.type === 'li') {
              return (
                <View key={i} style={{ flexDirection: 'row', marginBottom: 3, paddingLeft: 8 }}>
                  <Text style={{ width: 14, fontSize: 10 }}>{b.ordered ? `${b.index}.` : '•'}</Text>
                  <Text style={{ flex: 1, fontSize: 10, lineHeight: 1.5 }}>
                    <Runs runs={b.runs} />
                  </Text>
                </View>
              );
            }
            const titulo = b.type === 'h2' ? { fontSize: 13, fontFamily: 'Helvetica-Bold', color: color.ink, marginTop: 6 } : b.type === 'h3' ? { fontSize: 11, fontFamily: 'Helvetica-Bold', color: color.ink, marginTop: 4 } : {};
            return (
              <Text key={i} style={{ fontSize: 10, lineHeight: 1.6, marginBottom: 6, textAlign: 'justify', ...titulo }}>
                <Runs runs={b.runs} />
              </Text>
            );
          })}
        </View>
        {placeDate && <Text style={{ marginTop: 18, fontSize: 10 }}>{placeDate}</Text>}
        {signer && (
          <View style={{ marginTop: 36, alignItems: 'center' }} wrap={false}>
            <Signature title={signer.name} lines={[signer.registration]} />
          </View>
        )}
        <DocFooter clinic={clinic} issuedAt={issuedAt} />
      </Page>
      {proof && (
        <Page size="A4" style={s.page}>
          <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: color.ink, marginBottom: 4 }}>Comprovação de assinatura eletrônica</Text>
          <Text style={{ fontSize: 9, color: color.muted, marginBottom: 14 }}>Documento {proof.code} · {title}</Text>
          <View style={s.box}>
            {[
              ['Assinado por', proof.signerName],
              ['CPF conferido', proof.cpf || 'cadastro sem CPF'],
              ['Data e hora', proof.signedAt],
              ['Forma', proof.method === 'DRAWN' ? 'Assinatura desenhada na tela' : 'Aceite eletrônico'],
              ['Endereço IP', proof.ip || 'não informado'],
              ['Aparelho', proof.userAgent || 'não informado'],
              ['Código do documento (SHA-256)', proof.hash],
            ].map(([k, v]) => (
              <View key={k} style={{ marginBottom: 6 }}>
                <Text style={s.label}>{k}</Text>
                <Text style={{ fontSize: 9 }}>{v}</Text>
              </View>
            ))}
          </View>
          {proof.drawing && (
            <View style={{ marginTop: 16, alignItems: 'center' }}>
              <Image src={proof.drawing} style={{ width: 220, height: 90, objectFit: 'contain' }} />
              <View style={{ width: 240, borderTopWidth: 0.6, borderTopColor: color.line, marginTop: 2 }} />
              <Text style={{ fontSize: 8, color: color.muted, marginTop: 2 }}>{proof.signerName}</Text>
            </View>
          )}
          <Text style={{ marginTop: 18, fontSize: 8, color: color.muted, lineHeight: 1.5 }}>
            O código SHA-256 identifica o conteúdo das páginas anteriores no momento da assinatura. Qualquer mudança no documento gera outro código.
          </Text>
          <DocFooter clinic={clinic} issuedAt={proof.signedAt} />
        </Page>
      )}
    </Document>
  );
}
