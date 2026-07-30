/**
 * Dependency-free inline-SVG score trend (no recharts). Plots prior instrument
 * scores + today's, with a dashed target line and a soft "concern" zone. Styled
 * with the app's design tokens so it stays clean/monochrome + one accent.
 */

export type TrendPoint = { date: string; total: number; label?: string };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function tick(date: string, isLast: boolean): string {
  if (isLast) return 'today';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ScoreTrend({
  points,
  min,
  max,
  threshold,
  higherIsBetter,
  label,
}: {
  points: TrendPoint[];
  min: number;
  max: number;
  threshold: number;
  higherIsBetter: boolean;
  label: string;
}) {
  if (points.length === 0) return null;

  const W = 340;
  const H = 132;
  const padX = 16;
  const padTop = 18;
  const padBottom = 24;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const n = points.length;

  const x = (i: number) => padX + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) => padTop + innerH * (1 - (clamp(v, min, max) - min) / (max - min));
  const yT = y(threshold);
  const line = points.map((p, i) => `${x(i)},${y(p.total)}`).join(' ');
  const area = `${padX},${padTop + innerH} ${line} ${x(n - 1)},${padTop + innerH}`;

  // Higher-is-worse → the concern zone is ABOVE the target; else BELOW it.
  const dangerAbove = !higherIsBetter;
  const dangerY = dangerAbove ? padTop : yT;
  const dangerH = dangerAbove ? yT - padTop : padTop + innerH - yT;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${label} trend`}
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="trendfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.14" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* concern zone */}
      <rect x={padX} y={dangerY} width={innerW} height={Math.max(0, dangerH)} fill="#fdecec" opacity="0.55" />

      {/* target line */}
      <line x1={padX} x2={W - padX} y1={yT} y2={yT} stroke="#cbd0d8" strokeWidth="1" strokeDasharray="4 4" />
      <text x={W - padX} y={yT - 5} textAnchor="end" fontSize="9" fill="#9ca3af">
        target {threshold}
      </text>

      {/* area + line */}
      <polygon points={area} fill="url(#trendfill)" />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />

      {/* points */}
      {points.map((p, i) => {
        const last = i === n - 1;
        return (
          <g key={i}>
            <circle
              cx={x(i)}
              cy={y(p.total)}
              r={last ? 4.5 : 3}
              fill={last ? 'var(--accent)' : '#ffffff'}
              stroke="var(--accent)"
              strokeWidth="2"
            />
            <text
              x={x(i)}
              y={y(p.total) - 10}
              textAnchor="middle"
              fontSize="10.5"
              fontWeight={last ? 700 : 500}
              fill={last ? 'var(--accent)' : '#697386'}
            >
              {p.total}
            </text>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#9ca3af">
              {tick(p.date, last)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
