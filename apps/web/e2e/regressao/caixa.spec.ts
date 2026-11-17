import { test, expect, type Page } from '@playwright/test';
import { uniqueName } from '../support/helpers';

/**
 * Regressão do caixa (financeiro completo, fase 3): receber em dinheiro pede o
 * caixa aberto e deixa abrir ali mesmo; sangria; fechar com diferença e
 * justificativa; relatório em PDF; caixas fechados.
 *
 * Só roda com o financeiro novo ligado (ver e2e/README.md).
 */

/** Fecha o caixa aberto, contando o dinheiro com a diferença pedida (em reais). */
async function fechaCaixa(page: Page, diferenca = 0): Promise<void> {
  // Recarrega: outro teste pode ter recebido algo neste caixa enquanto isso.
  await page.goto('/financeiro/caixa');
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  const janela = page.getByRole('dialog', { name: /^Fechar o caixa nº/ });
  const esperado = await janela.getByRole('row', { name: /^Dinheiro/ }).getByRole('cell').first().innerText();
  const centavos = Number(esperado.replace(/[^\d,-]/g, '').replace(',', '.')) * 100;
  const contado = Math.max(0, Math.round(centavos + diferenca * 100)) / 100;
  await janela.getByLabel('Contado em Dinheiro').fill(contado.toFixed(2).replace('.', ','));
  const justificativa = janela.getByLabel('Justificativa da diferença');
  if (await justificativa.isVisible()) await justificativa.fill('Conferência do teste de tela do caixa');
  await janela.getByRole('button', { name: 'Fechar caixa' }).click();
  // Depois de fechar, a pessoa cai na página do caixa fechado.
  const fechou = /\/financeiro\/caixa\/[^/]+\?fechado=1$/;
  // Os testes rodam juntos com o mesmo usuário: se outro recebeu algo neste caixa
  // depois de a janela abrir, o servidor pede a justificativa. Aí é só escrever e fechar.
  await Promise.race([page.waitForURL(fechou), janela.getByRole('alert').waitFor()]);
  if (!fechou.test(page.url())) {
    await justificativa.fill('Conferência do teste de tela do caixa');
    await janela.getByRole('button', { name: 'Fechar caixa' }).click();
  }
  await page.waitForURL(fechou);
  await expect(page.getByRole('status').filter({ hasText: /^Caixa fechado/ })).toBeVisible();
}

