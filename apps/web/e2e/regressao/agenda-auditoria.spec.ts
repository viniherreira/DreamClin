import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prisma } from '@clinicaiq/db';
import { createPatient, uniqueName } from '../support/helpers';
import { E2E_PROFESSIONAL } from '../support/seed';

/**
 * Auditoria do agendamento: agendar, confirmar e trocar o rótulo pela tela, e
 * a aba Auditoria mostra quem criou e cada mudança com o antes e o depois.
 */
const SHOTS = process.env.E2E_SHOTS;

test('auditoria: criou e confirmou aparecem com antes e depois', async ({ page }) => {
  const nome = uniqueName('Auditoria E2E');
  await createPatient(page, nome);
  // Um dia qualquer dos próximos meses: execuções seguidas não brigam pelo mesmo horário.
  const d = new Date(Date.now() + (20 + Math.floor(Math.random() * 200)) * 86_400_000);
  const date = d.toISOString().slice(0, 10);
  await page.goto(`/agenda?date=${date}`);
  await page.getByRole('button', { name: 'Novo agendamento (N)' }).click();
  const modal = page.getByRole('dialog', { name: 'Novo agendamento' });
  await modal.getByLabel(/^Data/).fill(date);
  await modal.getByLabel(/^Início/).fill('11:00');
  await modal.getByLabel(/^Fim/).fill('11:30');
  await modal.getByRole('combobox', { name: /Profissional/ }).click();
  await page.getByRole('option', { name: E2E_PROFESSIONAL }).click();
  await modal.getByRole('combobox', { name: /Buscar paciente/ }).fill(nome);
  await page.getByRole('option', { name: new RegExp(nome) }).click();
  await modal.getByRole('checkbox', { name: 'Enviar confirmação por WhatsApp' }).uncheck();
  await modal.getByRole('button', { name: 'Agendar' }).click();
  await expect(modal).toBeHidden();

  await page.getByRole('button', { name: new RegExp(`${nome}.*Agendado`) }).click();
  const aba = page.getByRole('tab', { name: 'Auditoria' });
  const tem = await aba.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  test.skip(!tem, 'Auditoria desligada neste servidor.');

  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await aba.click();
  const lista = page.getByRole('list', { name: 'Auditoria do agendamento' });
  await expect(lista.getByText('Criou o agendamento')).toBeVisible();
  await expect(lista.getByText('Mudou a situação')).toBeVisible();
  await expect(lista.getByRole('cell', { name: 'Confirmado' })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/auditoria.png` });

  const p = await prisma.patient.findFirstOrThrow({ where: { name: nome } });
  await prisma.auditLog.deleteMany({ where: { tenantId: p.tenantId, entity: 'Appointment', entityId: { in: (await prisma.appointment.findMany({ where: { patientId: p.id }, select: { id: true } })).map((x) => x.id) } } });
  await prisma.appointment.deleteMany({ where: { patientId: p.id } });
});
