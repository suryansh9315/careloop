/**
 * Signed change from first → latest point, colored by direction × whether up
 * is good for this instrument (never color alone — an arrow glyph + text
 * always accompany it). Flags clinically-meaningful change (>= MCID).
 */
import type { ScaleSpec } from './scale';

export function DeltaBadge({ points, scale }: { points: { total: number }[]; scale: ScaleSpec }) {
  if (points.length < 2) return null;

  const first = points[0].total;
  const latest = points[points.length - 1].total;
  const delta = latest - first;

  if (delta === 0) {
    return (
      <span className="cl-chart cl-delta-badge tone-gray" title="No change since first check-in">
        <span className="cl-delta-arrow" aria-hidden="true">
          →
        </span>
        No change
      </span>
    );
  }

  const improving = scale.higherIsBetter ? delta > 0 : delta < 0;
  const meaningful = Math.abs(delta) >= scale.mcid;
  const arrow = delta > 0 ? '↑' : '↓';
  const signed = delta > 0 ? `+${delta}` : `${delta}`;
  const tone = improving ? 'green' : 'red';

  const title = meaningful
    ? `${signed} ${scale.instrument} since first check-in — clinically meaningful change (MCID ${scale.mcid})`
    : `${signed} ${scale.instrument} since first check-in`;

  return (
    <span className={`cl-chart cl-delta-badge tone-${tone} ${meaningful ? 'meaningful' : ''}`} title={title}>
      <span className="cl-delta-arrow" aria-hidden="true">
        {arrow}
      </span>
      <span className="cl-num">{signed}</span>
      {meaningful && <span className="cl-delta-flag">clinically meaningful</span>}
    </span>
  );
}
