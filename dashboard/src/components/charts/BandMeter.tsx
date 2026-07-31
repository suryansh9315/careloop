/**
 * "Where does this score sit on the instrument?" — a horizontal meter of the
 * full instrument range, segmented into its clinical bands with 2px surface
 * gaps, a marker at the current score, and the endpoint numbers. Answers
 * "is 17 good or bad?" for a reader who doesn't know the instrument.
 */
import { bandForScore, type ScaleSpec } from './scale';
import { clamp, toneVar } from './utils';

export function BandMeter({
  scale,
  total,
  showTicks = false,
}: {
  scale: ScaleSpec;
  total: number;
  showTicks?: boolean;
}) {
  const span = scale.max - scale.min || 1;
  const pct = (v: number) => (clamp(v, scale.min, scale.max) - scale.min) / span;
  const band = bandForScore(scale, total);
  const markerPct = pct(total) * 100;

  return (
    <div
      className="cl-chart cl-band-meter"
      role="img"
      aria-label={`${scale.instrument} ${total} of ${scale.max} — ${band.label}`}
    >
      <div className="cl-band-meter-track">
        {scale.bands.map((b) => {
          const widthPct = ((b.max - b.min + 1) / (span + 1)) * 100;
          const tone = toneVar(b.tone);
          return (
            <div
              key={b.id}
              className="cl-band-meter-seg"
              style={{ width: `${widthPct}%`, background: tone.bg }}
            />
          );
        })}
        <div className="cl-band-meter-marker" style={{ left: `${markerPct}%` }} />
      </div>
      {showTicks && (
        <div className="cl-band-meter-ticks">
          {scale.bands.slice(1).map((b) => (
            <span
              key={b.id}
              className="cl-band-meter-tick"
              style={{ left: `${pct(b.min) * 100}%` }}
            >
              {b.min}
            </span>
          ))}
        </div>
      )}
      <div className="cl-band-meter-foot">
        <span className="cl-num">{scale.min}</span>
        <span className="cl-band-meter-current">
          <strong className="cl-num">{total}</strong>
          <span className="cl-band-meter-label" style={{ color: toneVar(band.tone).ink }}>
            {band.label}
          </span>
        </span>
        <span className="cl-num">{scale.max}</span>
      </div>
    </div>
  );
}
