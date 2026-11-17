import { test, expect, type Page } from '@playwright/test';
import { createPatient, uniqueName } from '../support/helpers';

/**
 * Financeiro completo, fase 5: crédito na carteira do paciente (com recibo),
 * renegociação de duas contas em 2 parcelas, e transferência entre contas com
 * estorno. Só roda com o financeiro novo ligado (ver e2e/README.md).
 */

async function ligado(page: Page) {
  await page.goto('/financeiro/carteiras');
  await page.waitForLoadState('networkidle');
  return /\/financeiro\/carteiras/.test(page.url());
}

/** Lança uma conta a receber para o paciente pela ficha. */
async function novaConta(page: Page, valor: string, descricao: string) {
  await page.getByRole('button', { name: 'Nova conta' }).click();
  const d = page.getByRole('dialog', { name: 'Novo lançamento' });
  await d.getByLabel('Categoria').selectOption({ index: 1 });
  await d.getByLabel('Valor', { exact: true }).fill(valor);
  await d.getByLabel('Descrição (opcional)').fill(descricao);
  await d.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Conta criada.' })).toBeVisible();
}

test('carteira: adiciona crédito com recibo e devolve parte', async ({ page }) => {
  test.skip(!(await ligado(page)), 'Financeiro completo desligado neste ambiente.');
  const nome = uniqueName('Paciente Carteira E2E');
  const id = await createPatient(page, nome);
  await page.goto(`/pacientes/${id}?aba=financeiro`);
  await page.getByRole('button', { name: 'Adicionar crédito' }).click();
  const d = page.getByRole('dialog', { name: 'Adicionar crédito na carteira' });
  await d.getByLabel('Valor').fill('80,00');
  await d.getByLabel('Como o paciente pagou').selectOption({ label: 'PIX' });
  await d.getByRole('button', { name: /^Adicionar R\$/ }).click();
  const feito = page.getByRole('dialog', { name: 'Crédito adicionado' });
  const href = await feito.getByRole('link', { name: 'Recibo' }).getAttribute('href');
  expect((await page.request.get(href!)).status()).toBe(200);
  await feito.getByRole('button', { name: 'Fechar' }).first().click();
  await expect(page.getByRole('region', { name: 'Carteira do paciente' })).toContainText('80,00');

  await page.getByRole('button', { name: 'Devolver crédito' }).click();
  const dev = page.getByRole('dialog', { name: 'Devolver crédito' });
  await dev.getByLabel('Valor').fill('30,00');
  await dev.getByLabel('Como vai devolver').selectOption({ label: 'PIX' });
  await dev.getByRole('button', { name: /^Devolver R\$/ }).click();
  await expect(dev).toBeHidden();
  await expect(page.getByRole('region', { name: 'Carteira do paciente' })).toContainText('Devolvido ao paciente');

  await page.goto('/financeiro/carteiras');
  await page.locator('#cart-busca').fill(nome);
  await expect(page.getByRole('row').filter({ hasText: nome })).toContainText('50,00');
});

test('renegociação: duas contas viram 2 parcelas e dá para desfazer', async ({ page }) => {
  test.skip(!(await ligado(page)), 'Financeiro completo desligado neste ambiente.');
  const nome = uniqueName('Paciente Renegocia E2E');
  const id = await createPatient(page, nome);
  await page.goto(`/pacientes/${id}?aba=financeiro`);
  await novaConta(page, '100,00', 'Primeira conta');
  await novaConta(page, '200,00', 'Segunda conta');

  await page.getByRole('link', { name: 'Renegociar' }).click();
  const w = page.getByRole('dialog', { name: /^Nova renegociação · passo 1/ });
  await expect(w.getByText(/Total corrigido:\s*R\$\s?300,00/)).toBeVisible();
  await w.getByRole('button', { name: 'Negociar' }).click();
  const w2 = page.getByRole('dialog', { name: /^Nova renegociação · passo 2/ });
  await w2.getByLabel('Parcelas').fill('2');
  await expect(w2.getByText(/Parcela 2 ·/)).toBeVisible();
  await w2.getByRole('button', { name: 'Confirmar renegociação' }).click();
  const fim = page.getByRole('dialog', { name: 'Renegociação feita' });
  await expect(fim.getByText(/Renegociação nº \d+ feita/)).toBeVisible();
  await fim.getByRole('button', { name: 'Fechar' }).first().click();

  const linha = page.getByRole('row').filter({ hasText: nome });
  await expect(linha).toContainText('2x');
  await expect(linha).toContainText('300,00');
  page.once('dialog', (d) => void d.accept());
  await linha.getByRole('button', { name: /^Desfazer a renegociação/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /desfeita/ })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: nome })).toContainText('Desfeita');
});

test('transferência entre contas e estorno das duas pontas', async ({ page }) => {
  test.skip(!(await ligado(page)), 'Financeiro completo desligado neste ambiente.');
  await page.goto('/financeiro/transferencias');
  await page.getByRole('button', { name: 'Nova transferência' }).click();
  const d = page.getByRole('dialog', { name: 'Nova transferência' });
  const origem = d.getByLabel('Conta de origem');
  const destino = d.getByLabel('Conta de destino');
  const opcoes = await origem.locator('option').count();
  test.skip(opcoes < 2, 'A clínica de teste tem uma conta só.');
  const descricao = uniqueName('Transf E2E');
  await origem.selectOption({ index: 0 });
  await destino.selectOption({ index: 1 });
  await d.getByLabel('Valor').fill('12,34');
  await d.getByLabel('Descrição (opcional)').fill(descricao);
  await d.getByRole('button', { name: 'Transferir' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Transferência registrada.' })).toBeVisible();
  const linha = page.getByRole('row').filter({ hasText: descricao });
  await expect(linha).toContainText('12,34');
  await linha.getByRole('button', { name: /^Estornar a transferência/ }).click();
  const e = page.getByRole('dialog', { name: 'Estornar transferência' });
  await e.getByLabel('Motivo').fill('Teste de estorno');
  await e.getByRole('button', { name: 'Estornar', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: descricao })).toContainText('Estornada');
});
