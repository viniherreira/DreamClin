import { test, expect } from '@playwright/test';
import { prisma } from '@clinicaiq/db';
import { createPatient, uniqueName } from '../support/helpers';
import { E2E_TENANT_SLUG } from '../support/seed';

/** Excluir orçamento: confirma e volta para a lista só quando excluiu. */
test('excluir orçamento', async ({ page }) => {
  test.setTimeout(240_000);
  const patientId = await createPatient(page, uniqueName('Excluir Orc E2E'));
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG } });
  const ultimo = await prisma.quote.aggregate({ where: { tenantId: tenant.id }, _max: { number: true } });
  const q = await prisma.quote.create({
    data: { tenantId: tenant.id, patientId, number: (ultimo._max.number ?? 0) + 1, publicToken: `e2e_${Date.now()}`, subtotal: 100, total: 100, validUntil: new Date('2099-01-01') },
  });
  try {
    await page.goto(`/orcamentos/${q.id}`);
    await page.getByRole('button', { name: 'Excluir orçamento' }).click({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Sim' }).click();
    await expect(page).toHaveURL(/\/orcamentos$/, { timeout: 60_000 });
    expect(await prisma.quote.count({ where: { id: q.id } })).toBe(0);
  } finally {
    await prisma.quote.deleteMany({ where: { id: q.id } });
  }
});
