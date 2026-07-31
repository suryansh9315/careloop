import { describe, expect, it } from 'vitest';
import {
  enrichQueueRow,
  queueRowNeedsAttention,
  queueRowTrendPoints,
  triageQueueRow,
} from './reviewQueueEnrich';
import type { DraftPlan, PatientContext, ReviewQueueRow } from './types';

const base = {
  carePlanId: 'cp-1',
  patientId: 'p-1',
  treatment: 'Asthma',
  medication: 'Fluticasone',
  created: '2026-01-01T00:00:00Z',
};

const patient: PatientContext = {
  patientId: 'p-1',
  conditionId: 'c-1',
  conditionModuleId: 'asthma',
  givenName: 'A',
  familyName: 'B',
  dob: '1990-01-01',
  conditionCode: 'J45.40',
  conditionDisplay: 'Moderate persistent asthma',
  currentMedications: [],
  allergies: [],
  triggers: [],
  priorActScores: [
    { date: '2025-12-01', total: 14 },
    { date: '2026-01-01', total: 16 },
  ],
};

const plan: DraftPlan = {
  patientId: 'p-1',
  conditionId: 'c-1',
  conditionModuleId: 'asthma',
  actResult: { answers: [], total: 18, band: 'partial', bandLabel: 'Not well controlled' },
  step: {
    band: 'partial',
    summary: '',
    medications: [{ rxcui: '1', display: 'Fluticasone' }],
    medRxcui: '1',
    medDisplay: 'Fluticasone',
    addOralSteroid: false,
    specialistReferral: false,
    followUpWeeks: 4,
    escalate: false,
    goal: 'Control',
  },
  replacesCarePlanId: null,
  concerns: [],
  research: [{ topic: 't', rationale: 'r', citations: [] }],
  peerReview: {
    consensus: 'revise',
    flagged: [],
    reviews: [
      { expert: 'a', verdict: 'agree', rationale: 'ok' },
      { expert: 'b', verdict: 'concern', rationale: 'no' },
    ],
  },
  coverage: { covered: true, priorAuthRequired: false, copayUsd: 25, planName: 'PPO', notes: '' },
  safetyFlags: [{ severity: 'critical', kind: 'allergy', message: 'penicillin' }],
  patientSummary: 'We discussed your asthma control.',
};

describe('enrichQueueRow', () => {
  it('returns hasArtifact false when no artifact', () => {
    const row = enrichQueueRow(base, null);
    expect(row.hasArtifact).toBe(false);
    expect(row.scoreTotal).toBeUndefined();
  });

  it('maps artifact fields onto the queue row', () => {
    const row = enrichQueueRow(base, { patient, plan });
    expect(row.hasArtifact).toBe(true);
    expect(row.scoreTotal).toBe(18);
    expect(row.peerConsensus).toBe('revise');
    expect(row.peerAgree).toBe(1);
    expect(row.peerTotal).toBe(2);
    expect(row.safetyCritical).toBe(1);
    expect(row.researchCount).toBe(1);
    expect(row.copayUsd).toBe(25);
    expect(row.medicationCount).toBe(1);
    expect(row.safetyFlags).toHaveLength(1);
    expect(row.safetyFlags?.[0].message).toBe('penicillin');
  });
});

describe('queueRowNeedsAttention', () => {
  it('flags revise consensus and critical safety', () => {
    const row = enrichQueueRow(base, { patient, plan });
    expect(queueRowNeedsAttention(row)).toBe(true);
  });
});

describe('queueRowTrendPoints', () => {
  it('appends today when prior scores exist', () => {
    const row = enrichQueueRow(base, { patient, plan });
    const pts = queueRowTrendPoints(row);
    expect(pts).toHaveLength(3);
    expect(pts[pts.length - 1]).toEqual({ date: 'today', total: 18 });
  });
});

// ── Triage model ─────────────────────────────────────────────────────────────

function row(overrides: Partial<ReviewQueueRow>): ReviewQueueRow {
  return {
    carePlanId: 'cp-x',
    patientId: 'p-x',
    treatment: 'Asthma',
    medication: 'Fluticasone',
    created: '2026-01-01T00:00:00Z',
    hasArtifact: true,
    conditionModuleId: 'asthma',
    ...overrides,
  };
}

describe('triageQueueRow — level precedence', () => {
  it('is routine with no reasons when nothing is wrong', () => {
    const t = triageQueueRow(row({ scoreTotal: 22 }));
    expect(t.level).toBe('routine');
    expect(t.reasons).toHaveLength(0);
  });

  it('a critical safety flag outranks an urgent peer-revise and a routine coverage issue', () => {
    const t = triageQueueRow(
      row({
        safetyCritical: 1,
        peerConsensus: 'revise',
        priorAuthRequired: true,
      }),
    );
    expect(t.level).toBe('critical');
  });

  it('a red-band score is urgent even without any critical flags', () => {
    const t = triageQueueRow(row({ scoreTotal: 10 })); // ACT 10 -> 'poor' (red)
    expect(t.level).toBe('urgent');
  });

  it('coverage / missing-artifact issues alone are only routine', () => {
    const t = triageQueueRow(row({ scoreTotal: 22, priorAuthRequired: true }));
    expect(t.level).toBe('routine');
  });
});

