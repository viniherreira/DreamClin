import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prisma } from '@clinicaiq/db';
import { createPatient, uniqueName } from '../support/helpers';
import { E2E_TENANT_SLUG } from '../support/seed';

/** Telas de operação da agenda (spec 2026-11-18, F6). */
const SHOTS = process.env.E2E_SHOTS;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('confirmações, horários livres, meu dia e alterações em massa abrem sem erro de acessibilidade', async ({ page }) => {
  test.setTimeout(240_000);
  const r = await page.goto('/agenda/confirmacoes');
  test.skip(r?.status() === 404, 'Agenda nova desligada neste servidor.');
  for (const [url, titulo, shot] of [
    ['/agenda/confirmacoes', 'Confirmações', 'f6-confirmacoes'],
    ['/agenda/horarios-livres', 'Horários livres', 'f6-horarios-livres'],
    ['/agenda/meu-dia', 'Meu dia', 'f6-meu-dia'],
    ['/agenda/alteracoes', 'Alterações em massa', 'f6-alteracoes'],
  ] as const) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible({ timeout: 60_000 });
    expect((await new AxeBuilder({ page }).include('main').withTags([...TAGS]).analyze()).violations).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  }
});

test('horário livre abre o novo agendamento já com a hora', async ({ page }) => {
  test.setTimeout(240_000);
  const r = await page.goto('/agenda/horarios-livres');
  test.skip(r?.status() === 404, 'Agenda nova desligada neste servidor.');
  const horario = page.getByRole('link', { name: /^Agendar .* às \d{2}:\d{2} com / }).first();
  const tem = await horario.waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
  test.skip(!tem, 'Sem horário livre configurado no banco de teste.');
  const hora = (await horario.textContent())!.trim();
  await horario.click();
  const modal = page.getByRole('dialog', { name: 'Novo agendamento' });
  await expect(modal).toBeVisible({ timeout: 60_000 });
  await expect(modal.getByLabel(/^Início/)).toHaveValue(hora);
});

test('colocar e tirar da lista de espera', async ({ page }) => {
  test.setTimeout(240_000);
  const nome = uniqueName('Espera E2E');
  const patientId = await createPatient(page, nome);
  const r = await page.goto('/agenda/lista-de-espera');
  test.skip(r?.status() === 404, 'Agenda nova desligada neste servidor.');
  await page.getByRole('button', { name: 'Colocar na lista' }).click();
  await page.getByLabel('Paciente').fill(nome);
  await page.getByRole('button', { name: new RegExp(nome) }).click();
  await page.getByLabel('Período').selectOption('MORNING');
  await page.getByRole('checkbox', { name: 'Ter' }).check();
  await page.locator('form').getByRole('button', { name: 'Colocar na lista' }).click();
  const linha = page.getByRole('row', { name: new RegExp(nome) });
  await expect(linha).toBeVisible({ timeout: 60_000 });
  await expect(linha).toContainText('Manhã');
  expect((await new AxeBuilder({ page }).include('main').withTags([...TAGS]).analyze()).violations).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f6-lista-de-espera.png`, fullPage: true });
  page.once('dialog', (d) => d.accept('teste'));
  await linha.getByRole('button', { name: 'Remover' }).click();
  await expect(linha).toBeHidden({ timeout: 60_000 });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG } });
  const e = await prisma.waitlistEntry.findFirstOrThrow({ where: { tenantId: tenant.id, patientId } });
  expect(e.status).toBe('REMOVED');
  expect(e.removedReason).toBe('teste');
  await prisma.waitlistEntry.deleteMany({ where: { patientId } });
});
