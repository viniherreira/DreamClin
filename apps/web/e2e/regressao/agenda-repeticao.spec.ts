import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prisma } from '@clinicaiq/db';
import { createPatient, uniqueName } from '../support/helpers';
import { E2E_PROFESSIONAL, E2E_TENANT_SLUG } from '../support/seed';

/** Janela de agendar com tipo de atendimento e repetição (spec 2026-11-18, F4). */
const SHOTS = process.env.E2E_SHOTS;

test('agendar com tipo de atendimento e repetição semanal', async ({ page }) => {
  test.setTimeout(240_000);
  const nome = uniqueName('Repeticao E2E');
  const patientId = await createPatient(page, nome);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG } });
  const tipo = await prisma.careType.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Avaliação E2E' } },
    update: { active: true, durationMinutes: 45 },
    create: { tenantId: tenant.id, name: 'Avaliação E2E', durationMinutes: 45 },
  });
  const dia = new Date(Date.now() + (40 + Math.floor(Math.random() * 150)) * 86_400_000);
  const date = dia.toISOString().slice(0, 10);

  await page.goto(`/agenda?date=${date}`);
  await page.getByRole('button', { name: 'Novo agendamento (N)' }).click();
  const modal = page.getByRole('dialog', { name: 'Novo agendamento' });
  const campo = modal.getByLabel('Tipo de atendimento');
  const tem = await campo.waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
  test.skip(!tem, 'Agenda nova desligada neste servidor.');

  await modal.getByLabel(/^Data/).fill(date);
  await modal.getByLabel(/^Início/).fill('08:00');
  await campo.selectOption(tipo.id);
  await expect(modal.getByLabel(/^Fim/)).toHaveValue('08:45');
  await modal.getByRole('combobox', { name: /Profissional/ }).click();
  await page.getByRole('option', { name: E2E_PROFESSIONAL }).click();
  await modal.getByRole('combobox', { name: /Buscar paciente/ }).fill(nome);
  await page.getByRole('option', { name: new RegExp(nome) }).click();
  await modal.getByLabel('Repetir').selectOption('weekly');
  await modal.getByLabel('Quantas vezes').fill('3');
  await modal.getByRole('button', { name: 'Ver as datas' }).click();
  await expect(modal.getByRole('list', { name: 'Datas da repetição' }).getByRole('listitem')).toHaveCount(3);
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f4-repeticao.png`, fullPage: true });
  await modal.getByRole('checkbox', { name: 'Enviar confirmação por WhatsApp' }).uncheck();
  await modal.getByRole('button', { name: 'Agendar' }).click();
  await expect(modal).toBeHidden();

  const criados = await prisma.appointment.findMany({ where: { patientId } });
  expect(criados).toHaveLength(3);
  expect(criados.every((c) => c.careTypeId === tipo.id)).toBe(true);
  await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id, entity: 'Appointment', entityId: { in: criados.map((c) => c.id) } } });
  await prisma.patientEvent.deleteMany({ where: { tenantId: tenant.id, patientId } });
  await prisma.appointment.deleteMany({ where: { patientId } });
});