describe('triageQueueRow — multi-reason collection', () => {
  it('collects every matching reason regardless of level', () => {
    const t = triageQueueRow(
      row({
        safetyCritical: 2,
        peerConsensus: 'revise',
        scoreTotal: 10, // red band too
        priorAuthRequired: true,
      }),
    );
    const codes = t.reasons.map((r) => r.code).sort();
    expect(codes).toEqual(['coverage', 'peer-revise', 'safety-critical', 'score-red-band'].sort());
    expect(t.level).toBe('critical'); // still dominated by the highest matched level
  });

  it('produces clinician-facing labels, not just codes', () => {
    const t = triageQueueRow(row({ safetyCritical: 3 }));
    expect(t.reasons[0].label).toBe('3 critical safety flags');
  });
});

describe('triageQueueRow — rank ordering', () => {
  it('ranks critical below (more urgent than) urgent below routine', () => {
    const critical = triageQueueRow(row({ safetyCritical: 1 }));
    const urgent = triageQueueRow(row({ peerConsensus: 'revise' }));
    const routine = triageQueueRow(row({ priorAuthRequired: true }));
    expect(critical.rank).toBeLessThan(urgent.rank);
    expect(urgent.rank).toBeLessThan(routine.rank);
  });

  it('ranks more critical-flag rows ahead of fewer, within the same level', () => {
    const many = triageQueueRow(row({ safetyCritical: 5 }));
    const few = triageQueueRow(row({ safetyCritical: 1 }));
    expect(many.rank).toBeLessThan(few.rank);
  });

  it('breaks exact ties oldest-first so a waiting plan does not sink', () => {
    const older = triageQueueRow(row({ safetyCritical: 1, created: '2025-01-01T00:00:00Z' }));
    const newer = triageQueueRow(row({ safetyCritical: 1, created: '2026-01-01T00:00:00Z' }));
    expect(older.rank).toBeLessThan(newer.rank);
  });

  it('ranks an intermediate control band above routine paperwork and above a controlled patient', () => {
    // ACT 17 → "not well controlled" (amber). Even though it is not urgent, a
    // live clinical finding must outrank a prior-auth, and must not lose to a
    // fully-controlled patient just for being newer.
    const notWellControlled = triageQueueRow(
      row({ scoreTotal: 17, created: '2026-06-01T00:00:00Z' }),
    );
    const priorAuthOnly = triageQueueRow(
      row({ scoreTotal: 22, priorAuthRequired: true, created: '2026-01-01T00:00:00Z' }),
    );
    const wellControlled = triageQueueRow(
      row({ scoreTotal: 23, created: '2025-01-01T00:00:00Z' }),
    );

    expect(notWellControlled.level).toBe('routine');
    expect(notWellControlled.reasons.map((r) => r.code)).toContain('score-amber-band');
    expect(notWellControlled.rank).toBeLessThan(priorAuthOnly.rank);
    expect(priorAuthOnly.rank).toBeLessThan(wellControlled.rank);
  });

  it('does not flag a well-controlled band as a triage reason', () => {
    expect(triageQueueRow(row({ scoreTotal: 23 })).reasons).toHaveLength(0);
    // PHQ-9 5 is "mild", a green-tone band — also not a finding.
    expect(
      triageQueueRow(row({ conditionModuleId: 'depression', scoreTotal: 5 })).reasons,
    ).toHaveLength(0);
  });
});

describe('triageQueueRow — trend direction (both instruments)', () => {
  it('ACT (higher is better): a DROP since last check-in is a decline', () => {
    const t = triageQueueRow(
      row({
        conditionModuleId: 'asthma',
        scoreTotal: 17, // still amber, not red-banded
        priorScores: [{ date: '2025-12-01', total: 22 }], // dropped 5, MCID is 3
      }),
    );
    expect(t.reasons.some((r) => r.code === 'trend-worsened')).toBe(true);
    expect(t.level).toBe('urgent');
  });

  it('ACT: a RISE since last check-in is improvement, not a decline', () => {
    const t = triageQueueRow(
      row({
        conditionModuleId: 'asthma',
        scoreTotal: 22,
        priorScores: [{ date: '2025-12-01', total: 17 }], // rose 5 — improving
      }),
    );
    expect(t.reasons.some((r) => r.code === 'trend-worsened')).toBe(false);
  });

  it('PHQ-9 (higher is worse): a RISE since last check-in is a decline', () => {
    const t = triageQueueRow(
      row({
        conditionModuleId: 'depression',
        scoreTotal: 12, // moderate, amber — not itself red-banded
        priorScores: [{ date: '2025-12-01', total: 4 }], // rose 8, MCID is 5
      }),
    );
    expect(t.reasons.some((r) => r.code === 'trend-worsened')).toBe(true);
    expect(t.level).toBe('urgent');
  });

  it('PHQ-9: a DROP since last check-in is improvement, not a decline (the classic backwards bug)', () => {
    const t = triageQueueRow(
      row({
        conditionModuleId: 'depression',
        scoreTotal: 4,
        priorScores: [{ date: '2025-12-01', total: 12 }], // dropped 8 — improving
      }),
    );
    expect(t.reasons.some((r) => r.code === 'trend-worsened')).toBe(false);
  });

  it('a change smaller than the MCID is not flagged as worsening', () => {
    const t = triageQueueRow(
      row({
        conditionModuleId: 'asthma',
        scoreTotal: 21,
        priorScores: [{ date: '2025-12-01', total: 22 }], // dropped 1, MCID is 3
      }),
    );
    expect(t.reasons.some((r) => r.code === 'trend-worsened')).toBe(false);
  });
});
