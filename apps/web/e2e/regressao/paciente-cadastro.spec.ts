import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prisma } from '@clinicaiq/db';
import { uniqueName } from '../support/helpers';
import { E2E_TENANT_SLUG } from '../support/seed';

/**
 * Cadastro completo do paciente (spec 2026-11-18, F1). Só roda com a bandeira
 * ligada no servidor (PACIENTE_AGENDA=todos em `.env.development.local`):
 * CPF primeiro, formulário em abas, nome social na lista e Ctrl+K.
 */
const SHOTS = process.env.E2E_SHOTS;
const axe = (page: import('@playwright/test').Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

test('paciente: CPF primeiro, abas, lista com filtros e busca Ctrl+K', async ({ page }) => {
  await page.goto('/pacientes/novo');
  const depois = page.getByRole('button', { name: 'Preencher depois' });
  const antigo = page.getByLabel('Telefone principal');
  await depois.or(antigo).first().waitFor();
  test.skip(!(await depois.isVisible()), 'Cadastro completo desligado neste servidor.');

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG } });
  const civil = uniqueName('Jose Civil E2E');
  const social = uniqueName('Maria Social E2E');

  // CPF inválido avisa; "Preencher depois" segue.
  await page.getByLabel('CPF').fill('111.111.111-11');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('CPF inválido. Confira os números.')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f1-cpf.png` });
  await depois.click();

  await expect(page.getByRole('tab', { name: 'Dados do paciente' })).toHaveAttribute('aria-selected', 'true');
  expect((await axe(page)).violations).toEqual([]);
  await page.getByLabel('Nome completo').fill(civil);
  await page.getByLabel('Nome social').fill(social);
  await page.getByLabel('Celular (WhatsApp)').fill('11987654321');
  // Salvar sem nascimento: o erro aparece no campo.
  await page.getByRole('checkbox', { name: /autoriza guardar e usar/ }).check();
  await page.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(page.getByText('Informe a data de nascimento')).toBeVisible();
  await page.getByLabel('Data de nascimento').fill('1988-03-02');

  await page.getByRole('tab', { name: 'Comercial e financeiro' }).click();
  await page.getByRole('button', { name: 'Adicionar convênio' }).click();
  await page.getByRole('tab', { name: 'Dados complementares' }).click();
  await page.getByRole('checkbox', { name: 'Tem atendimento prioritário' }).check();
  await page.getByLabel('Motivo').selectOption({ label: 'Gestante' });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f1-form.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Marketing' }).click();
  await page.getByLabel('Origem do paciente').selectOption({ label: 'Instagram' });
  await page.getByRole('button', { name: 'Cadastrar paciente' }).click();

  await page.waitForURL(/\/pacientes\/(?!novo)[^/]+$/);
  const id = page.url().split('/').pop()!;
  const salvo = await prisma.patient.findUniqueOrThrow({ where: { id }, include: { origin: true } });
  expect(salvo.tenantId).toBe(tenant.id);
  expect(salvo.name).toBe(civil);
  expect(salvo.socialName).toBe(social);
  expect(salvo.priorityType).toBe('GESTANTE');
  expect(salvo.origin?.name).toBe('Instagram');

  // Lista: o nome social aparece, e o filtro de prioritários acha.
  await page.goto(`/pacientes?prioritario=1&q=${encodeURIComponent(social.split(' ').slice(0, 2).join(' '))}`);
  await expect(page.getByRole('link', { name: new RegExp(social) }).first()).toBeVisible();
  expect((await axe(page)).violations).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f1-lista.png`, fullPage: true });

  // Ctrl+K acha pelo nome social.
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Buscar paciente' });
  await dialog.getByRole('combobox').fill(social.split(' ').slice(0, 2).join(' '));
  await expect(dialog.getByRole('option', { name: new RegExp(social) })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f1-ctrlk.png` });
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`/pacientes/${id}$`));

  await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id, entityId: id } });
  await prisma.patientInsurance.deleteMany({ where: { tenantId: tenant.id, patientId: id } });
  await prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });
});

test('configurações: campos do cadastro, informações adicionais e origens', async ({ page }) => {
  await page.goto('/configuracoes#pac-adicionais');
  const painel = page.getByRole('region', { name: 'Informações adicionais' });
  const tem = await painel.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  test.skip(!tem, 'Cadastro completo desligado neste servidor.');
  const rotulo = uniqueName('Usa aparelho E2E');
  await painel.getByRole('button', { name: 'Novo campo' }).click();
  await painel.getByLabel('Nome do campo').fill(rotulo);
  await painel.getByLabel('Tipo').selectOption('SINGLE');
  await painel.getByLabel('Opções (uma por linha)').fill('Sim\nNão');
  await painel.getByRole('checkbox', { name: 'Destacar a resposta' }).check();
  await painel.getByRole('button', { name: 'Pré-visualizar' }).click();
  await expect(painel.getByLabel('Pré-visualização')).toContainText(rotulo);
  expect((await axe(page)).violations).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f1-config.png`, fullPage: true });
  await painel.getByRole('button', { name: 'Salvar campo' }).click();
  await expect(painel.getByText(rotulo)).toBeVisible();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG } });
  await prisma.patientCustomField.deleteMany({ where: { tenantId: tenant.id, label: rotulo } });
});
