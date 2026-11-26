import { SearchX } from 'lucide-react';
import type { AdsBreakdowns } from '@/crm/ads-report';
import { ageLabel, BREAKDOWN_METRIC_LABEL, formatCount, formatMoney, formatRate, type AdsReport, type FunnelStep } from '@/crm/ads-rules';
import { chatTime, formatCents } from '@/crm/format';
import { rangeText } from '@/crm/period';
import { DEFAULT_REPORT_PERIOD, PREVIOUS_LABEL, REPORT_PERIODS, type DayRange, type ReportPeriodKey } from '@/crm/report-period';
import { refreshAdsAction } from '../../whatsapp/ads-actions';
import { ColumnChart, StackedCharts } from '../../_components/report/charts';
import { ReportFrame } from '../../_components/report/frame';
import { AgePyramid, BarList, CARD, ChartCard, EmptyState, Legend, SplitBar, StatTile } from '../../_components/report/parts';
import { glow } from '../../_components/report/viz-math';
import { CampaignTable } from './campaign-table';
import { META_SOURCE, type AdSource } from './ad-source';

const META = 'var(--viz-meta)';
const CRM = 'var(--viz-crm)';
const NEUTRO = 'hsl(var(--muted-foreground) / 0.55)';

/** A tela Anúncios com os números: cartões, funil, dia a dia, público e campanhas. */
export function AdsReportView({
  report: r,
  breakdowns: b,
  period,
  accountName,
  range,
  fetchedAt,
  extra,
  tabs,
  source = META_SOURCE,
  refresh = refreshAdsAction,
}: {
  /** Meta ou Google: os nomes e o que cada gerenciador informa. */
  source?: AdSource;
  /** O botão Atualizar (derruba o cache dos números desta fonte). */
  refresh?: () => Promise<{ ok: true } | { ok: false; message: string }>;
  /** O que vem depois dos números (o assunto de cada anúncio). */
  extra?: React.ReactNode;
  /** As abas Meta / Google do topo. */
  tabs?: { href: string; label: string; active: boolean }[];
  report: AdsReport;
  breakdowns: AdsBreakdowns;
  period: ReportPeriodKey;
  accountName: string | null;
  range: Pick<DayRange, 'since' | 'until'>;
  fetchedAt: string;
}) {
  const versus = PREVIOUS_LABEL[period];
  const d = r.delivery;
  const horas = b.hours;
  const publico = b.audience;
  // "conversas" na Meta, "conversões" no Google.
  const unidade = (m: keyof typeof BREAKDOWN_METRIC_LABEL) => (m === 'conversations' ? source.result.many : BREAKDOWN_METRIC_LABEL[m]);
  const unidadePublico = unidade(publico.metric);

  return (
    <ReportFrame
      title="Anúncios"
      basePath={source.basePath}
      periods={REPORT_PERIODS}
      period={period}
      defaultPeriod={DEFAULT_REPORT_PERIOD}
      params={r.campaignId ? { campanha: r.campaignId } : {}}
      select={{ name: 'campanha', label: 'Campanha', all: 'Todas as campanhas', value: r.campaignId ?? '', options: r.campaigns }}
      refresh={refresh}
      updatedAt={`Atualizado às ${chatTime(new Date(fetchedAt))}`}
      tabs={tabs}
    >
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{accountName ?? 'Conta de anúncios'}</span> · {rangeText(range.since, range.until)} · as setas comparam com {versus}
      </p>

      {r.empty ? (
        <EmptyState icon={<SearchX className="h-5 w-5" />} title="Nenhum anúncio rodou neste período">
          <p>A conta não teve investimento nem conversas nestes dias, e nenhum lead de anúncio agendou ou fechou. Escolha um período maior, ali em cima.</p>
        </EmptyState>
      ) : (
        <>
          <section aria-label="Números do período">
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <StatTile
                lead
                className="col-span-2 md:col-span-4 xl:col-span-2"
                index={0}
                label="Investido"
                value={r.kpis.spend.value ?? 0}
                format="money"
                hint={source.spendHint}
                change={r.kpis.spend.change}
                tone={r.kpis.spend.tone}
                versus={versus}
                trend={r.kpis.spend.trend}
                detail={`${formatCount(r.totals.conversations)} ${r.totals.conversations === 1 ? source.result.one : source.result.many} · ${formatCount(r.totals.won)} ${r.totals.won === 1 ? 'paciente' : 'pacientes'}`}
              />
              <StatTile
                index={1}
                label={source.result.costTitle}
                value={r.kpis.costPerConversation.value}
                format="money"
                hint={source.result.costHint}
                change={r.kpis.costPerConversation.change}
                tone={r.kpis.costPerConversation.tone}
                versus={versus}
                trend={r.kpis.costPerConversation.trend}
              />
              <StatTile
                index={2}
                label="Custo por agendamento"
                value={r.kpis.costPerScheduled.value}
                format="money"
                hint="Quanto custou, em média, cada pessoa que veio de anúncio e agendou."
                change={r.kpis.costPerScheduled.change}
                tone={r.kpis.costPerScheduled.tone}
                versus={versus}
                trend={r.kpis.costPerScheduled.trend}
                color={CRM}
              />
              <StatTile
                index={3}
                label="Custo por paciente"
                value={r.kpis.costPerPatient.value}
                format="money"
                hint="Quanto custou, em média, cada pessoa que veio de anúncio e fechou."
                change={r.kpis.costPerPatient.change}
                tone={r.kpis.costPerPatient.tone}
                versus={versus}
                trend={r.kpis.costPerPatient.trend}
                color={CRM}
              />
              <StatTile
                index={4}
                label="Retorno"
                value={source.crm ? r.kpis.roas.value : null}
                format="roas"
                hint="Quanto voltou para cada real investido: o valor dos negócios fechados dividido pelo gasto. 3x quer dizer R$ 3 para cada R$ 1."
                change={r.kpis.roas.change}
                tone={r.kpis.roas.tone}
                versus={versus}
                trend={r.kpis.roas.trend}
                color={CRM}
                detail={source.crm ? `${formatCents(r.totals.revenueCents)} fechados` : undefined}
              />
            </ul>
          </section>

          <section aria-label="Entrega dos anúncios" className={`${CARD} viz-rise`} style={{ ['--i' as string]: 5 }}>
            <dl className="grid grid-cols-2 divide-border/60 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
              {[
                { t: 'Exibições', v: formatCount(d.impressions), n: 'vezes que o anúncio apareceu' },
                ...(source.showReach
                  ? [
                      { t: 'Pessoas alcançadas', v: formatCount(d.reach), n: 'viram pelo menos uma vez' },
                      { t: 'Frequência', v: d.frequency == null ? '–' : `${d.frequency.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x`, n: 'vezes que cada pessoa viu' },
                    ]
                  : [
                      { t: 'Cliques', v: formatCount(d.clicks), n: 'no anúncio' },
                      { t: 'Custo por clique', v: d.clicks > 0 ? formatMoney(Math.round(r.totals.spendCents / d.clicks)) : '–', n: 'CPC médio' },
                    ]),
                { t: 'Custo por mil exibições', v: d.cpmCents == null ? '–' : formatMoney(d.cpmCents), n: 'CPM' },
                { t: 'Taxa de clique', v: d.ctr == null ? '–' : formatRate(d.ctr), n: 'de quem viu, clicou (CTR)' },
                { t: 'Ticket médio', v: d.ticketCents == null ? '–' : formatCents(d.ticketCents), n: 'por paciente de anúncio' },
              ].map((m) => (
                <div key={m.t} className="px-4 py-3.5">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{m.t}</dt>
                  <dd className="viz-num mt-1 text-lg leading-none">{m.v}</dd>
                  <dd className="mt-1 text-[11px] text-muted-foreground">{m.n}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="grid gap-5 lg:grid-cols-5">
            <Funil report={r} source={source} />
            <ChartCard
              index={7}
              className="lg:col-span-3"
              eyebrow={source.crm ? `${source.name} + CRM` : source.name}
              title="Dia a dia"
              subtitle="Três gráficos com os mesmos dias: passe o mouse e o mesmo dia acende nos três."
              table={{
                columns: ['Dia', 'Gasto', source.result.column, 'Agendamentos'],
                rows: r.daily.map((p) => [p.label, formatMoney(p.spendCents), p.conversations, p.scheduled]),
              }}
            >
              <StackedCharts
                points={r.daily.map((p) => ({ label: p.label, tick: p.tick }))}
                charts={[
                  { title: 'Gasto', total: formatMoney(r.totals.spendCents), series: { name: 'gasto', color: META, values: r.daily.map((p) => p.spendCents), format: 'money' } },
                  { title: source.result.daily, total: formatCount(r.totals.conversations), series: { name: source.result.many, color: META, values: r.daily.map((p) => p.conversations), format: 'count' } },
                  ...(source.crm
                    ? [{ title: 'Agendamentos', total: formatCount(r.totals.scheduled), series: { name: 'agendamentos', color: CRM, values: r.daily.map((p) => p.scheduled), format: 'count' as const } }]
                    : []),
                ]}
              />
            </ChartCard>
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            <ChartCard
              index={8}
              className="lg:col-span-3"
              eyebrow={source.name}
              title="Quem responde aos anúncios"
              subtitle={
                publico.top ? (
                  <>
                    Quem mais respondeu:{' '}
                    <strong className="font-semibold text-foreground">
                      {publico.top.gender === 'female' ? 'mulheres' : 'homens'} de {ageLabel(publico.top.age)} anos
                    </strong>
                    . Os números contam {unidadePublico}.
                  </>
                ) : (
                  'Idade e gênero de quem respondeu.'
                )
              }
              table={{
                columns: ['Idade', 'Mulheres', 'Homens', 'Não informado'],
                rows: publico.ages.map((a) => [`${ageLabel(a.age)} anos`, a.female, a.male, a.unknown]),
              }}
            >
              {publico.ages.length === 0 && publico.totals.female + publico.totals.male === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{source.audienceEmpty}</p>
              ) : source.audience === 'split' ? (
                <div className="space-y-5">
                  <SplitBar
                    parts={[
                      { label: 'Mulheres', value: publico.totals.female, color: CRM },
                      { label: 'Homens', value: publico.totals.male, color: META },
                      { label: 'Não informado', value: publico.totals.unknown, color: NEUTRO },
                    ]}
                  />
                  <BarList
                    empty={source.audienceEmpty}
                    items={publico.ages.map((a) => {
                      const v = a.female + a.male + a.unknown;
                      return { label: `${ageLabel(a.age)} anos`, value: v, display: formatCount(v) };
                    })}
                  />
                </div>
              ) : (
                <div className="space-y-5">
                  <SplitBar
                    parts={[
                      { label: 'Mulheres', value: publico.totals.female, color: CRM },
                      { label: 'Homens', value: publico.totals.male, color: META },
                      { label: 'Não informado', value: publico.totals.unknown, color: NEUTRO },
                    ]}
                  />
                  <AgePyramid unit={unidadePublico} rows={publico.ages.map((a) => ({ label: ageLabel(a.age), female: a.female, male: a.male }))} />
                </div>
              )}
            </ChartCard>

            <ChartCard
              index={9}
              className="lg:col-span-2"
              eyebrow={source.name}
              title={source.places.title}
              subtitle={`${source.places.subtitle}, por ${unidade(b.platforms.metric)}.`}
            >
              <BarList
                empty={source.places.empty}
                items={b.platforms.lines.map((p) => ({
                  label: p.label,
                  value: p.value,
                  display: formatCount(p.value),
                  note: `${formatRate(p.share)}${p.costPerCents != null ? ` · ${formatMoney(p.costPerCents)} cada` : ''}`,
                }))}
              />
            </ChartCard>
          </div>

          {b.devices && b.devices.lines.length > 0 && (
            <ChartCard
              index={10}
              eyebrow={source.name}
              title="Celular ou computador"
              subtitle={`Em qual aparelho o anúncio rendeu, por ${unidade(b.devices.metric)}.`}
            >
              <BarList
                empty={source.places.empty}
                items={b.devices.lines.map((p) => ({
                  label: p.label,
                  value: p.value,
                  display: formatCount(p.value),
                  note: `${formatRate(p.share)}${p.costPerCents != null ? ` · ${formatMoney(p.costPerCents)} cada` : ''}`,
                }))}
              />
            </ChartCard>
          )}

          {horas.peak != null && (
            <ChartCard
              index={10}
              eyebrow={source.name}
              title="A que horas o anúncio rende"
              subtitle={
                <>
                  Pico: <strong className="font-semibold text-foreground">das {horas.peak}h às {horas.peak + 1}h</strong>. Mostra {unidade(horas.metric)} por hora do dia, somando todos os dias do período.
                </>
              }
              table={{ columns: ['Hora', unidade(horas.metric)], rows: horas.hours.map((v, h) => [`${h}h`, v]) }}
            >
              <ColumnChart
                peak
                height={132}
                maxTicks={12}
                label={`${unidade(horas.metric)} por hora do dia`}
                points={horas.hours.map((_, h) => ({ label: `Das ${h}h às ${h + 1}h`, tick: `${h}h` }))}
                series={[{ name: unidade(horas.metric), color: META, values: horas.hours, format: 'count' }]}
              />
            </ChartCard>
          )}

          <ChartCard index={11} eyebrow={source.crm ? `${source.name} + CRM` : source.name} title="Por campanha" subtitle="Toque numa campanha para ver cada anúncio. Toque no nome de uma coluna para ordenar.">
            <CampaignTable lines={r.lines} resultLabel={source.result.column} costLabel={source.result.costTitle} crm={source.crm} />
          </ChartCard>

          {r.unmatched.leads + r.unmatched.scheduled + r.unmatched.won > 0 && (
            <p className={`${CARD} px-4 py-3 text-sm text-muted-foreground`}>
              Ficaram de fora {formatCount(r.unmatched.leads)} {r.unmatched.leads === 1 ? 'lead' : 'leads'}, {formatCount(r.unmatched.scheduled)}{' '}
              {r.unmatched.scheduled === 1 ? 'agendamento' : 'agendamentos'} e {formatCount(r.unmatched.won)}{' '}
              {r.unmatched.won === 1 ? 'fechamento' : 'fechamentos'} {source.unmatched}.
            </p>
          )}
        </>
      )}

      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">{source.footer}</p>
      {extra}
    </ReportFrame>
  );
}

function Funil({ report, source }: { report: AdsReport; source: AdSource }) {
  // O nome do resultado muda com a fonte ("Conversas no WhatsApp", "Conversões no Google").
  const funil = report.funnel.map((p) => (p.key === 'conversations' ? { ...p, label: source.result.funnel } : p));
  const passo = (key: FunnelStep['key']) => funil.find((p) => p.key === key)!;
  const conversas = passo('conversations');
  // Sem alcance (Google), o topo mostra as exibições, e os cliques comparam com elas.
  const exibicoes: FunnelStep = { key: 'reach', label: 'Exibições', value: report.delivery.impressions, source: 'meta', ofPrevious: null };
  const cliquesBase = passo('clicks');
  const alcance = source.showReach ? passo('reach') : exibicoes;
  const cliques = source.showReach
    ? cliquesBase
    : { ...cliquesBase, ofPrevious: report.delivery.impressions > 0 ? cliquesBase.value / report.delivery.impressions : null };
  // O funil começa no resultado: é onde a pessoa vira um contato de verdade.
  const etapas = funil.filter((p) => p.key !== 'reach' && p.key !== 'clicks' && (source.crm || p.source !== 'crm'));
  const largura = (v: number) => (conversas.value > 0 ? Math.max(9, Math.min(100, (v / conversas.value) * 100)) : 9);
  const cor = (p: FunnelStep) => (p.source === 'meta' ? META : CRM);
  // "De cada 100": número inteiro; abaixo de 10, uma casa só quando faz diferença.
  const de100 = (v: number) => {
    const p = (v / conversas.value) * 100;
    return (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10).toLocaleString('pt-BR');
  };

  return (
    <ChartCard
      index={6}
      className="lg:col-span-2"
      eyebrow={source.crm ? `${source.name} + CRM` : source.name}
      title="Do anúncio ao paciente"
      subtitle="De cada etapa para a seguinte, quantas pessoas continuaram."
      legend={<Legend items={[{ label: source.name, color: META }, { label: 'CRM', color: CRM }]} />}
      table={{
        columns: ['Etapa', 'Pessoas', 'Da etapa anterior'],
        rows: funil.map((p) => [p.label, formatCount(p.value), p.ofPrevious == null ? '–' : formatRate(p.ofPrevious)]),
      }}
    >
      <dl className="grid grid-cols-2 gap-3">
        {[alcance, cliques].map((p) => (
          <div key={p.key} className="rounded-xl bg-foreground/[0.04] px-3 py-2.5 ring-1 ring-inset ring-foreground/[0.06]">
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{p.label}</dt>
            <dd className="viz-num mt-1 text-lg leading-none">{formatCount(p.value)}</dd>
            {p.ofPrevious != null && <dd className="mt-1 text-[11px] text-muted-foreground">{formatRate(p.ofPrevious)} de quem viu</dd>}
          </div>
        ))}
      </dl>

      <ol className="mt-5 space-y-[3px]">
        {etapas.map((p, i) => {
          const [topo, base] = [largura(p.value), etapas[i + 1] ? largura(etapas[i + 1].value) : largura(p.value) * 0.82];
          return (
            <li key={p.key} className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_minmax(0,5.5rem)] items-center gap-2 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_minmax(0,6.5rem)]">
              {/* Duas linhas em vez de cortar: "Conversas no WhatsApp" não cabe numa só. */}
              <span className="text-[13px] leading-tight [overflow-wrap:anywhere]">{p.label}</span>
              <span className="relative block h-12" aria-hidden="true">
                <span
                  className="viz-rise absolute inset-0"
                  style={{
                    clipPath: `polygon(${50 - topo / 2}% 0, ${50 + topo / 2}% 0, ${50 + base / 2}% 100%, ${50 - base / 2}% 100%)`,
                    background: `linear-gradient(180deg, ${cor(p)}, color-mix(in srgb, ${cor(p)} 62%, transparent))`,
                    ['--i' as string]: 6 + i,
                  }}
                >
                  <span className="viz-flow absolute inset-0 opacity-70" style={{ backgroundImage: 'linear-gradient(100deg, transparent 0 40%, rgba(255,255,255,0.22) 50%, transparent 60% 100%)' }} />
                </span>
              </span>
              <span className="text-right">
                <span className="viz-num block text-[15px] leading-none">{formatCount(p.value)}</span>
                {p.ofPrevious != null && <span className="mt-1 block text-[11px] text-muted-foreground">{formatRate(p.ofPrevious)} {i === 0 ? 'dos cliques' : 'seguiram'}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      {!source.crm && (
        <p className="mt-5 rounded-xl bg-foreground/[0.04] px-3 py-2.5 text-sm leading-relaxed text-muted-foreground ring-1 ring-inset ring-foreground/[0.06]">
          Quem agendou e quem fechou vindo do Google aparece aqui quando os leads chegarem pelo link de WhatsApp do Google.
        </p>
      )}
      {source.crm && conversas.value > 0 && (
        <p className="mt-5 rounded-xl bg-foreground/[0.04] px-3 py-2.5 text-sm leading-relaxed text-muted-foreground ring-1 ring-inset ring-foreground/[0.06]">
          De cada 100 {source.key === 'meta' ? 'pessoas que chamaram no WhatsApp' : 'conversões no Google'},{' '}
          <strong className="font-semibold text-foreground">{de100(passo('scheduled').value)} agendaram</strong> e{' '}
          <strong className="font-semibold text-foreground" style={{ textShadow: glow(CRM, 12) }}>
            {de100(passo('won').value)} fecharam
          </strong>
          .
        </p>
      )}
    </ChartCard>
  );
}
