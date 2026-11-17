import { test, expect } from '@playwright/test';

/**
 * Financeiro completo, fase 9: a régua de cobrança em Configurações. Liga,
 * escolhe os dias, salva e confere que voltou igual. Não manda nada para a
 * Meta (o botão só funciona com o WhatsApp oficial conectado e por clique do
 * dono). Só roda com o financeiro novo ligado.
 */

test('régua de cobrança: liga, escolhe os dias e salva', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/configuracoes#fin-regua');
  await page.waitForLoadState('networkidle');
  const regua = page.getByRole('region', { name: 'Régua de cobrança', exact: true });
  const aberta = await regua.waitFor({ timeout: 20_000 }).then(() => true, () => false);
  test.skip(!aberta, 'Financeiro completo desligado neste ambiente.');

  const ligada = regua.getByRole('switch', { name: 'Régua ligada' });
  if ((await ligada.getAttribute('aria-checked')) !== 'true') await ligada.click();
  await regua.getByLabel('Avisar quantos dias antes').fill('2');
  await regua.getByLabel('Cobrar quantos dias depois').fill('5, 15');
  await regua.getByRole('button', { name: 'Salvar régua' }).click();
  await expect(regua.getByText('Régua salva.')).toBeVisible();

  // Os dois textos aparecem com as variáveis, e um texto sem {valor} é recusado na hora.
  const lembrete = page.getByRole('region', { name: 'Lembrete de vencimento' });
  await expect(lembrete.getByLabel('Texto da mensagem')).toHaveValue(/\{valor\}/);
  await expect(page.getByRole('region', { name: 'Pagamento em atraso' })).toBeVisible();
  await lembrete.getByLabel('Texto da mensagem').fill('Olá, {nome}! Passando para lembrar do vencimento.');
  await expect(lembrete.getByText('Use {valor} e {vencimento} no texto.')).toBeVisible();
  await expect(lembrete.getByRole('button', { name: 'Mandar para a Meta aprovar' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Histórico da régua' })).toBeVisible();

  // Volta igual depois de recarregar; e deixa a régua desligada como estava.
  await page.reload();
  await page.waitForLoadState('networkidle');
  const de = page.getByRole('region', { name: 'Régua de cobrança', exact: true });
  await expect(de.getByLabel('Avisar quantos dias antes')).toHaveValue('2');
  await expect(de.getByLabel('Cobrar quantos dias depois')).toHaveValue('5, 15');
  await expect(de.getByRole('switch', { name: 'Régua ligada' })).toHaveAttribute('aria-checked', 'true');
  await de.getByRole('switch', { name: 'Régua ligada' }).click();
  await de.getByRole('button', { name: 'Salvar régua' }).click();
  await expect(de.getByText('Régua salva.')).toBeVisible();
});
