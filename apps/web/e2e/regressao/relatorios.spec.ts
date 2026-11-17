import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Financeiro completo, fase 8: a visão geral nova, a DRE (com o detalhe de uma
 * linha), o fluxo de caixa exportando XLSX e a inadimplência. Só roda com o
 * financeiro novo ligado.
 */

test('visão geral, DRE com detalhe, fluxo de caixa em XLSX e inadimplência', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/financeiro');
  await page.waitForLoadState('networkidle');
  const novo = await page.getByRole('heading', { level: 1, name: 'Visão geral' }).isVisible();
  test.skip(!novo, 'Financeiro completo desligado neste ambiente.');

  // Visão geral: os cartões e o gráfico dos 12 meses.
  await expect(page.getByText('Recebido no período')).toBeVisible();
  await expect(page.getByRole('img', { name: /Receitas × despesas/ })).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar valores' }).click();
  await expect(page.getByText('Saldo das contas')).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);

  // DRE: estrutura e, se houver receita no período, o detalhe da linha.
  await page.goto('/financeiro/relatorios/dre');
  const dre = page.getByRole('table');
  await expect(dre.getByText('(+) Receita bruta')).toBeVisible();
  await expect(dre.getByText('(=) Resultado líquido do período')).toBeVisible();
  const receita = dre.getByRole('button', { name: '(+) Receita bruta' });
  if (await receita.isVisible()) {
    await receita.click();
    await expect(page.getByRole('dialog', { name: 'Receita bruta' }).getByRole('table')).toBeVisible();
    await page.keyboard.press('Escape');
  }

  // Fluxo de caixa: exporta a planilha.
  await page.goto('/financeiro/relatorios/fluxo-de-caixa');
  await expect(page.getByText('Saldo inicial')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar XLSX' }).click();
  expect((await download).suggestedFilename()).toMatch(/^fluxo-de-caixa-.*\.xlsx$/);

  // Inadimplência abre.
  await page.goto('/financeiro/relatorios/inadimplencia');
  await expect(page.getByText('Total vencido')).toBeVisible();
});
