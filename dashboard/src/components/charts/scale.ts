/**
 * Instrument scale definitions shared by every chart in `charts/**`.
 *
 * Ground truth pulled from the real condition modules
 * (`src/conditions/asthma.ts`, `src/conditions/depression.ts`) — do not
 * invent numbers here; if the clinical bands ever change, change them there
 * first and mirror the change into this file.
 */

export type BandRegion = {
  /** stable id, e.g. 'well' | 'partial' | 'poor' | 'minimal' | ... */
  id: string;
  /** human label, e.g. 'well controlled' */
  label: string;
  /** inclusive */
  min: number;
  /** inclusive */
  max: number;
  tone: 'green' | 'amber' | 'red' | 'gray';
};

export type ScaleSpec = {
  /** short instrument code, e.g. 'ACT' | 'PHQ-9' | 'Score' */
  instrument: string;
  /** long instrument name, e.g. 'Asthma Control Test' */
  instrumentLong: string;
  min: number;
  max: number;
  higherIsBetter: boolean;
  /** the clinically meaningful cut point */
  target: number;
  /** minimal clinically important difference — the smallest change that matters */
  mcid: number;
  /** ordered ascending by min, contiguous, covering min..max */
  bands: BandRegion[];
};

const ASTHMA_SCALE: ScaleSpec = {
  instrument: 'ACT',
  instrumentLong: 'Asthma Control Test',
  min: 5,
  max: 25,
  higherIsBetter: true,
  target: 20,
  mcid: 3,
  bands: [
    { id: 'poor', label: 'very poorly controlled', min: 5, max: 15, tone: 'red' },
    { id: 'partial', label: 'not well controlled', min: 16, max: 19, tone: 'amber' },
    { id: 'well', label: 'well controlled', min: 20, max: 25, tone: 'green' },
  ],
};

const DEPRESSION_SCALE: ScaleSpec = {
  instrument: 'PHQ-9',
  instrumentLong: 'Patient Health Questionnaire-9',
  min: 0,
  max: 27,
  higherIsBetter: false,
  target: 5,
  mcid: 5,
  bands: [
    { id: 'minimal', label: 'minimal', min: 0, max: 4, tone: 'green' },
    { id: 'mild', label: 'mild', min: 5, max: 9, tone: 'green' },
    { id: 'moderate', label: 'moderate', min: 10, max: 14, tone: 'amber' },
    { id: 'moderately-severe', label: 'moderately severe', min: 15, max: 19, tone: 'red' },
    { id: 'severe', label: 'severe', min: 20, max: 27, tone: 'red' },
  ],
};

const FALLBACK_SCALE: ScaleSpec = {
  instrument: 'Score',
  instrumentLong: 'Score',
  min: 0,
  max: 25,
  higherIsBetter: true,
  target: 20,
  mcid: 3,
  bands: [{ id: 'unknown', label: 'score', min: 0, max: 25, tone: 'gray' }],
};

const SCALES: Record<string, ScaleSpec> = {
  asthma: ASTHMA_SCALE,
  depression: DEPRESSION_SCALE,
};

/** Derived from the real condition modules — see src/conditions/*.ts */
export function scaleForModule(moduleId: string): ScaleSpec {
  return SCALES[moduleId] ?? FALLBACK_SCALE;
}

/** Returns the band containing `total`, clamping out-of-range scores to the nearest edge band. */
export function bandForScore(scale: ScaleSpec, total: number): BandRegion {
  const clamped = Math.max(scale.min, Math.min(scale.max, total));
  for (const band of scale.bands) {
    if (clamped >= band.min && clamped <= band.max) return band;
  }
  // Should be unreachable if bands are contiguous + cover min..max, but fall
  // back to the nearest edge band rather than throwing.
  return clamped <= scale.bands[0].min ? scale.bands[0] : scale.bands[scale.bands.length - 1];
}
