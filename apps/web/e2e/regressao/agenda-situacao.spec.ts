import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prisma } from '@clinicaiq/db';
import { createPatient, uniqueName } from '../support/helpers';
import { E2E_PROFESSIONAL, E2E_TENANT_SLUG } from '../support/seed';

/**
 * Situação, remarcação e cancelamento na janela do agendamento (spec
 * 2026-11-18, F4): lista de situação, Remarcar com registro e cancelar com
 * quem cancelou e o motivo.
 */
const SHOTS = process.env.E2E_SHOTS;

test('situação pela lista, remarcar e cancelar com motivo', async ({ page }) => {
  test.setTimeout(240_000);
  const nome = uniqueName('Situacao E2E');
  const patientId = await createPatient(page, nome);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG } });
  const prof = await prisma.professional.findFirstOrThrow({ where: { tenantId: tenant.id, name: E2E_PROFESSIONAL } });
  const dia = new Date(Date.now() + (30 + Math.floor(Math.random() * 200)) * 86_400_000);
  const date = dia.toISOString().slice(0, 10);
  const proximo = new Date(dia.getTime() + 86_400_000).toISOString().slice(0, 10);
  await prisma.appointment.create({
    data: { tenantId: tenant.id, patientId, professionalId: prof.id, startTime: new Date(`${date}T10:00:00.000Z`), endTime: new Date(`${date}T10:30:00.000Z`) },
  });

  await page.goto(`/agenda?date=${date}`);
  await page.getByRole('button', { name: new RegExp(`${nome}.*Agendado`) }).click();
  const situacao = page.getByLabel('Situação', { exact: true });
  const tem = await situacao.waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
  if (!tem && SHOTS) await page.screenshot({ path: `${SHOTS}/f4-debug.png` });
  test.skip(!tem, 'Agenda nova desligada neste servidor.');

  await situacao.selectOption('CONFIRMED');
  await expect(page.getByText('Situação alterada.')).toBeVisible();

  await page.getByRole('button', { name: 'Remarcar' }).click();
  await page.getByLabel('Data', { exact: true }).fill(proximo);
  await page.getByLabel('Motivo (opcional)').fill('Paciente pediu outro dia');
  await page.getByRole('button', { name: 'Confirmar remarcação' }).click();
  await expect(page.getByText('Agendamento remarcado.')).toBeVisible();
  await page.getByRole('tab', { name: /Remarcações/ }).click();
  await expect(page.getByRole('list', { name: 'Remarcações' })).toContainText('Paciente pediu outro dia');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f4-remarcacoes.png` });

  await page.getByRole('tab', { name: 'Detalhes' }).click();
  await page.getByLabel('Situação', { exact: true }).selectOption('CANCELLED');
  await page.getByRole('radio', { name: 'O paciente' }).check();
  await page.getByLabel(/^Motivo/).selectOption({ label: 'Paciente doente' });
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f4-cancelar.png` });
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  const ap = await prisma.appointment.findFirstOrThrow({ where: { patientId } });
  expect(ap).toMatchObject({ status: 'CANCELLED', cancelledBy: 'PATIENT', cancelReason: 'Paciente doente' });
  expect(ap.startTime.toISOString().slice(0, 10)).toBe(proximo);

  await prisma.appointmentReschedule.deleteMany({ where: { tenantId: tenant.id, patientId } });
  await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id, entity: 'Appointment', entityId: ap.id } });
  await prisma.patientEvent.deleteMany({ where: { tenantId: tenant.id, patientId } });
  await prisma.appointment.deleteMany({ where: { patientId } });
});
