/**
 * Dense inline trend for queue cards. Same band shading as ScoreTrendChart,
 * miniaturized: no axis, no tooltip (the card itself is the hit target), only
 * the endpoint value is labeled. Cheap — many render at once on one page.
 */
import { useId } from 'react';
import type { ScaleSpec } from './scale';
import { clamp, toneVar } from './utils';

export function ScoreSparkline({
  points,
  scale,
  width = 200,
  height = 52,
}: {
  points: { total: number }[];
  scale: ScaleSpec;
  width?: number;
  height?: number;
}) {
  const rawId = useId().replace(/:/g, '');
  const n = points.length;
  if (n === 0) return null;

  const W = width;
  const H = height;
  const padX = 4;
  const padY = 6;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const x = (i: number) => padX + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) =>
    padY + innerH * (1 - (clamp(v, scale.min, scale.max) - scale.min) / (scale.max - scale.min || 1));

  const line = points.map((p, i) => `${x(i)},${y(p.total)}`).join(' ');
  const last = points[n - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${scale.instrument} sparkline, latest ${last.total} of ${scale.max}`}
      className="cl-chart cl-sparkline"
    >
      <defs>
        <linearGradient id={`cl-spark-${rawId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {scale.bands.map((band) => {
        const top = y(band.max);
        const bottom = y(band.min);
        return (
          <rect
            key={band.id}
            x={padX}
            y={top}
            width={innerW}
            height={Math.max(0, bottom - top)}
            fill={toneVar(band.tone).bg}
          />
        );
      })}

      {n > 1 && (
        <polygon
          points={`${x(0)},${padY + innerH} ${line} ${x(n - 1)},${padY + innerH}`}
          fill={`url(#cl-spark-${rawId})`}
        />
      )}
      {n > 1 && (
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      )}

      {points.map((p, i) => {
        const isLast = i === n - 1;
        return (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.total)}
            r={isLast ? 4 : 2.5}
            fill={isLast ? 'var(--accent)' : 'var(--surface)'}
            stroke="var(--accent)"
            strokeWidth={isLast ? 0 : 1.5}
          />
        );
      })}
      <text x={x(n - 1)} y={Math.max(9, y(last.total) - 7)} textAnchor="end" fontSize="9.5" fontWeight={700} fill="var(--text)">
        {last.total}
      </text>
    </svg>
  );
}
