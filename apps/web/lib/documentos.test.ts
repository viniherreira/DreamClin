import { describe, expect, it } from 'vitest';
import { docHtmlToBlocks, isClinicalKind, renderTemplate, sanitizeDocHtml } from './doc-template';
import { canSign, cpfMatches, signatureState, validDrawing } from './signature';
import { anamnesisItemsFrom, cleanQuestionnaireAnswers, readQuestions } from './questionnaire';

describe('modelo de documento', () => {
  it('troca as variáveis, escapa os valores e deixa linha para o que falta', () => {
    const r = renderTemplate('Atesto que {paciente} ({cpf}) precisa de {dias} dias. {campo:Time} {outra}', { paciente: 'Ana <b>', dias: '2' }, { time: 'Azul' });
    expect(r).toBe('Atesto que Ana &lt;b&gt; (__________) precisa de 2 dias. Azul {outra}');
  });

  it('atestado e receita são clínicos; declaração não', () => {
    expect(isClinicalKind('CERTIFICATE')).toBe(true);
    expect(isClinicalKind('PRESCRIPTION')).toBe(true);
    expect(isClinicalKind('ATTENDANCE')).toBe(false);
  });
});

describe('limpeza do texto formatado', () => {
  it('tira script, eventos, links e estilos perigosos; mantém formatação', () => {
    const sujo =
      '<p onclick="x()">Oi <strong>forte</strong><script>alert(1)</script><a href="javascript:x">link</a></p><img src=x onerror=alert(1)><span style="color: #ff0000; background:url(x); font-size: 14px">vermelho</span><div>bloco</div><!-- c -->';
    expect(sanitizeDocHtml(sujo)).toBe('<p>Oi <strong>forte</strong>link</p><span style="color: #ff0000; font-size: 14px">vermelho</span><p>bloco</p>');
  });

  it('fecha o que ficou aberto e ignora fechamento solto', () => {
    expect(sanitizeDocHtml('<ul><li>um<li>dois</ul></em>texto <b>aberto')).toBe('<ul><li>um<li>dois</li></li></ul>texto <b>aberto</b>');
  });

  it('vira blocos para o PDF: títulos, listas numeradas, tabela e formatação', () => {
    const blocos = docHtmlToBlocks(
      sanitizeDocHtml('<h2>Receita</h2><p>Use <b>2x</b> ao dia &amp; beba água</p><ol><li>Um</li><li>Dois</li></ol><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'),
    );
    expect(blocos[0]).toEqual({ type: 'h2', runs: [{ text: 'Receita' }] });
    expect(blocos[1]).toEqual({ type: 'p', runs: [{ text: 'Use ' }, { text: '2x', bold: true }, { text: ' ao dia & beba água' }] });
    expect(blocos[2]).toMatchObject({ type: 'li', ordered: true, index: 1 });
    expect(blocos[3]).toMatchObject({ type: 'li', ordered: true, index: 2 });
    expect(blocos[4]).toMatchObject({ type: 'table', rows: [{ header: true }, { header: false }] });
  });
});

describe('assinatura por link', () => {
  const futuro = new Date(Date.now() + 60_000);
  const passado = new Date(Date.now() - 60_000);
  it('situação: vencido é calculado; assinado e recusado não vencem', () => {
    expect(signatureState({ status: 'PENDING', expiresAt: futuro })).toBe('PENDING');
    expect(signatureState({ status: 'VIEWED', expiresAt: passado })).toBe('EXPIRED');
    expect(signatureState({ status: 'SIGNED', expiresAt: passado })).toBe('SIGNED');
    expect(canSign({ status: 'VIEWED', expiresAt: futuro })).toBe(true);
    expect(canSign({ status: 'SIGNED', expiresAt: futuro })).toBe(false);
  });

  it('CPF confere só pelos dígitos; desenho só PNG pequeno', () => {
    expect(cpfMatches('529.982.247-25', '52998224725')).toBe(true);
    expect(cpfMatches('111', '52998224725')).toBe(false);
    expect(cpfMatches('', null)).toBe(true);
    expect(validDrawing('data:image/png;base64,AAAA')).toBe(true);
    expect(validDrawing('data:image/svg+xml;base64,AAAA')).toBe(false);
  });
});

describe('questionário', () => {
  const qs = readQuestions([
    { id: 'q1', label: 'Tem alergia?', type: 'YESNO', required: true, anamnesisKey: 'allergy' },
    { id: 'q2', label: 'Como soube?', type: 'SINGLE', options: ['Instagram', 'Google'] },
    { id: 'q3', label: 'Inválida', type: 'XYZ' },
  ]);

  it('lê só perguntas válidas', () => {
    expect(qs.map((q) => q.id)).toEqual(['q1', 'q2']);
  });

  it('confere as respostas e leva o sim/não para a anamnese', () => {
    const r = cleanQuestionnaireAnswers(qs, { q1: { v: 'Sim', obs: 'dipirona' }, q2: { v: 'Rádio' } });
    expect(r.errors).toEqual({ q2: 'Escolha uma das opções' });
    expect(anamnesisItemsFrom(qs, r.answers, new Set(['allergy']))).toEqual({ allergy: { value: 'yes', detail: 'dipirona' } });
    expect(cleanQuestionnaireAnswers(qs, {}).errors).toEqual({ q1: 'Obrigatório' });
  });
});
