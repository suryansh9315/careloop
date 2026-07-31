/**
 * Primary visualization: an instrument score over time, plotted against its
 * full clinical range with shaded band regions so a reader who doesn't know
 * the instrument can still tell "is this good or bad" at a glance.
 *
 * Dependency-free inline SVG (no recharts/d3), matching the rest of the app.
 */
import { useId, useMemo, useState } from 'react';
import type { ScaleSpec } from './scale';
import { bandForScore } from './scale';
import { clamp, formatDateFull, formatDateTick, selectiveLabelIndices, ticksForScale, toneVar } from './utils';

/*
 * Label-collision geometry. SVG gives us no text metrics before paint, so these
 * approximate the rendered boxes closely enough to decide whether a band name
 * and a score label would sit on top of each other. Verified against measured
 * getBBox() output at the sizes these charts actually render.
 */
/** Average glyph advance for the 10px band-name text. */
const BAND_NAME_CHAR_W = 5.2;
/** Vertical offset of a score label above its point. */
const SCORE_LABEL_DY = 11;
/** Baseline → visual-centre correction for the 10.5px score label. */
const SCORE_LABEL_BASELINE_OFFSET = 4;
/** Combined half-heights of the two label boxes, plus a little breathing room. */
const LABEL_ROW_HEIGHT = 14;

export type TrendPoint = { date: string; total: number; label?: string };

