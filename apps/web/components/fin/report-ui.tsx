'use client';

import { useId, useRef, useState } from 'react';
import { Download, Eye, EyeOff, Image as ImageIcon } from 'lucide-react';
import type { Day } from '@/lib/financeiro/dates';
import { formatCents } from '@/lib/financeiro/money';
import { PERIOD_LABEL, presetRange, type PeriodPreset } from '@/lib/financeiro/reports';
import { downloadCsv, type Cell } from '@/lib/xlsx';
import { inputCls } from './ui';

import { DateField } from '@/components/ui/date-field';
/**
 * Peças dos relatórios: o seletor de período com atalhos, o "Esconder
 * valores", um gráfico de barras em SVG (com dica ao passar o mouse e tabela
 * equivalente para leitor de tela) e os botões de exportar.
 */

export function PeriodPicker({ from, to, today, presets, onChange }: { from: string; to: string; today: Day; presets: PeriodPreset[]; onChange: (from: string, to: string) => void }) {
  const id = useId();
  const atual = presets.find((p) => {
    const r = presetRange(p, today);
    return r.from === from && r.to === to;
  });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={`${id}-p`} className="block text-sm font-medium">
          Período
        </label>
        <select
          id={`${id}-p`}
          value={atual ?? ''}
          onChange={(e) => {
            if (!e.target.value) return;
            const r = presetRange(e.target.value as PeriodPreset, today);
            onChange(r.from, r.to);
          }}
          className={`${inputCls} mt-1 w-48`}
        >
          <option value="">Período específico</option>
          {presets.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-de`} className="block text-sm font-medium">
          De
        </label>
        <DateField id={`${id}-de`} value={from} onChange={(v) => v && onChange(v, v > to ? v : to)} wrapperClassName="mt-1 w-40" className={`${inputCls} w-full`} />
      </div>
      <div>
        <label htmlFor={`${id}-ate`} className="block text-sm font-medium">
          Até
        </label>
        <DateField id={`${id}-ate`} value={to} onChange={(v) => v && onChange(v < from ? v : from, v)} wrapperClassName="mt-1 w-40" className={`${inputCls} w-full`} />
      </div>
    </div>
  );
}

export function HideValues({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={shown} className="btn-ghost btn-sm inline-flex items-center gap-1.5">
      {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />} {shown ? 'Esconder valores' : 'Mostrar valores'}
    </button>
  );
}

export const money = (shown: boolean) => (c: number) => (shown ? formatCents(c) : '•••••');

export function CsvButton({ filename, rows, label = 'CSV' }: { filename: string; rows: () => Cell[][]; label?: string }) {
  return (
    <button type="button" onClick={() => downloadCsv(filename, rows())} className="btn-ghost btn-sm inline-flex items-center gap-1">
      <Download className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </button>
  );
}

export interface BarSeries {
  name: string;
  /** Classe de cor do Tailwind para o preenchimento (fill-*). */
  fill: string;
  /** Classe da bolinha da legenda (bg-*). */
  swatch: string;
  values: number[];
}

/**
 * Gráfico de barras agrupadas. Barras finas, cantos arredondados em cima,
 * grade discreta, legenda sempre visível e uma tabela escondida com os mesmos
 * números para quem usa leitor de tela.
 */
export function BarChart({ title, labels, series, shown, filename }: { title: string; labels: string[]; series: BarSeries[]; shown: boolean; filename: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 240;
  const pad = { l: 8, r: 8, t: 12, b: 28 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const grupo = (W - pad.l - pad.r) / Math.max(1, labels.length);
  const largura = Math.max(4, Math.min(18, (grupo - 10) / Math.max(1, series.length) - 2));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const fmt = money(shown);

  const png = () => {
    const svg = ref.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // As cores das classes não vão junto: pinta cada série com a cor calculada na tela.
    const reais = svg.querySelectorAll('rect[data-serie]');
    clone.querySelectorAll('rect[data-serie]').forEach((r, i) => r.setAttribute('fill', getComputedStyle(reais[i]).fill));
    clone.querySelectorAll('text').forEach((t) => t.setAttribute('fill', '#475569'));
    const img = new Image();
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W * 2;
      c.height = H * 2;
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = `${filename}.png`;
      a.click();
    };
    img.src = url;
  };

  return (
    <figure className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex flex-wrap items-center gap-3">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-sm ${s.swatch}`} aria-hidden="true" /> {s.name}
            </span>
          ))}
          <CsvButton filename={filename} rows={() => [['Período', ...series.map((s) => s.name)], ...labels.map((l, i) => [l, ...series.map((s) => (s.values[i] / 100).toFixed(2).replace('.', ','))])]} />
          <button type="button" onClick={png} className="btn-ghost btn-sm inline-flex items-center gap-1">
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" /> PNG
          </button>
        </span>
      </figcaption>
      <div className="relative mt-3">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} className="stroke-border" strokeWidth={1} strokeDasharray="2 4" />
          ))}
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} />
          {labels.map((l, i) => {
            const x0 = pad.l + i * grupo + (grupo - series.length * (largura + 2)) / 2;
            return (
              <g key={l} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={pad.l + i * grupo} y={pad.t} width={grupo} height={H - pad.t - pad.b} fill="transparent" />
                {series.map((s, k) => {
                  const v = s.values[i] ?? 0;
                  const h = Math.max(0, y(0) - y(v));
                  return <rect key={s.name} data-serie={k} x={x0 + k * (largura + 2)} y={y(v)} width={largura} height={h} rx={Math.min(4, largura / 2)} className={`${s.fill} ${hover === null || hover === i ? '' : 'opacity-40'}`} />;
                })}
                <text x={pad.l + i * grupo + grupo / 2} y={H - 10} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {l}
                </text>
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `${Math.min(80, (hover / Math.max(1, labels.length)) * 100)}%` }}>
            <p className="font-semibold">{labels[hover]}</p>
            {series.map((s) => (
              <p key={s.name} className="tabular-nums">
                {s.name}: {fmt(s.values[hover] ?? 0)}
              </p>
            ))}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Período</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l}>
              <th scope="row">{l}</th>
              {series.map((s) => (
                <td key={s.name}>{fmt(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Lista "top 10" com barra horizontal proporcional. */
export function TopList({ title, rows, shown, filename }: { title: string; rows: { name: string; quantity: number; cents: number }[]; shown: boolean; filename: string }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const fmt = money(shown);
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <CsvButton filename={filename} rows={() => [['Nome', 'Quantidade', 'Valor'], ...rows.map((r) => [r.name, r.quantity, (r.cents / 100).toFixed(2).replace('.', ',')])]} />
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum atendimento no período.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.name} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 tabular-nums">
                  {fmt(r.cents)} <span className="text-xs text-muted-foreground">· {r.quantity}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-alt" aria-hidden="true">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(2, (r.cents / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

