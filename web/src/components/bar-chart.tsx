import { useState } from "react";

// Barres verticales d'une seule série (activité par jour). Barres fines à bout arrondi ancré sur
// la ligne de base, 2 px d'écart, axes discrets, infobulle au survol (zone de survol plus large
// que la barre), tableau caché pour les lecteurs d'écran. Une seule série : pas de légende.

export interface BarPoint {
  label: string;
  value: number;
  detail?: string;
}

export function BarChart({ title, points, valueLabel, labelHeader }: { title: string; points: BarPoint[]; valueLabel: string; labelHeader: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 200;
  const pad = { top: 12, right: 8, bottom: 26, left: 32 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const band = plotW / Math.max(1, points.length);
  const barW = Math.max(2, Math.min(18, band - 2));
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top];
  const labelEvery = Math.ceil(points.length / 8);
  const current = hover !== null ? points[hover] : null;

  return (
    <figure className="relative">
      <figcaption className="mb-2 font-semibold">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tk)} y2={y(tk)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={pad.left - 6} y={y(tk) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">{Number.isInteger(tk) ? tk : tk.toFixed(1)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = pad.left + i * band + (band - barW) / 2;
          const h = Math.max(0, y(0) - y(p.value));
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={p.label} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
              <rect x={pad.left + i * band} y={pad.top} width={band} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(p.value) + r} Q${x},${y(p.value)} ${x + r},${y(p.value)} H${x + barW - r} Q${x + barW},${y(p.value)} ${x + barW},${y(p.value) + r} V${y(0)} Z`}
                  fill={hover === i ? "var(--color-amber)" : "var(--color-ink)"}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--color-muted)">{p.label}</text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--color-muted)" strokeWidth={1} />
      </svg>
      {current && (
        <div className="pointer-events-none absolute right-2 top-8 rounded-[var(--radius-field)] border border-line bg-surface px-3 py-2 text-sm shadow-[var(--shadow-card)]">
          <p className="font-semibold">{current.label}</p>
          <p className="text-muted">{valueLabel} : <span className="font-semibold text-ink tabular-nums">{current.value}</span></p>
          {current.detail && <p className="text-muted">{current.detail}</p>}
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>{labelHeader}</th><th>{valueLabel}</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.label}><td>{p.label}</td><td>{p.value}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