export function ScoreTrendChart({
  points,
  scale,
  height = 200,
  showTable = true,
}: {
  points: TrendPoint[];
  scale: ScaleSpec;
  height?: number;
  showTable?: boolean;
}) {
  const rawId = useId().replace(/:/g, '');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [tableView, setTableView] = useState(false);

  const n = points.length;
  const activeIndex = hoverIndex ?? focusIndex;

  const W = 640;
  const H = height;
  const padLeft = 34;
  const padRight = 14;
  const padTop = 12;
  const padBottom = 24; // the x-axis band
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;

  const x = useMemo(
    () => (i: number) => padLeft + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1)),
    [n, innerW, padLeft],
  );
  const y = useMemo(
    () => (v: number) => padTop + innerH * (1 - (clamp(v, scale.min, scale.max) - scale.min) / (scale.max - scale.min || 1)),
    [innerH, padTop, scale.min, scale.max],
  );

  const ticks = useMemo(() => ticksForScale(scale), [scale]);
  const labelIdx = useMemo(() => selectiveLabelIndices(points), [points]);

  if (n === 0) return null;

  const last = points[n - 1];
  const lastBand = bandForScore(scale, last.total);
  const active = activeIndex != null ? points[activeIndex] : null;
  const activeBand = active ? bandForScore(scale, active.total) : null;

  const line = n > 1 ? points.map((p, i) => `${x(i)},${y(p.total)}`).join(' ') : '';
  const area = n > 1 ? `${x(0)},${padTop + innerH} ${line} ${x(n - 1)},${padTop + innerH}` : '';

  const ariaLabel = `${scale.instrumentLong} (${scale.instrument}) trend. Latest: ${last.total} of ${scale.max}, ${lastBand.label}.`;
  const summary = points
    .map((p, i) => `${i === n - 1 ? 'today' : formatDateFull(p.date)}: ${p.total} (${bandForScore(scale, p.total).label})`)
    .join('; ');

  function moveActive(delta: number) {
    setFocusIndex((cur) => {
      const base = cur ?? n - 1;
      return clamp(base + delta, 0, n - 1);
    });
  }

  const tooltip =
    active != null
      ? {
          xPct: (x(activeIndex!) / W) * 100,
          topPx: y(active.total),
        }
      : null;

  return (
    <div className="cl-chart cl-score-trend">
      <div className="cl-chart-toprow">
        <span className="cl-visually-hidden">{summary}</span>
        {showTable && (
          <button
            type="button"
            className="cl-table-toggle"
            aria-pressed={tableView}
            onClick={() => setTableView((v) => !v)}
          >
            {tableView ? 'Chart view' : 'Table view'}
          </button>
        )}
      </div>

      {tableView ? (
        <div className="cl-chart-table-wrap">
          <table className="cl-chart-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>{scale.instrument}</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => {
                const b = bandForScore(scale, p.total);
                return (
                  <tr key={i}>
                    <td>{i === n - 1 ? 'Today' : formatDateFull(p.date)}</td>
                    <td className="cl-num">{p.total}</td>
                    <td>
                      <span className="cl-band-key" style={{ background: toneVar(b.tone).ink }} />
                      {b.label}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cl-chart-svgwrap" style={{ height: H }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            className="cl-chart-svg"
            onFocus={() => setFocusIndex((cur) => cur ?? n - 1)}
            onBlur={() => setFocusIndex(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                moveActive(-1);
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                moveActive(1);
              }
            }}
          >
            <defs>
              <linearGradient id={`cl-trendfill-${rawId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.12" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* band regions — shaded across the full plot width */}
            {scale.bands.map((band) => {
              const top = y(band.max);
              const bottom = y(band.min);
              const h = Math.max(0, bottom - top);
              const tone = toneVar(band.tone);
              /*
               * The band name is chrome; a plotted score is data, so data wins.
               * Band names sit in a lane at the left of the plot, which is exactly
               * where an early data label lands — drop the name rather than let the
               * two overlap (never clip, never stack). The band is still identified
               * by its tint, the y-axis ticks, the tooltip and the table view.
               */
              const nameLaneEnd = padLeft + 8 + band.label.length * BAND_NAME_CHAR_W;
              const occluded = [...labelIdx].some((i) => {
                /*
                 * Compare visual centres, not baselines. A band name is centred
                 * on its y (dominantBaseline="central"); a score label's y is its
                 * baseline, so its box centre sits ~4px above that. Comparing the
                 * two directly under-reports the gap and lets a collision through.
                 */
                const scoreBoxCenter = y(points[i].total) - SCORE_LABEL_DY - SCORE_LABEL_BASELINE_OFFSET;
                return (
                  Math.abs(scoreBoxCenter - (top + h / 2)) < LABEL_ROW_HEIGHT &&
                  x(i) < nameLaneEnd + 16
                );
              });
              const canLabel = h >= 22 && !occluded;
              return (
                <g key={band.id}>
                  <rect x={padLeft} y={top} width={innerW} height={h} fill={tone.bg} />
                  {canLabel && (
                    <text x={padLeft + 8} y={top + h / 2} dominantBaseline="central" fontSize="10" fontWeight={600} fill={tone.ink}>
                      {band.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* y-axis ticks */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padLeft} x2={W - padRight} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
                <text
                  x={padLeft - 6}
                  y={y(t)}
                  dominantBaseline="central"
                  textAnchor="end"
                  fontSize="9.5"
                  fill="var(--text-subtle)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {t}
                </text>
              </g>
            ))}
            <line x1={padLeft} x2={padLeft} y1={padTop} y2={padTop + innerH} stroke="var(--axis)" strokeWidth="1" />

            {/* area + line */}
            {n > 1 && <polygon points={area} fill={`url(#cl-trendfill-${rawId})`} />}
            {n > 1 && (
              <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            )}

            {/* crosshair */}
            {active != null && activeIndex != null && (
              <line
                x1={x(activeIndex)}
                x2={x(activeIndex)}
                y1={padTop}
                y2={padTop + innerH}
                stroke="var(--text-subtle)"
                strokeWidth="1"
              />
            )}

            {/* points */}
            {points.map((p, i) => {
              const isLast = i === n - 1;
              const isActive = i === activeIndex;
              const showLabel = labelIdx.has(i);
              const cx = x(i);
              const cy = y(p.total);
              return (
                <g key={i}>
                  {isLast ? (
                    <>
                      <circle cx={cx} cy={cy} r={7} fill="var(--surface)" />
                      <circle cx={cx} cy={cy} r={5} fill="var(--accent)" />
                    </>
                  ) : (
                    <circle cx={cx} cy={cy} r={3} fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
                  )}
                  {isActive && <circle cx={cx} cy={cy} r={9} fill="none" stroke="var(--text-subtle)" strokeWidth="1" />}
                  {showLabel && (
                    /*
                     * Edge points sit flush against the plot bounds, so a centred
                     * label half-hangs into the y-axis gutter and lands on top of a
                     * tick (seen with PHQ-9: the first score's "9" over the "10"
                     * tick). Anchor inward at the edges, and paint a surface-coloured
                     * halo under the glyphs so a label stays legible wherever it
                     * falls — over a band tint, the area wash, or the line itself.
                     */
                    <text
                      x={cx + (i === 0 ? 4 : isLast ? -4 : 0)}
                      y={cy - 11}
                      textAnchor={i === 0 ? 'start' : isLast ? 'end' : 'middle'}
                      fontSize="10.5"
                      fontWeight={isLast ? 700 : 500}
                      fill="var(--text)"
                      stroke="var(--surface)"
                      strokeWidth="3"
                      paintOrder="stroke"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {p.total}
                    </text>
                  )}
                  <text x={cx} y={H - 7} textAnchor="middle" fontSize="9" fill="var(--text-subtle)">
                    {i === 0 || isLast ? formatDateTick(p.date, isLast) : ''}
                  </text>
                  {/* hit target — wider than the mark, min ~24px */}
                  <rect
                    x={Math.max(padLeft, cx - Math.max(12, innerW / Math.max(n, 1) / 2))}
                    y={padTop}
                    width={Math.max(24, innerW / Math.max(n, 1))}
                    height={innerH}
                    fill="transparent"
                    onMouseEnter={() => setHoverIndex(i)}
                    onMouseMove={() => setHoverIndex(i)}
                    onMouseLeave={() => setHoverIndex(null)}
                  />
                </g>
              );
            })}
          </svg>

          {tooltip && active && activeBand && (
            <div
              className="cl-tooltip"
              style={{ left: `${tooltip.xPct}%`, top: Math.max(0, tooltip.topPx - 8) }}
            >
              <div className="cl-tooltip-value">{active.total}</div>
              <div className="cl-tooltip-label">
                <span className="cl-tooltip-key" />
                {activeIndex === n - 1 ? 'Today' : formatDateFull(active.date)} · {activeBand.label}
              </div>
            </div>
          )}

          {n === 1 && <div className="cl-chart-note">First check-in — trend will build over time.</div>}
        </div>
      )}
    </div>
  );
}
