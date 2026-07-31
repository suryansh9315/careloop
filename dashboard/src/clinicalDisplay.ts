/**
 * Shared clinical display constants and helpers for score instruments,
 * control bands, and peer-review labels (Review + Review queue).
 */
import type { Tone } from './components/ui';
import type { DraftPlan, PatientContext } from './types';

export { scaleForModule } from './components/charts/scale';

export const INSTRUMENT_LABEL: Record<string, string> = {
  asthma: 'ACT',
  depression: 'PHQ-9',
};

export const BAND_LABEL: Record<string, string> = {
  well: 'Well controlled',
  partial: 'Not well controlled',
  poor: 'Very poorly controlled',
};

export const TREND_CONFIG: Record<
  string,
  { min: number; max: number; threshold: number; higherIsBetter: boolean }
> = {
  asthma: { min: 5, max: 25, threshold: 20, higherIsBetter: true },
  depression: { min: 0, max: 27, threshold: 10, higherIsBetter: false },
};

export const BAND_TONE: Record<string, Tone> = {
  well: 'green',
  minimal: 'green',
  mild: 'green',
  partial: 'amber',
  moderate: 'amber',
  poor: 'red',
  'moderately-severe': 'red',
  severe: 'red',
};

export const CONSENSUS_LABEL: Record<string, string> = {
  'approve-as-drafted': 'Approve as drafted',
  'approve-with-notes': 'Approve with notes',
  revise: 'Revise before approval',
};

export const CONSENSUS_TONE: Record<string, Tone> = {
  'approve-as-drafted': 'green',
  'approve-with-notes': 'amber',
  revise: 'red',
};

export function trendConfigForModule(moduleId: string) {
  return (
    TREND_CONFIG[moduleId] ?? {
      min: 0,
      max: 25,
      threshold: 20,
      higherIsBetter: true,
    }
  );
}

export function instrumentForModule(moduleId: string): string {
  return INSTRUMENT_LABEL[moduleId] ?? 'Score';
}

/** Prior scores + today's total, oldest → newest. */
export function trendPointsFromPlan(
  patient: PatientContext,
  plan: DraftPlan,
): { date: string; total: number }[] {
  return [
    ...patient.priorActScores.map((s) => ({ date: s.date, total: s.total })),
    { date: 'today', total: plan.actResult.total },
  ];
}

export function bandLabel(plan: DraftPlan): string {
  return plan.actResult.bandLabel ?? BAND_LABEL[plan.actResult.band] ?? plan.actResult.band;
}
