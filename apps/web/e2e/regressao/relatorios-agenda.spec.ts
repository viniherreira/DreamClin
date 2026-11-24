import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Relatórios da agenda e dos pacientes (spec 2026-11-18, F8). */
const SHOTS = process.env.E2E_SHOTS;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('relatórios da agenda: troca de relatório, filtros e exportação', async ({ page }) => {
  test.setTimeout(240_000);
  const r = await page.goto('/relatorios/agenda');
  test.skip(r?.status() === 404, 'Agenda nova desligada neste servidor.');
  await expect(page.getByRole('heading', { level: 1, name: 'Relatórios da agenda' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 2, name: 'Por situação' })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('main').withTags(TAGS).analyze()).violations).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f8-situacao.png`, fullPage: true });

  const rel = page.getByRole('navigation', { name: 'Relatórios' });
  await rel.getByRole('link', { name: 'Por tipo, sala, procedimento ou convênio' }).click();
  await page.getByLabel('Agrupar por').selectOption('pagamento');
  await page.getByRole('button', { name: 'Mostrar' }).click();
  await expect(page).toHaveURL(/por=pagamento/);

  await rel.getByRole('link', { name: 'Pacientes sem agendar' }).click();
  await expect(page.getByLabel('Sem vir há mais de (dias)')).toBeVisible({ timeout: 60_000 });
  expect((await new AxeBuilder({ page }).include('main').withTags(TAGS).analyze()).violations).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f8-sem-agendar.png`, fullPage: true });

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Excel' }).click();
  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toMatch(/^relatorio-sem-agendar-.*\.xlsx$/);
});
