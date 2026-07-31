/**
 * Small shared helpers for the charts/** components. Kept dependency-free
 * (no d3, no recharts) to match the rest of the dashboard.
 */
import type { ScaleSpec } from './scale';

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Clean, clinically-meaningful y-axis ticks: the instrument min, every band
 * boundary, and the instrument max — deduped. These are already "round"
 * numbers in the clinical sense (band cut points), so we don't need a
 * separate nice-number algorithm.
 */
export function ticksForScale(scale: ScaleSpec): number[] {
  const raw = [scale.min, ...scale.bands.slice(1).map((b) => b.min), scale.max];
  const out: number[] = [];
  for (const v of raw) {
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

export function formatDateTick(date: string, isLast: boolean): string {
  if (isLast) return 'today';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDateFull(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Indices worth a persistent text label: latest always, min/max if distinct. */
export function selectiveLabelIndices(points: { total: number }[]): Set<number> {
  const n = points.length;
  const out = new Set<number>();
  if (n === 0) return out;
  const lastIdx = n - 1;
  out.add(lastIdx);
  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < n; i++) {
    if (points[i].total < points[minIdx].total) minIdx = i;
    if (points[i].total > points[maxIdx].total) maxIdx = i;
  }
  if (minIdx !== lastIdx) out.add(minIdx);
  if (maxIdx !== lastIdx) out.add(maxIdx);
  return out;
}

export function toneVar(tone: 'green' | 'amber' | 'red' | 'gray'): { bg: string; ink: string } {
  switch (tone) {
    case 'green':
      return { bg: 'var(--band-good)', ink: 'var(--band-good-ink)' };
    case 'amber':
      return { bg: 'var(--band-warn)', ink: 'var(--band-warn-ink)' };
    case 'red':
      return { bg: 'var(--band-bad)', ink: 'var(--band-bad-ink)' };
    default:
      return { bg: 'var(--gray-bg)', ink: 'var(--gray-fg)' };
  }
}
