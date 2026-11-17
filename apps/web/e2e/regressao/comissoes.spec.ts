import { test, expect } from '@playwright/test';
import { createPatient, uniqueName } from '../support/helpers';
import { E2E_PROCEDURE, E2E_PROFESSIONAL } from '../support/seed';

/**
 * Financeiro completo, fase 6: a regra de comissão da clínica (10% no
 * particular), um atendimento que gera a comissão, e a conferência que aprova
 * e fatura a conta a pagar. Só roda com o financeiro novo ligado.
 */

function diaLivre() {
  const d = new Date();
  d.setDate(d.getDate() + 30 + Math.floor(Math.random() * 300));
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hora: `${pad(8 + Math.floor(Math.random() * 10))}:${Math.random() < 0.5 ? '00' : '30'}` };
}

test('regra de 10%, atendimento gera a comissão, aprova e fatura', async ({ page }) => {
  // Fluxo longo: passa por Configurações, pacientes, agenda e comissões.
  test.setTimeout(240_000);
  await page.goto('/financeiro/comissoes');
  await page.waitForLoadState('networkidle');
  test.skip(!/\/financeiro\/comissoes/.test(page.url()), 'Financeiro completo desligado neste ambiente.');

  // Regra da clínica: 10% no particular, no atendimento.
  await page.goto('/configuracoes#fin-comissoes');
  const regra = page.getByRole('region', { name: 'Regra da clínica' });
  await expect(regra).toBeVisible();
  await regra.getByLabel('Particular: tipo').selectOption('PERCENT');
  await regra.getByLabel('Particular: porcentagem').fill('10');
  await regra.getByLabel('Quando a comissão nasce').selectOption('EXECUTION');
  await regra.getByRole('button', { name: 'Salvar regras' }).click();
  await expect(regra.getByText('Regras salvas.')).toBeVisible();

  // Um atendimento de R$ 150.
  const nome = uniqueName('Paciente Comissão E2E');
  await createPatient(page, nome);
  const { date, hora } = diaLivre();
  await page.goto(`/agenda?date=${date}`);
  await page.getByRole('button', { name: 'Novo agendamento (N)' }).click();
  const modal = page.getByRole('dialog', { name: 'Novo agendamento' });
  await modal.getByLabel(/^Data/).fill(date);
  await modal.getByLabel(/^Início/).fill(hora);
  await modal.getByRole('combobox', { name: /Profissional/ }).click();
  await page.getByRole('option', { name: E2E_PROFESSIONAL }).click();
  await modal.getByRole('combobox', { name: /Buscar paciente/ }).fill(nome);
  await page.getByRole('option', { name: new RegExp(nome) }).click();
  const adicionar = modal.getByLabel('Adicionar procedimento');
  await adicionar.selectOption((await adicionar.locator('option', { hasText: E2E_PROCEDURE }).first().getAttribute('value'))!);
  await modal.getByRole('checkbox', { name: 'Enviar confirmação por WhatsApp' }).uncheck();
  await modal.getByRole('button', { name: 'Agendar' }).click();
  await expect(modal).toBeHidden();
  await page.getByRole('button', { name: new RegExp(`${nome}.*financeiro`) }).click();
  const detalhes = page.getByRole('dialog', { name: 'Detalhes do agendamento' });
  for (const passo of [/^Paciente chegou/, /^Iniciar atendimento/, /^Finalizar atendimento/]) await detalhes.getByRole('button', { name: passo }).first().click();
  await expect(detalhes.getByText(/para receber/)).toBeVisible();
  await detalhes.getByRole('button', { name: 'Fechar' }).first().click();

  // Conferência: a linha aparece pendente (o % do cadastro do profissional, se houver, vale antes da regra da clínica).
  await page.goto('/financeiro/comissoes');
  await page.getByLabel('De', { exact: true }).fill(date);
  await page.getByLabel('Até', { exact: true }).fill(date);
  const linha = page.getByRole('row').filter({ hasText: nome });
  await expect(linha).toContainText(/cadastro do profissional|regra da clínica/);
  await expect(linha).toContainText('Pendente');
  await linha.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Aprovar' }).click();
  await expect(page.getByRole('row').filter({ hasText: nome })).toContainText('Aprovada');
  await page.getByRole('row').filter({ hasText: nome }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Faturar', exact: true }).click();
  const fat = page.getByRole('dialog', { name: 'Faturar comissões' });
  await fat.getByRole('button', { name: /^Faturar R\$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /Conta a pagar de R\$/ })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: nome })).toContainText('Faturada');
});
