/**
 * Thin adapter kept for existing call sites (ReviewQueueView.tsx): accepts
 * the legacy {points, min, max, threshold, higherIsBetter, label, width?,
 * height?} shape and renders the real chart in charts/ScoreSparkline.tsx.
 * Pass `scale` to use a full ScaleSpec instead of the synthesized fallback.
 */
import type { ScaleSpec } from './charts/scale';
import { ScoreSparkline as ChartSparkline } from './charts/ScoreSparkline';

function synthesizeScale({
  min,
  max,
  threshold,
  higherIsBetter,
  label,
}: {
  min: number;
  max: number;
  threshold: number;
  higherIsBetter: boolean;
  label: string;
}): ScaleSpec {
  const goodTone = 'green' as const;
  const concernTone = 'red' as const;
  return {
    instrument: label,
    instrumentLong: label,
    min,
    max,
    higherIsBetter,
    target: threshold,
    mcid: Math.max(1, Math.round((max - min) * 0.15)),
    bands: higherIsBetter
      ? [
          { id: 'below-target', label: 'below target', min, max: Math.max(min, threshold - 1), tone: concernTone },
          { id: 'at-target', label: 'at target', min: threshold, max, tone: goodTone },
        ]
      : [
          { id: 'at-target', label: 'at target', min, max: Math.max(min, threshold - 1), tone: goodTone },
          { id: 'above-target', label: 'above target', min: threshold, max, tone: concernTone },
        ],
  };
}

export function ScoreSparkline({
  points,
  min,
  max,
  threshold,
  higherIsBetter,
  label,
  width = 200,
  height = 52,
  scale,
}: {
  points: { total: number }[];
  min: number;
  max: number;
  threshold: number;
  higherIsBetter: boolean;
  label: string;
  width?: number;
  height?: number;
  scale?: ScaleSpec;
}) {
  const resolvedScale = scale ?? synthesizeScale({ min, max, threshold, higherIsBetter, label });
  return <ChartSparkline points={points} scale={resolvedScale} width={width} height={height} />;
}
