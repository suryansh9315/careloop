/**
 * Pure helpers for merging FHIR CarePlan rows with plan artifacts (testable).
 */
import type { DraftPlan, PatientContext, ReviewQueueRow } from './types';
import { bandForScore, scaleForModule } from './components/charts/scale';

export function medCountFromPlan(plan: DraftPlan): number {
  const list = plan.step.medications ?? [];
  if (list.length > 0) return list.length;
  if (plan.step.medDisplay || plan.step.medRxcui) return 1;
  return 0;
}

export function enrichQueueRow(
  base: Omit<ReviewQueueRow, 'hasArtifact'>,
  artifact: { patient: PatientContext; plan: DraftPlan } | null,
): ReviewQueueRow {
  if (!artifact) {
    return { ...base, hasArtifact: false };
  }
  const { patient, plan } = artifact;
  const peer = plan.peerReview;
  const agree = peer?.reviews.filter((r) => r.verdict === 'agree').length ?? 0;
  const flags = plan.safetyFlags ?? [];
  const risks = plan.riskFindings ?? [];
  return {
    ...base,
    hasArtifact: true,
    conditionDisplay: patient.conditionDisplay,
    conditionModuleId: plan.conditionModuleId || patient.conditionModuleId,
    conditionCode: patient.conditionCode,
    scoreTotal: plan.actResult.total,
    scoreBand: plan.actResult.band,
    scoreBandLabel: plan.actResult.bandLabel,
    priorScores: patient.priorActScores,
    peerConsensus: peer?.consensus,
    peerAgree: peer ? agree : undefined,
    peerTotal: peer?.reviews.length,
    safetyCritical: flags.filter((f) => f.severity === 'critical').length,
    safetyWarning: flags.filter((f) => f.severity === 'warning').length,
    riskCritical: risks.filter((f) => f.severity === 'critical').length,
    researchCount: plan.research.length,
    copayUsd: plan.coverage?.copayUsd,
    covered: plan.coverage?.covered,
    priorAuthRequired: plan.coverage?.priorAuthRequired,
    medicationCount: medCountFromPlan(plan),
    patientSummary: plan.patientSummary,
    safetyFlags: plan.safetyFlags,
    riskFindings: plan.riskFindings,
  };
}

export function queueRowNeedsAttention(r: ReviewQueueRow): boolean {
  return (
    (r.safetyCritical ?? 0) > 0 ||
    (r.riskCritical ?? 0) > 0 ||
    r.peerConsensus === 'revise'
  );
}

export function queueRowTrendPoints(r: ReviewQueueRow): { date: string; total: number }[] {
  if (r.priorScores && r.scoreTotal != null) {
    return [
      ...r.priorScores.map((s) => ({ date: s.date, total: s.total })),
      { date: 'today', total: r.scoreTotal },
    ];
  }
  if (r.scoreTotal != null) return [{ date: 'today', total: r.scoreTotal }];
  return [];
}

// ── Triage model ─────────────────────────────────────────────────────────────
// The queue's job is ranking, not listing: every row is scored into a
// clinical urgency level with the concrete reason(s) a clinician would care
// about, plus a single sortable `rank` (lower = more urgent).

export type TriageLevel = 'critical' | 'urgent' | 'routine';

export type TriageReason = { code: string; label: string };

export type Triage = { level: TriageLevel; reasons: TriageReason[]; rank: number };

const LEVEL_TIER: Record<TriageLevel, number> = { critical: 0, urgent: 1, routine: 2 };

/** Tier width large enough that severity + age components never bleed across levels. */
const TIER_SCALE = 1_000_000;
/** Severity bucket width — comfortably larger than any realistic severity magnitude. */
const SEVERITY_SCALE = 100;
const SEVERITY_CAP = 999;