test('dinheiro pede o caixa aberto; abre ali mesmo, faz sangria, fecha com diferença e tira o relatório', async ({ page }) => {
  await page.goto('/financeiro/caixa');
  await page.waitForLoadState('networkidle');
  test.skip(!/\/financeiro\/caixa/.test(page.url()), 'Financeiro completo desligado neste ambiente.');

  // Sobra de uma execução anterior: fecha para começar com o caixa fechado.
  if (await page.getByRole('button', { name: 'Fechar caixa' }).isVisible()) {
    await fechaCaixa(page);
    await page.goto('/financeiro/caixa');
  }
  await expect(page.getByRole('heading', { name: 'Seu caixa está fechado' })).toBeVisible();

  // Conta a receber de R$ 120, paga em dinheiro.
  const descricao = uniqueName('Caixa E2E');
  await page.goto('/financeiro/contas');
  await page.getByRole('button', { name: 'Novo lançamento' }).click();
  const novo = page.getByRole('dialog', { name: 'Novo lançamento' });
  await novo.getByLabel('Categoria').selectOption({ index: 1 });
  await novo.getByLabel('Valor', { exact: true }).fill('120,00');
  await novo.getByLabel('Descrição (opcional)').fill(descricao);
  await novo.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Lançamento criado.' })).toBeVisible();

  await page.getByRole('button', { name: 'Mais filtros' }).click();
  const filtros = page.getByRole('dialog', { name: 'Mais filtros' });
  await filtros.getByLabel('Descrição').fill(descricao);
  await filtros.getByRole('button', { name: 'Filtrar' }).click();
  await page.getByRole('row').filter({ hasText: descricao }).getByRole('button', { name: /^Receber a conta/ }).click();

  const receber = page.getByRole('dialog', { name: /^Receber · conta nº/ });
  await receber.getByLabel('Forma').selectOption({ label: 'Dinheiro' });
  // Com o caixa fechado, o dinheiro não passa: o aviso traz o botão de abrir.
  await expect(receber.getByText('Abra o caixa para receber em dinheiro.')).toBeVisible();
  await expect(receber.getByRole('button', { name: /^Receber R\$/ })).toBeDisabled();
  await receber.getByLabel('Troco inicial').fill('50,00');
  await receber.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(receber.getByText('Abra o caixa para receber em dinheiro.')).toBeHidden();

  // O paciente entrega R$ 150: R$ 30 de troco.
  await receber.getByLabel('Valor', { exact: true }).fill('150,00');
  await receber.getByRole('button', { name: /^Receber R\$\s?120,00/ }).click();
  const feito = page.getByRole('dialog', { name: 'Recebimento registrado' });
  await expect(feito.getByText('Conta quitada.')).toBeVisible();
  await expect(feito.getByText(/Troco a devolver:/)).toContainText('30,00');
  await feito.getByRole('button', { name: 'Fechar' }).first().click();

  // No caixa: troco inicial de 50 + 120 recebidos = 170 em dinheiro.
  await page.goto('/financeiro/caixa');
  await expect(page.getByRole('heading', { name: /^Caixa nº \d+/ })).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar valores' }).click();
  const dinheiro = page.locator('dl > div').filter({ hasText: 'Dinheiro' });
  await expect(dinheiro).toContainText('170,00');
  await expect(page.getByRole('row').filter({ hasText: descricao })).toBeVisible();

  // Sangria de R$ 100; mais do que tem na gaveta é recusado.
  await page.getByRole('button', { name: 'Sangria' }).click();
  const sangria = page.getByRole('dialog', { name: 'Sangria' });
  await sangria.getByLabel('Valor').fill('500,00');
  await sangria.getByRole('button', { name: 'Registrar sangria' }).click();
  await expect(sangria.getByRole('alert')).toContainText('Não dá para tirar mais do que isso');
  await sangria.getByLabel('Valor').fill('100,00');
  await sangria.getByRole('button', { name: 'Registrar sangria' }).click();
  await expect(sangria).toBeHidden();
  await expect(dinheiro).toContainText('70,00');

  // Fecha contando R$ 10 a menos: pede a justificativa e avisa o dono.
  await fechaCaixa(page, -10);
  await expect(page.getByRole('status').filter({ hasText: 'Caixa fechado com diferença' })).toBeVisible();
  await expect(page.getByText('Justificativa da diferença:')).toBeVisible();
  const relatorio = await page.getByRole('link', { name: 'Relatório', exact: true }).getAttribute('href');
  const pdf = await page.request.get(relatorio!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');

  // Dinheiro volta a pedir o caixa aberto, o aviso aparece e o caixa entra nos fechados.
  await page.goto('/financeiro/caixa');
  await expect(page.getByRole('heading', { name: 'Seu caixa está fechado' })).toBeVisible();
  const avisos = page.getByRole('region', { name: 'Avisos do caixa' });
  await expect(avisos.getByText(/fechou com diferença/).first()).toBeVisible();
  await avisos.getByRole('button', { name: 'Marcar como visto' }).first().click();
  await page.goto('/financeiro/caixa/fechados');
  // O mais recente é o que acabou de fechar, com diferença (não "Bateu").
  const maisRecente = page.getByRole('table', { name: 'Caixas fechados' }).getByRole('row').nth(1);
  await expect(maisRecente).toContainText('R$');
  await expect(maisRecente).not.toContainText('Bateu');
});
