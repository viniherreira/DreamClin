import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CloudOff, Search, UsersRound } from 'lucide-react';
import { requireCrm } from '@/crm/guard';
import { loadGoogleAdsPage } from '@/crm/google-ads-report';
import { googleAdsConfigured } from '@/crm/google-ads-api';
import { googleAdsEnabled } from '@/lib/feature-flags';
import { asReportPeriod, DEFAULT_REPORT_PERIOD, REPORT_PERIODS } from '@/crm/report-period';
import { ReportFrame } from '../../_components/report/frame';
import { EmptyState } from '../../_components/report/parts';
import { adsTabs } from '../_components/ads-tabs';
import { AdsReportView } from '../_components/report-view';
import { GOOGLE_SOURCE } from '../_components/ad-source';
import { refreshGoogleAdsAction } from '../../whatsapp/google-ads-actions';

export const metadata = { title: 'Anúncios · Google' };

/**
 * Anúncios › Google: o que o Google Ads sabe (investimento, cliques,
 * conversões) no mesmo formato da aba Meta.
 */
export default async function GoogleAdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCrm('crm');
  if (!(await googleAdsEnabled(ctx.tenantId))) notFound();
  const sp = await searchParams;
  const period = asReportPeriod(typeof sp.periodo === 'string' ? sp.periodo : undefined);
  const campanha = typeof sp.campanha === 'string' && /^\d{1,25}$/.test(sp.campanha) ? sp.campanha : null;
  const frame = {
    title: 'Anúncios',
    basePath: '/crm/anuncios/google',
    periods: REPORT_PERIODS,
    period,
    defaultPeriod: DEFAULT_REPORT_PERIOD,
    tabs: adsTabs('google', true),
  };

  if (ctx.ownOnly) {
    return (
      <ReportFrame {...frame}>
        <EmptyState icon={<UsersRound className="h-5 w-5" />} title="Esta tela é para quem vê a clínica inteira">
          <p>Os números dos anúncios somam o investimento e os pacientes de toda a clínica. Peça a um gestor do CRM para ver com você.</p>
        </EmptyState>
      </ReportFrame>
    );
  }

  const data = await loadGoogleAdsPage(ctx.tenantId, period, campanha);
  const conexao = data.connection;
  if (data.state === 'not_connected' || data.state === 'choosing') {
    return (
      <ReportFrame {...frame}>
        <div className="mx-auto grid max-w-4xl gap-5 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <div className="viz-rise space-y-4 py-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
              <Search className="h-5 w-5" />
            </span>
            <h2 className="text-2xl font-semibold tracking-tight">O Google Ads, mastigado, dentro do CRM</h2>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              Conecte a conta do Google Ads da clínica e veja aqui, no mesmo formato da aba Meta:
            </p>
            <ul className="space-y-2 text-sm">
              {['Quanto foi investido, os cliques e as conversões de cada campanha', 'Custo por clique e por conversão, com a comparação com o período anterior', 'Pesquisa, YouTube ou Display, celular ou computador, e a hora que mais rende'].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="viz-card p-5">
            <p className="text-sm font-medium">{conexao.state === 'choosing' ? 'Falta escolher a conta de anúncios' : 'Google Ads ainda não conectado'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {!googleAdsConfigured()
                ? 'A conexão com o Google Ads ainda está sendo liberada. Volte em breve.'
                : ctx.manager
                  ? 'A conexão é feita em Canais, com o e-mail do Google que acessa o Google Ads da clínica. Só leitura.'
                  : 'Peça a um gestor do CRM para conectar o Google Ads em Canais.'}
            </p>
            {ctx.manager && googleAdsConfigured() && (
              <Link href="/crm/whatsapp#google-ads" className="btn-primary btn-md mt-4">
                {conexao.state === 'choosing' ? 'Escolher a conta em Canais' : 'Conectar em Canais'}
              </Link>
            )}
          </div>
        </div>
      </ReportFrame>
    );
  }

  if (data.state === 'error') {
    const reconectar = data.kind === 'auth' || data.kind === 'permission';
    return (
      <ReportFrame {...frame} refresh={refreshGoogleAdsAction}>
        <EmptyState
          icon={<CloudOff className="h-5 w-5" />}
          title={data.kind === 'rate' ? 'O Google pediu uma pausa' : reconectar ? 'A conexão com o Google Ads precisa de atenção' : 'Não deu para buscar os números'}
          action={
            reconectar && ctx.manager ? (
              <Link href="/crm/whatsapp#google-ads" className="btn-primary btn-md">
                Abrir Canais
              </Link>
            ) : undefined
          }
        >
          <p>{data.message}</p>
          {!reconectar && <p>Use o botão Atualizar, ali em cima, para tentar de novo. Nada foi perdido: os números continuam no Google e no CRM.</p>}
          {reconectar && !ctx.manager && <p>Peça a um gestor do CRM para reconectar o Google Ads.</p>}
        </EmptyState>
      </ReportFrame>
    );
  }

  if (data.state !== 'ok') return null;

  return (
    <AdsReportView
      report={data.report}
      breakdowns={data.breakdowns}
      period={period}
      accountName={data.connection.accountName}
      range={data.range}
      fetchedAt={data.fetchedAt}
      tabs={frame.tabs}
      source={GOOGLE_SOURCE}
      refresh={refreshGoogleAdsAction}
    />
  );
}
