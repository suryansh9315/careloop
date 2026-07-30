import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import type { RiskAnswer, RiskFinding } from '../types.js';

/**
 * Deterministic GINA "future-risk" derivation from the supplemental risk
 * questions (exacerbation history, reliever overuse, controller adherence) that
 * the ACT control score misses. Pure, no I/O. Rules keyed by condition module id;
 * only asthma has rules today (others return no findings).
 *
 * ⚠️ Decision support with transparent thresholds — a clinician still reviews.
 * Thresholds reflect GINA (SABA ≥1 canister/month → mortality signal; a prior
 * exacerbation is the strongest predictor of the next).
 */

/** Read the charted risk answers back out of a QuestionnaireResponse. */
export function extractRiskAnswers(qr: QuestionnaireResponse): RiskAnswer[] {
  const out: RiskAnswer[] = [];
  for (const item of qr.item ?? []) {
    if (!item.linkId?.startsWith('risk-')) continue;
    const value = item.answer?.[0]?.valueInteger;
    if (typeof value !== 'number') continue;
    out.push({ id: item.linkId.slice('risk-'.length), value, note: item.text });
  }
  return out;
}

/** Derive risk findings for a module from its risk answers. */
export function deriveRiskFindings(moduleId: string, answers: RiskAnswer[]): RiskFinding[] {
  if (moduleId !== 'asthma') return [];
  const by = new Map(answers.map((a) => [a.id, a]));
  const findings: RiskFinding[] = [];

  // 1. Exacerbation history (last 12 months) — strongest predictor of the next.
  const exac = by.get('exacerbations');
  if (exac) {
    const note = (exac.note ?? '').toLowerCase();
    const hospital = /hospital|admit|icu|intubat|ventilat/.test(note);
    const ed = /\b(er|ed|emergency)\b/.test(note);
    if (hospital) {
      findings.push({ severity: 'critical', label: 'Recent hospitalization for asthma', detail: 'Reported inpatient/ICU care in the last year — high risk of a future severe exacerbation; expedite review.' });
    } else if (exac.value >= 2) {
      findings.push({ severity: 'critical', label: 'Recurrent exacerbations', detail: `~${exac.value} oral-steroid courses in the last 12 months — markedly elevated future-exacerbation risk (OR rises steeply with each course).` });
    } else if (exac.value >= 1 || ed) {
      findings.push({ severity: 'warning', label: 'Exacerbation in last 12 months', detail: `${ed ? 'ER visit / ' : ''}~${Math.max(1, exac.value)} steroid course — a prior exacerbation ≈2.5× the odds of the next.` });
    }
  }

  // 2. Reliever (SABA) overuse — GINA: ≥1 canister/month signals mortality risk.
  const rel = by.get('reliever');
  if (rel) {
    if (rel.value >= 2) {
      findings.push({ severity: 'critical', label: 'Reliever overuse', detail: 'Multiple rescue canisters per month / near-daily use — associated with increased mortality even on a controller (GINA). Prioritize controller + technique review.' });
    } else if (rel.value === 1) {
      findings.push({ severity: 'warning', label: 'Frequent reliever use', detail: '≈1 rescue canister/month — at the GINA overuse threshold linked to severe-exacerbation risk.' });
    }
  }

  // 3. Controller adherence — commonest fixable cause of "uncontrolled" asthma.
  const adh = by.get('adherence');
  if (adh) {
    if (adh.value <= 3) {
      findings.push({ severity: 'warning', label: 'Low controller adherence', detail: `Controller taken ~${adh.value}/7 days — check adherence and technique before stepping up therapy (GINA).` });
    } else if (adh.value <= 5) {
      findings.push({ severity: 'info', label: 'Partial controller adherence', detail: `Controller taken ~${adh.value}/7 days — reinforce daily use.` });
    }
  }

  return findings;
}

/** True when any finding warrants expediting care-team review. */
export function riskWarrantsEscalation(findings: RiskFinding[]): boolean {
  return findings.some((f) => f.severity === 'critical');
}
