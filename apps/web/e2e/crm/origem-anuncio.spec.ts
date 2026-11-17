import { test, expect } from '@playwright/test';
import { prisma } from '@clinicaiq/db';
import { E2E_TENANT_SLUG } from '../support/seed';
import { createLeadViaModal } from './helpers';

/**
 * A origem pelo anúncio: o card mostra de qual anúncio veio e o assunto, a
 * ficha do lead mostra campanha e anúncio, o funil filtra por anúncio, e na
 * tela Anúncios o gestor troca o assunto. O anúncio entra direto no banco
 * (como a Meta mandaria junto com a primeira mensagem).
 */

test('lead de anúncio: card, ficha, filtro e assunto na tela Anúncios', async ({ page }) => {
  test.setTimeout(180_000);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_TENANT_SLUG }, select: { id: true } });
  const adId = `1202${Date.now()}`.slice(0, 18);
  const anuncio = `Vídeo depoimento ${adId.slice(-6)}`;
  const { title } = await createLeadViaModal(page);
  const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: tenant.id, title }, select: { id: true } });
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      source: 'INSTAGRAM',
      originAt: new Date(),
      originAdId: adId,
      originCampaignId: '120200000000999',
      originCampaignName: '[Leads] Implante novembro',
      originAdName: anuncio,
      originHeadline: 'Sorria de novo em 1 dia',
      originTopic: 'Implante',
    },
  });

  try {
    // Card no funil, filtrado pelo anúncio.
    await page.goto(`/crm?anuncio=${adId}`);
    await page.waitForLoadState('networkidle');
    const card = page.getByRole('region', { name: 'Novo' }).getByRole('article').filter({ hasText: title });
    await expect(card).toContainText('Implante · Instagram');

    // Ficha do lead.
    await card.getByRole('link', { name: title, exact: true }).click();
    await expect(page.getByText('Campanha: [Leads] Implante novembro')).toBeVisible();
    await expect(page.getByText(`Anúncio: ${anuncio}`)).toBeVisible();

    // Tela Anúncios: o gestor troca o assunto, e o card acompanha.
    await page.goto('/crm/anuncios');
    const painel = page.getByRole('region', { name: 'Assunto de cada anúncio' });
    const linha = painel.getByRole('listitem').filter({ hasText: anuncio });
    await expect(linha).toContainText('Implante');
    await linha.getByRole('button', { name: 'Trocar assunto' }).click();
    await linha.getByLabel('Assunto').fill('Carga imediata');
    await linha.getByRole('button', { name: 'Salvar neste anúncio' }).click();
    await expect(linha).toContainText('Salvo. 1 lead(s) atualizado(s).');
    await expect(linha).toContainText('escolhido para este anúncio');

    await page.goto(`/crm?assunto=${encodeURIComponent('Carga imediata')}`);
    await expect(page.getByRole('region', { name: 'Novo' }).getByRole('article').filter({ hasText: title })).toContainText('Carga imediata');
  } finally {
    // Some com o assunto escolhido e com a origem do lead de teste (não fica na tela Anúncios das próximas rodadas).
    await prisma.adTopic.deleteMany({ where: { tenantId: tenant.id, externalId: adId } });
    await prisma.lead.update({ where: { id: lead.id }, data: { originAt: null, originAdId: null, originCampaignId: null, originCampaignName: null, originAdName: null, originHeadline: null, originTopic: null } });
  }
});
