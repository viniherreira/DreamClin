import { test, expect } from '@playwright/test';
import { uniqueName } from '../support/helpers';
import { E2E_BANK_ACCOUNT } from '../support/seed';

/**
 * Financeiro completo, fase 7: importar um extrato OFX no banco de teste,
 * lançar a tarifa que faltava e descartar uma linha; e abrir a conciliação de
 * cartões. Só roda com o financeiro novo ligado.
 */

test('extrato OFX: importa, lança a tarifa, descarta e desfaz', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/financeiro/conciliacao/bancos');
  await page.waitForLoadState('networkidle');
  test.skip(!/\/financeiro\/conciliacao\/bancos/.test(page.url()), 'Financeiro completo desligado neste ambiente.');

  await page.getByRole('button', { name: new RegExp(`^${E2E_BANK_ACCOUNT}`) }).click();
  const marca = uniqueName('Tarifa E2E').replace(/\s/g, '-');
  const hoje = new Date();
  const d = `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}${String(hoje.getDate()).padStart(2, '0')}`;
  const ofx = `<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>${d}<TRNAMT>-7.77<FITID>${marca}-1<MEMO>${marca} tarifa</STMTTRN>
<STMTTRN><DTPOSTED>${d}<TRNAMT>-1.11<FITID>${marca}-2<MEMO>${marca} descartar</STMTTRN>
</BANKTRANLIST></OFX>`;
  await page.locator('#extrato-arquivo').setInputFiles({ name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(ofx) });
  await expect(page.getByRole('status').filter({ hasText: /2 linha\(s\) importada\(s\)/ })).toBeVisible();

  const tarifa = page.getByRole('listitem').filter({ hasText: `${marca} tarifa` });
  await tarifa.getByRole('button', { name: /^Lançar movimento/ }).click();
  const lancar = page.getByRole('dialog', { name: 'Lançar saída' });
  await lancar.getByRole('button', { name: 'Lançar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Movimento lançado e conciliado.' })).toBeVisible();

  const descartar = page.getByRole('listitem').filter({ hasText: `${marca} descartar` });
  await descartar.getByRole('button', { name: /^Descartar/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: `${marca} descartar` })).toHaveCount(0);

  // Desfazer: com as resolvidas na tela, a linha descartada volta a pendente.
  await page.getByLabel('Mostrar as resolvidas').check();
  await page.getByRole('listitem').filter({ hasText: `${marca} descartar` }).getByRole('button', { name: /^Desfazer/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /voltou a ficar pendente/ })).toBeVisible();

  // Re-importar o mesmo arquivo não duplica.
  await page.locator('#extrato-arquivo').setInputFiles({ name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(ofx) });
  await expect(page.getByRole('status').filter({ hasText: /0 linha\(s\) importada\(s\), 2 já estavam no sistema/ })).toBeVisible();

  await page.goto('/financeiro/conciliacao/cartoes');
  await expect(page.getByRole('table', { name: 'Recebíveis de cartão e cheques' })).toBeVisible();
});
