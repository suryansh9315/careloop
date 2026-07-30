import type { ActAnswer, ActBand, ActResult } from '../types.js';
import { ACT_LOINC } from './codes.js';

/**
 * The Asthma Control Test as an ordered set of voice-administrable items.
 * Each item is 1–5 (higher = better control); total 5–25.
 * Answer option text is what the agent reads; `value` is the score.
 */

export type ActItem = {
  linkId: string;
  loinc: string;
  /** the question the agent asks */
  prompt: string;
  /** answer scale label shown to the agent (5 = best) */
  scale: string;
};

export const ACT_ITEMS: ActItem[] = [
  {
    linkId: 'act1',
    loinc: ACT_LOINC.items.act1.code,
    prompt:
      'In the past 4 weeks, how much of the time did your asthma keep you from getting as much done at work, school, or at home?',
    scale: '1 = all of the time … 5 = none of the time',
  },
  {
    linkId: 'act2',
    loinc: ACT_LOINC.items.act2.code,
    prompt: 'During the past 4 weeks, how often have you had shortness of breath?',
    scale: '1 = more than once a day … 5 = not at all',
  },
  {
    linkId: 'act3',
    loinc: ACT_LOINC.items.act3.code,
    prompt:
      'During the past 4 weeks, how often did your asthma symptoms wake you up at night or earlier than usual in the morning?',
    scale: '1 = 4+ nights a week … 5 = not at all',
  },
  {
    linkId: 'act4',
    loinc: ACT_LOINC.items.act4.code,
    prompt: 'During the past 4 weeks, how often have you used your rescue inhaler or nebulizer?',
    scale: '1 = 3+ times per day … 5 = not at all',
  },
  {
    linkId: 'act5',
    loinc: ACT_LOINC.items.act5.code,
    prompt: 'How would you rate your asthma control during the past 4 weeks?',
    scale: '1 = not controlled at all … 5 = completely controlled',
  },
];

export const ACT_LINK_IDS = ACT_ITEMS.map((i) => i.linkId);

/** Band thresholds: ≥20 well · 16–19 partial · ≤15 poor. */
export function bandForScore(total: number): ActBand {
  if (total >= 20) return 'well';
  if (total >= 16) return 'partial';
  return 'poor';
}

/** Score a set of ACT answers into a total + control band. */
export function scoreAct(answers: ActAnswer[]): ActResult {
  const byId = new Map(answers.map((a) => [a.linkId, clamp(a.value)]));
  let total = 0;
  for (const id of ACT_LINK_IDS) total += byId.get(id) ?? 0;
  return { answers, total, band: bandForScore(total) };
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(1, Math.min(5, Math.round(v)));
}

export function bandLabel(band: ActBand): string {
  return band === 'well'
    ? 'well controlled'
    : band === 'partial'
      ? 'not well controlled'
      : 'very poorly controlled';
}
