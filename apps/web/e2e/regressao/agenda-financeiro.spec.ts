import { test, expect } from '@playwright/test';
import { createPatient, uniqueName } from '../support/helpers';
import { E2E_PROCEDURE, E2E_PROFESSIONAL } from '../support/seed';

/**
 * O pedido do financeiro, na agenda (fase 4): agendar com procedimentos e
 * valores, atender, receber no PIX e no cartão em 3x direto do agendamento e
 * baixar o recibo. O cifrão do card acompanha.
 *
 * Só roda com o financeiro novo ligado (ver e2e/README.md).
 */

/** Um dia e hora livres: cada execução usa um dia diferente no futuro. */
function diaLivre() {
  const d = new Date();
  d.setDate(d.getDate() + 30 + Math.floor(Math.random() * 300));
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hora: `${pad(8 + Math.floor(Math.random() * 10))}:${Math.random() < 0.5 ? '00' : '30'}` };
}

test('agenda com valor, atende e recebe no PIX e no cartão em 3x, com recibo', async ({ page }) => {
  await page.goto('/financeiro/a-faturar');
  await page.waitForLoadState('networkidle');
  test.skip(!/\/financeiro\/a-faturar/.test(page.url()), 'Financeiro completo desligado neste ambiente.');
  await expect(page.getByRole('heading', { level: 1, name: 'A faturar' })).toBeVisible();

  const patientName = uniqueName('Paciente Agenda Fin E2E');
  await createPatient(page, patientName);
  const { date, hora } = diaLivre();
  await page.goto(`/agenda?date=${date}`);
  await page.getByRole('button', { name: 'Novo agendamento (N)' }).click();
  const modal = page.getByRole('dialog', { name: 'Novo agendamento' });
  await modal.getByLabel(/^Data/).fill(date);
  await modal.getByLabel(/^Início/).fill(hora);
  await modal.getByRole('combobox', { name: /Profissional/ }).click();
  await page.getByRole('option', { name: E2E_PROFESSIONAL }).click();
  await modal.getByRole('combobox', { name: /Buscar paciente/ }).fill(patientName);
  await page.getByRole('option', { name: new RegExp(patientName) }).click();

  // Procedimentos e valores: 2 avaliações de R$ 150 = R$ 300.
  const adicionar = modal.getByLabel('Adicionar procedimento');
  await adicionar.selectOption((await adicionar.locator('option', { hasText: E2E_PROCEDURE }).first().getAttribute('value'))!);
  const item = modal.getByRole('list', { name: 'Procedimentos do agendamento' }).getByRole('listitem').first();
  await item.getByRole('spinbutton', { name: 'Quantidade' }).fill('2');
  await expect(modal.getByText('Valor para o paciente')).toBeVisible();
  await expect(modal.getByText(/R\$\s?300,00/).last()).toBeVisible();
  await modal.getByRole('checkbox', { name: 'Enviar confirmação por WhatsApp' }).uncheck();
  await modal.getByRole('button', { name: 'Agendar' }).click();
  await expect(modal).toBeHidden();

  // O card mostra a situação financeira.
  const card = page.getByRole('button', { name: new RegExp(`${patientName}.*financeiro: A receber`) });
  await expect(card).toBeVisible();

  // Atende: chegou, inicia e finaliza; ao finalizar, sugere receber.
  await card.click();
  const detalhes = page.getByRole('dialog', { name: 'Detalhes do agendamento' });
  for (const passo of [/^Paciente chegou/, /^Iniciar atendimento/, /^Finalizar atendimento/]) await detalhes.getByRole('button', { name: passo }).first().click();
  await expect(detalhes.getByText(/Ficaram R\$\s?300,00 para receber/)).toBeVisible();
  await detalhes.getByRole('button', { name: 'Receber agora' }).click();

  const receber = page.getByRole('dialog', { name: /^Receber · conta nº/ });
  await receber.getByLabel('Forma').selectOption({ label: 'PIX' });
  await receber.getByLabel('Valor', { exact: true }).fill('100,00');
  await receber.getByRole('button', { name: 'Adicionar outro meio' }).click();
  const cartao = receber.getByRole('group', { name: 'Meio 2' });
  await cartao.getByLabel('Forma').selectOption({ label: 'Cartão de crédito' });
  await cartao.getByLabel('Valor', { exact: true }).fill('200,00');
  await cartao.getByLabel('Parcelas').selectOption('3');
  await receber.getByRole('button', { name: /^Receber R\$\s?300,00/ }).click();

  const feito = page.getByRole('dialog', { name: 'Recebimento registrado' });
  await expect(feito.getByText('Conta quitada.')).toBeVisible();
  const href = await feito.getByRole('link', { name: 'Recibo A4' }).getAttribute('href');
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  await feito.getByRole('button', { name: 'Fechar' }).first().click();

  // A aba Financeiro do agendamento mostra "Pago" e os dois pagamentos.
  await expect(detalhes.getByText('Pago', { exact: true })).toBeVisible();
  await expect(detalhes.getByRole('region', { name: 'Pagamentos deste agendamento' }).getByRole('listitem')).toHaveCount(2);
  await detalhes.getByRole('button', { name: 'Fechar' }).first().click();
  await expect(page.getByRole('button', { name: new RegExp(`${patientName}.*financeiro: Pago`) })).toBeVisible();
});
