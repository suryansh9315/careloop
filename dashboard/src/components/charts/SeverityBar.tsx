/**
 * Generic ordered stacked bar + legend. Segments are separated by a 2px
 * surface-colored gap (never a stroke). Used for the queue's band-mix and
 * peer-consensus visuals. Per-segment tooltip on hover/focus.
 */
import { useId, useState } from 'react';

export type SeverityBarSegment = {
  key: string;
  label: string;
  count: number;
  tone: 'green' | 'amber' | 'red' | 'gray';
};

function toneBg(tone: SeverityBarSegment['tone']): string {
  switch (tone) {
    case 'green':
      return 'var(--band-good-ink)';
    case 'amber':
      return 'var(--band-warn-ink)';
    case 'red':
      return 'var(--band-bad-ink)';
    default:
      /*
       * The neutral tone marks the benign category ("routine" — nothing wrong),
       * which is usually the majority of the bar. At --gray-fg it carried the
       * same visual weight as the severity colours, so a queue that was 67%
       * routine drew the eye to the one segment that needs no attention. A
       * recessive step keeps severity dominant regardless of the mix; the
       * legend still labels it, so nothing is encoded by colour alone.
       */
      return 'var(--text-subtle)';
  }
}

export function SeverityBar({ segments, total }: { segments: SeverityBarSegment[]; total?: number }) {
  const rawId = useId().replace(/:/g, '');
  const [active, setActive] = useState<string | null>(null);
  const sum = total ?? segments.reduce((s, seg) => s + seg.count, 0);
  const denom = sum || 1;

  return (
    <div className="cl-chart cl-severity-bar">
      <div className="cl-severity-track" role="img" aria-label={segments.map((s) => `${s.label} ${s.count}`).join(', ')}>
        {segments.map((seg) => {
          const pct = (seg.count / denom) * 100;
          if (pct <= 0) return null;
          const tooltipId = `cl-sev-${rawId}-${seg.key}`;
          return (
            <div
              key={seg.key}
              className={`cl-severity-seg ${active === seg.key ? 'active' : ''}`}
              style={{ width: `${pct}%`, background: toneBg(seg.tone) }}
              tabIndex={0}
              aria-describedby={tooltipId}
              onMouseEnter={() => setActive(seg.key)}
              onMouseLeave={() => setActive((a) => (a === seg.key ? null : a))}
              onFocus={() => setActive(seg.key)}
              onBlur={() => setActive((a) => (a === seg.key ? null : a))}
            >
              {active === seg.key && (
                <div className="cl-tooltip cl-severity-tooltip" id={tooltipId} role="tooltip">
                  <div className="cl-tooltip-value">{seg.count}</div>
                  <div className="cl-tooltip-label">
                    <span className="cl-tooltip-key" style={{ background: toneBg(seg.tone) }} />
                    {seg.label} · {Math.round(pct)}%
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="cl-severity-legend">
        {segments.map((seg) => (
          <span key={seg.key} className="cl-severity-legend-item">
            <span className="cl-severity-key" style={{ background: toneBg(seg.tone) }} />
            <span className="cl-text">{seg.label}</span>
            <span className="cl-num cl-severity-count">
              {seg.count} · {Math.round((seg.count / denom) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
