// Dependency-free SVG chart primitives for Cost Manager, themed via the
// existing CSS-variable palette. No charting library needed at this scale
// (a handful of months / categories).

export interface TrendPoint {
  label: string;
  value: number;
  reference?: number | null;
}

export function SvgLineChart({ points, height = 160 }: { points: TrendPoint[]; height?: number }) {
  const width = 600;
  const pad = 28;
  const max = Math.max(1, ...points.map((p) => Math.max(p.value, p.reference || 0)));
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);

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
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height, overflow: 'visible' }}>
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
  );
}

export interface CategoryBarRow {
  key: string;
  name: string;
  value: number;
  color?: string | null;
}

export function CategoryBars({ rows }: { rows: CategoryBarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r) => (
        <div key={r.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
            <span>{r.name}</span>
            <span style={{ fontWeight: 700 }}>
              ${r.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="prog-track">
            <div
              className="prog-bar2"
              style={{ width: `${(r.value / max) * 100}%`, background: r.color || 'var(--accent)' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
