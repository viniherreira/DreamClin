import { test, expect } from '@playwright/test';
import { prisma } from '@clinicaiq/db';
import { E2E_TENANT_SLUG } from '../support/seed';

/**
 * Cada plano vê só o que comprou: a chave Clínica/CRM só no Completo; só a
 * Agenda não vê nada do CRM; só o CRM não vê nada de "Clínica" (Configurações
 * abre com o menu do CRM). Mexe na assinatura da clínica de teste e devolve.
 */
const SHOTS = process.env.E2E_SHOTS;

test('telas por plano: Completo, só Agenda e só CRM', async ({ page }) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG }, select: { id: true } });
  const antes = await prisma.subscription.findUniqueOrThrow({
    where: { tenantId: tenant.id },
    select: { complimentary: true, clinicEnabled: true, crmEnabled: true },
  });
  const pessoas = await prisma.user.findMany({ where: { tenantId: tenant.id }, select: { id: true, crmSeat: true } });
  const plano = (m: { clinicEnabled: boolean; crmEnabled: boolean }) =>
    prisma.subscription.update({ where: { tenantId: tenant.id }, data: { complimentary: false, ...m } });

  try {
    await prisma.user.updateMany({ where: { tenantId: tenant.id }, data: { crmSeat: true } });
    const chave = page.getByRole('navigation', { name: 'Trocar de módulo' });

    // Completo: a chave aparece na clínica e no CRM.
    await plano({ clinicEnabled: true, crmEnabled: true });
    await page.goto('/dashboard');
    await expect(chave).toBeVisible();
    await page.goto('/crm');
    await expect(chave).toBeVisible();

    // Só a Agenda: nada de CRM, nem a chave nem as caixas de CRM em Configurações.
    await plano({ clinicEnabled: true, crmEnabled: false });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(chave).toHaveCount(0);
    await page.goto('/configuracoes#equipe');
    await expect(page.getByRole('heading', { name: 'Acesso ao CRM' })).toHaveCount(0);
    await page.goto('/configuracoes#plano');
    await expect(page.getByRole('heading', { name: 'CRM', exact: true })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/plano-agenda.png` });

    // Só o CRM: nada de "Clínica"; Configurações abre com o menu do CRM.
    await plano({ clinicEnabled: false, crmEnabled: true });
    await page.goto('/crm');
    await expect(page.getByRole('link', { name: /Funil/ }).first()).toBeVisible();
    await expect(chave).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Clínica', exact: true })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/plano-crm.png` });
    await page.goto('/configuracoes');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(chave).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Funil/ }).first()).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/plano-crm-configuracoes.png` });
  } finally {
    await prisma.subscription.update({ where: { tenantId: tenant.id }, data: antes });
    for (const p of pessoas) await prisma.user.update({ where: { id: p.id }, data: { crmSeat: p.crmSeat } });
  }
});
