// Dependency-free SVG chart primitives for Cost Manager, themed via the
// existing CSS-variable palette. No charting library needed at this scale
// (a handful of months / categories).

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

  const hasReference = points.some((p) => p.reference != null);

  return (
    <div>
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
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height, overflow: 'visible' }}>
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
        {hasReference && (
          <path d={line('reference')} fill="none" stroke="var(--amber)" strokeWidth={1.5} strokeDasharray="4 4" />
        )}
        <path d={line('value')} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={3.5} fill="var(--accent)" />
        ))}
        {points.map((p, i) => (
          <text key={i} x={x(i)} y={height - 6} fontSize={10} fill="var(--muted)" textAnchor="middle">
            {p.label}
          </text>
        ))}
      </svg>
    </div>
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

export function CategoryBars({ rows }: { rows: CategoryRow[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.pulled, r.received)));
  return (
    <div>
      <div className="chart-legend" style={{ marginBottom: 12 }}>
        <span className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: 'var(--ink)' }} />
          Pulled
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: 'var(--line)' }} />
          Received
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((r) => (
          <div key={r.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
              {isEmojiIcon(r.icon) && <span aria-hidden>{r.icon}</span>}
              <span>{r.name}</span>
            </div>
            <div className="cat-bar-row">
              <span className="cat-bar-label">Pulled</span>
              <div className="prog-track">
                <div className="prog-bar2" style={{ width: `${(r.pulled / max) * 100}%`, background: r.color || 'var(--accent)' }} />
              </div>
              <span className="cat-bar-val">{fmtDollar(r.pulled)}</span>
            </div>
            <div className="cat-bar-row">
              <span className="cat-bar-label">Received</span>
              <div className="prog-track">
                <div className="prog-bar2" style={{ width: `${(r.received / max) * 100}%`, background: 'var(--line)' }} />
              </div>
              <span className="cat-bar-val">{fmtDollar(r.received)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
