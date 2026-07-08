// Dependency-free SVG chart primitives for Cost Manager, themed via the
// existing CSS-variable palette. No charting library needed at this scale
// (a handful of months / categories).

import { useState } from 'react';

function fmtCompact(v: number): string {
  if (v >= 1000) return '$' + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
  return '$' + Math.round(v);
}

function fmtDollar(v: number): string {
  return '$' + Math.round(v).toLocaleString();
}

// Round a max value up to a "nice" gridline boundary (1/2/5 * 10^n).
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / magnitude;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * magnitude;
}

export interface TrendPoint {
  label: string;
  value: number;
  reference?: number | null;
}

export function SvgLineChart({
  points,
  height = 180,
  valueLabel = 'Spend',
  referenceLabel = 'Budget',
}: {
  points: TrendPoint[];
  height?: number;
  valueLabel?: string;
  referenceLabel?: string;
}) {
  const width = 600;
  const padL = 52;
  const padR = 12;
  const padTop = 12;
  const padBottom = 26;
  const innerW = width - padL - padR;
  const innerH = height - padTop - padBottom;

  const maxRaw = Math.max(1, ...points.map((p) => Math.max(p.value, p.reference || 0)));
  const niceMax = niceCeil(maxRaw);
  const gridCount = 4;

  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (i: number) => padL + i * stepX;
  const y = (v: number) => padTop + innerH - (v / niceMax) * innerH;

  const line = (key: 'value' | 'reference') =>
    points
      .map((p, i) => {
        const v = key === 'value' ? p.value : p.reference;
        return v == null ? null : `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`;
      })
      .filter(Boolean)
      .join(' ');

  const areaPath =
    points.length > 0
      ? `M ${x(0)} ${y(0)} ` + points.map((p, i) => `L ${x(i)} ${y(p.value)}`).join(' ') + ` L ${x(points.length - 1)} ${y(0)} Z`
      : '';

  const hasReference = points.some((p) => p.reference != null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let best = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(x(i) - relX);
      if (d < best) { best = d; nearest = i; }
    });
    setHoverIdx(nearest);
  }

  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div style={{ position: 'relative' }}>
      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: 'var(--accent)' }} />
          {valueLabel}
        </span>
        {hasReference && (
          <span className="chart-legend-item">
            <span className="chart-legend-swatch dashed" />
            {referenceLabel}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height, overflow: 'visible', cursor: points.length > 0 ? 'crosshair' : 'default' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="cmSpendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: gridCount + 1 }).map((_, i) => {
          const v = (niceMax / gridCount) * i;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={yy} y2={yy} stroke="var(--line-soft)" strokeWidth={1} />
              <text x={padL - 8} y={yy + 3} fontSize={9} fill="var(--faint)" textAnchor="end">
                {fmtCompact(v)}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill="url(#cmSpendFill)" stroke="none" />
        {hasReference && (
          <path d={line('reference')} fill="none" stroke="var(--amber)" strokeWidth={1.5} strokeDasharray="4 4" />
        )}
        <path d={line('value')} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={hoverIdx === i ? 5 : 3.5} fill="var(--accent)" />
        ))}
        {hoverIdx != null && (
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={padTop} y2={padTop + innerH} stroke="var(--line)" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {points.map((p, i) => (
          <text key={i} x={x(i)} y={height - 6} fontSize={10} fill="var(--muted)" textAnchor="middle">
            {p.label}
          </text>
        ))}
      </svg>
      {hoverPoint && hoverIdx != null && (
        <div className="chart-tooltip" style={{ left: `${(x(hoverIdx) / width) * 100}%` }}>
          <div className="chart-tooltip-label">{hoverPoint.label}</div>
          <div className="chart-tooltip-val">{fmtDollar(hoverPoint.value)}</div>
          {hoverPoint.reference != null && <div className="chart-tooltip-ref">{referenceLabel}: {fmtDollar(hoverPoint.reference)}</div>}
        </div>
      )}
    </div>
  );
}

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color?: string | null;
}

export function DonutChart({ slices, size = 148, thickness = 24, centerLabel = 'Total' }: { slices: DonutSlice[]; size?: number; thickness?: number; centerLabel?: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--line-soft)" strokeWidth={thickness} />
      {total > 0 &&
        slices.map((s) => {
          if (s.value <= 0) return null;
          const frac = s.value / total;
          const dash = frac * circumference;
          const el = (
            <circle
              key={s.key}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={s.color || 'var(--accent)'}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
          offset += dash;
          return el;
        })}
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={10} fill="var(--muted)" fontWeight={600}>
        {centerLabel}
      </text>
      <text x={cx} y={cy + 13} textAnchor="middle" fontSize={16} fill="var(--ink)" fontWeight={800}>
        {fmtCompact(total)}
      </text>
    </svg>
  );
}

export interface CategoryRow {
  key: string;
  name: string;
  icon?: string | null;
  pulled: number;
  received: number;
  color?: string | null;
}

// Category icons are emoji in this app's data; a couple of legacy rows store
// a plain word instead ("sparkles") — only render short (emoji-length) values.
function isEmojiIcon(icon?: string | null): boolean {
  return !!icon && icon.length <= 4;
}

export function CategoryDonut({ rows }: { rows: CategoryRow[] }) {
  // Spend per category = received + pulled, matching the same "taken out of
  // the allotment" definition used for the page's Total Spent figure.
  const sorted = [...rows].sort((a, b) => (b.pulled + b.received) - (a.pulled + a.received));
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <DonutChart
        centerLabel="Spend"
        slices={sorted.map((r) => ({ key: r.key, label: r.name, value: r.pulled + r.received, color: r.color }))}
      />
      <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map((r) => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span className="chart-legend-swatch" style={{ background: r.color || 'var(--accent)', flexShrink: 0 }} />
            {isEmojiIcon(r.icon) && <span aria-hidden>{r.icon}</span>}
            <span style={{ flex: 1, fontWeight: 600 }}>{r.name}</span>
            <span style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{fmtDollar(r.pulled + r.received)}</span>
            <span style={{ color: 'var(--faint)', fontSize: 10.5, width: 100, textAlign: 'right' }}>{fmtDollar(r.pulled)} pulled</span>
          </div>
        ))}
      </div>
    </div>
  );
}
