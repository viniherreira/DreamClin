import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prisma } from '@clinicaiq/db';
import { createPatient, uniqueName } from '../support/helpers';
import { E2E_PROFESSIONAL, E2E_TENANT_SLUG } from '../support/seed';

/** Visualizações da agenda (spec 2026-11-18, F5): lista, selos, filtros lembrados, achar paciente e imprimir. */
const SHOTS = process.env.E2E_SHOTS;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('lista, 1ª vez, lembrar o modo, achar paciente e imprimir', async ({ page, context }) => {
  test.setTimeout(240_000);
  const nome = uniqueName('Visual E2E');
  const patientId = await createPatient(page, nome);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG } });
  const prof = await prisma.professional.findFirstOrThrow({ where: { tenantId: tenant.id, name: E2E_PROFESSIONAL } });
  const date = new Date(Date.now() + (200 + Math.floor(Math.random() * 100)) * 86_400_000).toISOString().slice(0, 10);
  const ag = await prisma.appointment.create({
    data: { tenantId: tenant.id, patientId, professionalId: prof.id, startTime: new Date(`${date}T10:00:00.000Z`), endTime: new Date(`${date}T10:30:00.000Z`) },
  });

  try {
    await page.goto(`/agenda?date=${date}`);
    const lista = page.getByRole('button', { name: 'Visualização em lista' });
    const tem = await lista.waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
    test.skip(!tem, 'Agenda nova desligada neste servidor.');

    // O card mostra "1ª vez" para quem nunca foi atendido.
    await expect(page.getByRole('button', { name: new RegExp(`${nome}.*1ª vez`) })).toBeVisible({ timeout: 60_000 });

    await lista.click();
    const tabela = page.getByRole('table', { name: 'Agendamentos em lista' });
    await expect(tabela.getByRole('row', { name: new RegExp(nome) })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('main').withTags(TAGS).analyze()).violations).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/f5-lista.png`, fullPage: true });

    // Volta a ser lista depois de recarregar (lembrado no navegador).
    await page.reload();
    await expect(page.getByRole('table', { name: 'Agendamentos em lista' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Visualização lado a lado' }).click();

    // Achar o paciente pela barra lateral leva ao dia e abre o agendamento.
    await page.goto('/agenda');
    await page.getByLabel('Achar paciente na agenda').fill(nome);
    await page.getByRole('list', { name: 'Horários encontrados' }).getByRole('button').first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(new RegExp(`date=${date}`));
    await page.keyboard.press('Escape');

    // Imprimir abre a página do dia com o paciente.
    const [popup] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Imprimir a agenda' }).click()]);
    await expect(popup.getByRole('heading', { level: 1, name: /Agenda ·/ })).toBeVisible({ timeout: 60_000 });
    await expect(popup.getByText(nome)).toBeVisible();
    if (SHOTS) await popup.screenshot({ path: `${SHOTS}/f5-imprimir.png`, fullPage: true });
    await popup.close();
  } finally {
    await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id, entity: 'Appointment', entityId: ag.id } });
    await prisma.appointment.deleteMany({ where: { id: ag.id } });
  }
});
