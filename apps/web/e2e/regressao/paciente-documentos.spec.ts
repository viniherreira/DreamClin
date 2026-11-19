import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prisma } from '@clinicaiq/db';
import { createPatient, uniqueName } from '../support/helpers';
import { E2E_TENANT_SLUG } from '../support/seed';

/**
 * Documentos (spec 2026-11-18, F3): emitir um termo, imprimir em PDF, pedir a
 * assinatura e assinar pelo link público (sem login), com a comprovação.
 */
const SHOTS = process.env.E2E_SHOTS;
const axe = (page: import('@playwright/test').Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

test('documento: emitir, imprimir, pedir assinatura e assinar pelo link', async ({ page, browser }) => {
  const nome = uniqueName('Docs E2E');
  const id = await createPatient(page, nome);
  const grupos = page.getByRole('navigation', { name: 'Grupos da ficha' });
  const tem = await grupos.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  test.skip(!tem, 'Perfil novo desligado neste servidor.');
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG } });

  await grupos.getByRole('button', { name: /^Documentos/ }).click();
  await page.getByRole('button', { name: 'Novo documento' }).click();
  await page.getByLabel('Tipo').selectOption('CONSENT');
  await page.getByRole('button', { name: 'Continuar' }).click();
  const editor = page.getByRole('textbox', { name: 'Texto do documento' });
  await editor.click();
  await editor.pressSequentially('Autorizo o clareamento dental.');
  await page.getByRole('button', { name: 'Salvar documento' }).click();
  await expect(page.getByText('Termo de consentimento (TCLE) ·')).toBeVisible();
  expect((await axe(page)).violations).toEqual([]);

  const doc = await prisma.patientDocument.findFirstOrThrow({ where: { tenantId: tenant.id, patientId: id } });
  const pdf = await page.request.get(`/pacientes/${id}/documentos/${doc.id}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');

  await page.getByRole('button', { name: 'Pedir assinatura' }).click();
  const link = await page.getByRole('textbox', { name: 'Link' }).first().inputValue();
  expect(link).toMatch(/\/assinar\/[\w-]+$/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f3-docs.png`, fullPage: true });

  // O paciente abre o link num navegador sem login.
  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto(new URL(link).pathname);
  await expect(p.getByText('Autorizo o clareamento dental.')).toBeVisible();
  await p.getByRole('radio', { name: 'Só aceitar' }).check();
  await p.getByRole('checkbox', { name: /Li o documento/ }).check();
  expect((await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/f3-assinar.png`, fullPage: true });
  await p.getByRole('button', { name: 'Assinar documento' }).click();
  await expect(p.getByText(/Documento assinado/)).toBeVisible();
  const assinado = await p.request.get(`${new URL(link).pathname}/pdf`);
  expect(assinado.status()).toBe(200);
  await anon.close();

  const t = { tenantId: tenant.id };
  await prisma.signatureRequest.deleteMany({ where: { ...t, patientId: id } });
  await prisma.patientDocument.deleteMany({ where: { ...t, patientId: id } });
  await prisma.patientFolder.deleteMany({ where: { ...t, patientId: id } });
  await prisma.patientEvent.deleteMany({ where: { ...t, patientId: id } });
  await prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });
});
