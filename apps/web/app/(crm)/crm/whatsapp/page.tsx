import { requireCrm } from '@/crm/guard';
import { getTenantModules } from '@/lib/access';
import { graphVersion, metaSignupConfigured } from '@/crm/cloud';
import { WhatsAppChannel } from './_components/whatsapp-channel';
import { AdsConnect } from '@/components/ads-connect';
import { adsConnection, adsLoginConfig } from '@/crm/ads-account';
import { readCrmPrefs } from '@/crm/crm-prefs';
import { prisma } from '@clinicaiq/db';
import { GoogleAdsConnect } from '@/components/google-ads-connect';
import { googleAdsConnection } from '@/crm/google-ads-account';
import { googleAdsConfigured } from '@/crm/google-ads-api';
import { googleAdsEnabled } from '@/lib/feature-flags';

export const metadata = { title: 'Canais do CRM' };

/**
 * Canais: o WhatsApp das conversas (API oficial da Meta) com os modelos
 * aprovados, o Gerenciador de Anúncios da Meta e o Google Ads.
 */
export default async function CrmWhatsAppPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCrm('crm_config');
  const sp = await searchParams;
  const google = await googleAdsEnabled(ctx.tenantId);
  const googleConexao = google ? await googleAdsConnection(ctx.tenantId) : null;
  const voltaGoogle = typeof sp.google === 'string' ? { code: sp.google.slice(0, 40), reason: typeof sp.motivo === 'string' ? sp.motivo.slice(0, 200) : undefined } : null;
  const [account, templates, modules, anuncios, tenant] = await Promise.all([
    ctx.db.whatsAppCloudAccount.findFirst({
      select: {
        displayPhone: true,
        verifiedName: true,
        coexistence: true,
        manual: true,
        active: true,
        status: true,
        lastError: true,
        connectedAt: true,
      },
    }),
    ctx.db.messageTemplate.findMany({
      // Os avisos da agenda (purpose) são cuidados no painel de mensagens da gestão.
      where: { purpose: null },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, category: true, status: true, body: true, rejectedReason: true },
    }),
    getTenantModules(ctx.tenantId),
    adsConnection(ctx.tenantId),
    prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Canais do CRM</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {google
          ? 'Conecte o que a clínica usa: o WhatsApp por onde as conversas entram e saem, o Gerenciador de Anúncios da Meta e o Google Ads.'
          : 'O WhatsApp por onde as conversas entram e saem, os modelos aprovados pela Meta e o Gerenciador de Anúncios.'}
      </p>
      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">WhatsApp · API oficial</h2>
      <WhatsAppChannel
        account={account ? { ...account, connectedAt: account.connectedAt.toISOString() } : null}
        templates={templates}
        agenda={modules.clinic}
        signup={
          metaSignupConfigured()
            ? { appId: process.env.META_APP_ID!, configId: process.env.META_ES_CONFIG_ID!, version: graphVersion() }
            : null
        }
      />
      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anúncios</h2>
      <div className="mt-3">
        <AdsConnect
          connection={{ state: anuncios.state, accountId: anuncios.accountId, accountName: anuncios.accountName, connectedAt: anuncios.connectedAt }}
          login={adsLoginConfig()}
          metaEvents={readCrmPrefs(tenant?.settings).metaEvents}
        />
      </div>
      {googleConexao && (
        <div className="mt-4">
          <GoogleAdsConnect connection={googleConexao} configured={googleAdsConfigured()} result={voltaGoogle} />
        </div>
      )}
    </div>
  );
}
