import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prisma } from '@clinicaiq/db';
import { E2E_PROFESSIONAL, E2E_TENANT_SLUG } from '../support/seed';

/** Escalas (spec 2026-11-18, F7): nova regra, choque com "substituir" e folga. */
const SHOTS = process.env.E2E_SHOTS;

test('escala: criar, choque com substituir e folga', async ({ page }) => {
  test.setTimeout(240_000);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG } });
  const prof = await prisma.professional.findFirstOrThrow({ where: { tenantId: tenant.id, name: E2E_PROFESSIONAL } });
  // Começa limpo: este teste mexe só nas escalas da profissional de teste.
  await prisma.scheduleRule.deleteMany({ where: { tenantId: tenant.id, professionalId: prof.id } });
  await prisma.scheduleException.deleteMany({ where: { tenantId: tenant.id, professionalId: prof.id } });

  try {
    await page.goto('/configuracoes#escalas');
    // A moldura de Configurações também se chama "Escalas": o painel é o de dentro.
    const painel = page.getByRole('region', { name: 'Escalas' }).last();
    const tem = await painel.waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
    test.skip(!tem, 'Agenda nova desligada neste servidor.');
    await painel.getByLabel('Profissional').selectOption(prof.id);

    await painel.getByRole('button', { name: 'Nova regra' }).click();
    await painel.getByLabel('Vale a partir de').fill('2031-01-06');
    await painel.getByRole('button', { name: 'Salvar regra' }).click();
    await expect(painel.getByText(/Seg, Ter, Qua, Qui, Sex · 08:00–12:00 e 14:00–18:00 · a partir de 06\/01\/2031/)).toBeVisible({ timeout: 60_000 });

    // Uma segunda regra que se choca: pergunta e substitui.
    await painel.getByRole('button', { name: 'Nova regra' }).click();
    await painel.getByLabel('Vale a partir de').fill('2031-02-03');
    await painel.getByLabel('1º período: início').fill('07:00');
    await painel.getByRole('button', { name: 'Salvar regra' }).click();
    await expect(painel.getByRole('alert')).toContainText('se choca');
    expect((await new AxeBuilder({ page }).include('[aria-labelledby]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/f7-choque.png`, fullPage: true });
    await painel.getByRole('button', { name: 'Substituir a antiga' }).click();
    await expect(painel.getByText(/de 06\/01\/2031 a 02\/02\/2031/)).toBeVisible({ timeout: 60_000 });

    // Folga.
    await painel.getByLabel('Dia', { exact: true }).fill('2031-02-10');
    await painel.getByLabel('Motivo (opcional)').fill('Congresso');
    await painel.getByRole('button', { name: 'Marcar' }).click();
    await expect(painel.getByText(/Folga · Congresso/)).toBeVisible({ timeout: 60_000 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/f7-escalas.png`, fullPage: true });

    expect(await prisma.scheduleRule.count({ where: { tenantId: tenant.id, professionalId: prof.id, active: true } })).toBe(2);
  } finally {
    await prisma.scheduleRule.deleteMany({ where: { tenantId: tenant.id, professionalId: prof.id } });
    await prisma.scheduleException.deleteMany({ where: { tenantId: tenant.id, professionalId: prof.id } });
  }
});