export function triageQueueRow(r: ReviewQueueRow): Triage {
  const reasons: TriageReason[] = [];
  let level: TriageLevel = 'routine';
  let severity = 0;

  // Raises `level`/`severity` only when the new level is >= as urgent as the
  // current one — a later, less-urgent match still gets its reason recorded
  // above but must never soften an already-critical/urgent rank.
  const escalate = (next: TriageLevel, magnitude: number) => {
    if (LEVEL_TIER[next] < LEVEL_TIER[level]) {
      level = next;
      severity = magnitude;
    } else if (LEVEL_TIER[next] === LEVEL_TIER[level]) {
      severity = Math.max(severity, magnitude);
    }
  };

  const safetyCritical = r.safetyCritical ?? 0;
  if (safetyCritical > 0) {
    reasons.push({
      code: 'safety-critical',
      label: `${safetyCritical} critical safety flag${safetyCritical === 1 ? '' : 's'}`,
    });
    escalate('critical', safetyCritical);
  }

  const riskCritical = r.riskCritical ?? 0;
  if (riskCritical > 0) {
    reasons.push({
      code: 'risk-critical',
      label: `${riskCritical} critical risk finding${riskCritical === 1 ? '' : 's'}`,
    });
    escalate('critical', riskCritical);
  }

  if (r.peerConsensus === 'revise') {
    reasons.push({ code: 'peer-revise', label: 'Expert panel asked for revision' });
    escalate('urgent', 4);
  }

  const scale = r.conditionModuleId ? scaleForModule(r.conditionModuleId) : null;

  if (scale && r.scoreTotal != null) {
    const band = bandForScore(scale, r.scoreTotal);
    if (band.tone === 'red') {
      reasons.push({ code: 'score-red-band', label: band.label });
      const distance = scale.higherIsBetter ? scale.target - r.scoreTotal : r.scoreTotal - scale.target;
      escalate('urgent', Math.max(0, distance));
    } else if (band.tone === 'amber') {
      // An intermediate band is not urgent, but it is a live clinical finding
      // and must outrank routine paperwork: without this, a "not well
      // controlled" patient sorts below a fully-controlled one whose only flag
      // is a prior-auth, purely on age. Highest severity inside the routine
      // tier, so these lead the routine group.
      reasons.push({ code: 'score-amber-band', label: band.label });
      escalate('routine', 3);
    }
  }

  if (scale && r.scoreTotal != null && r.priorScores && r.priorScores.length > 0) {
    const previous = r.priorScores[r.priorScores.length - 1].total;
    const delta = r.scoreTotal - previous;
    // Direction-aware: for higher-is-better instruments (ACT) a DROP is a
    // decline; for higher-is-worse instruments (PHQ-9) a RISE is a decline.
    const worsened = scale.higherIsBetter ? delta < 0 : delta > 0;
    const magnitude = Math.abs(delta);
    if (worsened && magnitude >= scale.mcid) {
      reasons.push({
        code: 'trend-worsened',
        label: `Worsened ${magnitude} point${magnitude === 1 ? '' : 's'} since last check-in`,
      });
      escalate('urgent', magnitude);
    }
  }

  if (r.priorAuthRequired || r.covered === false) {
    reasons.push({ code: 'coverage', label: 'Coverage needs attention' });
    escalate('routine', 2);
  }

  if (!r.hasArtifact) {
    reasons.push({ code: 'no-artifact', label: 'Awaiting intake artifact' });
    escalate('routine', 1);
  }

  const tier = LEVEL_TIER[level];
  const severityBucket = SEVERITY_CAP - Math.min(SEVERITY_CAP, Math.max(0, Math.round(severity)));
  // Oldest-first tiebreak: a smaller (older) timestamp contributes a smaller,
  // sub-bucket fraction so it only ever breaks ties within the same
  // level+severity bucket, never crosses a bucket boundary.
  const ageMillis = Date.parse(r.created);
  const ageComponent = Number.isNaN(ageMillis) ? 0 : ageMillis * 1e-13;

  const rank = tier * TIER_SCALE + severityBucket * SEVERITY_SCALE + ageComponent;

  return { level, reasons, rank };
}
