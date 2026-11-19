import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prisma } from '@clinicaiq/db';
import { createPatient, uniqueName } from '../support/helpers';
import { E2E_TENANT_SLUG } from '../support/seed';

/**
 * Perfil do paciente (spec 2026-11-18, F2). Só com a bandeira ligada no
 * servidor: grupos de abas, linha do tempo, observação na agenda, plano de
 * tratamento, ficha e cartão em PDF.
 */
const SHOTS = process.env.E2E_SHOTS;
const axe = (page: import('@playwright/test').Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

test('perfil: grupos, linha do tempo, observação, plano, ficha e cartão', async ({ page }) => {
  const nome = uniqueName('Perfil E2E');
  const id = await createPatient(page, nome);
  const grupos = page.getByRole('navigation', { name: 'Grupos da ficha' });
  const tem = await grupos.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  test.skip(!tem, 'Perfil novo desligado neste servidor.');
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG } });

  await expect(page.getByRole('heading', { level: 1, name: nome })).toBeVisible();
  expect((await axe(page)).violations).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f2-visao.png`, fullPage: true });

  // Linha do tempo: o cadastro aparece.
  await grupos.getByRole('button', { name: /Relacionamento/ }).click();
  await expect(page.getByRole('heading', { name: 'Na clínica' })).toBeVisible();
  await expect(page.getByText('Paciente cadastrado').first()).toBeVisible();
  await expect(page).toHaveURL(/aba=linha-do-tempo/);

  // Observação que aparece na agenda.
  await page.getByRole('tab', { name: /Observações/ }).click();
  await page.getByLabel('Nova observação').fill('Prefere horários de manhã');
  await page.getByRole('checkbox', { name: 'Aparece na agenda' }).check();
  await page.getByRole('button', { name: 'Salvar observação' }).click();
  await expect(page.getByRole('list', { name: 'Observações' }).getByText('Prefere horários de manhã')).toBeVisible();
  expect((await axe(page)).violations).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f2-obs.png`, fullPage: true });

  // Plano avulso com um item marcado como feito.
  await grupos.getByRole('button', { name: /Comercial/ }).click();
  await page.getByRole('tab', { name: /Planos de tratamento/ }).click();
  await page.getByLabel('Nome do plano avulso').fill('Clareamento');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: /Clareamento/ })).toBeVisible();
  await page.getByRole('button', { name: 'Item avulso' }).click();
  await page.getByLabel('Descrição do item').fill('Moldeira');
  await page.getByLabel('Valor').fill('150,00');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await page.getByRole('checkbox', { name: 'Feito: Moldeira' }).check();
  await expect(page.getByText('1 de 1 feitos')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f2-plano.png`, fullPage: true });

  // Ficha e cartão em PDF.
  const ficha = await page.request.get(`/pacientes/${id}/ficha?formato=pdf&linhas=5`);
  expect(ficha.status()).toBe(200);
  expect(ficha.headers()['content-type']).toContain('application/pdf');
  const planilha = await page.request.get(`/pacientes/${id}/ficha?formato=xlsx`);
  expect(planilha.status()).toBe(200);
  const cartao = await page.request.get(`/pacientes/${id}/cartao`);
  expect(cartao.status()).toBe(200);
  expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, entityId: id, action: 'PATIENT_SHEET_EXPORTED' } })).toBe(2);

  const t = { tenantId: tenant.id };
  await prisma.treatmentPlanItem.deleteMany({ where: { ...t, plan: { patientId: id } } });
  await prisma.treatmentPlan.deleteMany({ where: { ...t, patientId: id } });
  await prisma.patientNote.deleteMany({ where: { ...t, patientId: id } });
  await prisma.patientEvent.deleteMany({ where: { ...t, patientId: id } });
  await prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });
});
