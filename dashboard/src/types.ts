/**
 * Domain contracts for the CareLoop dashboard — a self-contained mirror of the
 * root project's src/types.ts (kept dependency-free so the dashboard package
 * stands alone).
 */

// ── Clinical domain ─────────────────────────────────────────────────────────

export type ActAnswer = {
  linkId: string;
  /** 1–5 */
  value: number;
};

export type ActBand = 'well' | 'partial' | 'poor';

export type ActResult = {
  answers: ActAnswer[];
  /** summed 5–25 */
  total: number;
  /** band id from the condition module (e.g. 'poor', 'moderate') */
  band: string;
  /** human-readable band label */
  bandLabel?: string;
};

export type ConcernNote = {
  id: string;
  text: string;
  /** ISO timestamp captured */
  at: string;
};

export type CoverageInfo = {
  payerId: string;
  payerName?: string;
  memberId: string;
  subscriberFirstName: string;
  subscriberLastName: string;
  /** YYYYMMDD */
  subscriberDob: string;
};

export type PatientContext = {
  patientId: string;
  conditionId: string;
  /** which ConditionModule drives this patient (e.g. 'asthma', 'depression') */
  conditionModuleId: string;
  appointmentId?: string;
  givenName: string;
  familyName: string;
  /** YYYY-MM-DD */
  dob: string;
  /** administrative sex, if recorded */
  sex?: string;
  /** home city/state, if recorded */
  city?: string;
  state?: string;
  /** ICD-10 code, e.g. 'J45.40' */
  conditionCode: string;
  conditionDisplay: string;
  currentMedications: string[];
  allergies: string[];
  triggers: string[];
  /** prior ACT scores, oldest→newest */
  priorActScores: { date: string; total: number }[];
  coverage?: CoverageInfo;
};

// ── Medication orders (multi-med plans) ─────────────────────────────────────

/** The clinical role a medication plays within a plan. */
export type MedRole = 'controller' | 'reliever' | 'rescue' | 'acute-course';

/** A single, structured medication order within a protocol step. */
export type MedOrder = {
  /** RxNorm concept id. */
  rxcui: string;
  /** human-readable drug name. */
  display: string;
  /** clinical role (controller / reliever / rescue / acute-course). */
  role?: MedRole;
  /** full sig / dosing instruction text. */
  sig?: string;
  /** dose amount text (e.g. "2 puffs"). */
  doseText?: string;
  route?: string;
  frequency?: string;
  durationDays?: number;
  quantity?: number;
  refills?: number;
  /** as-needed. */
  prn?: boolean;
};

/** Severity + category of a safety concern surfaced against a plan. */
export type SafetyFlag = {
  severity: 'info' | 'warning' | 'critical';
  kind: 'allergy' | 'interaction' | 'contraindication' | 'duplicate';
  message: string;
};

/** A derived GINA future-risk finding (from the supplemental risk questions). */
export type RiskFinding = {
  severity: 'info' | 'warning' | 'critical';
  label: string;
  detail: string;
};

// ── Clinical protocol (deterministic) ───────────────────────────────────────

export type ProtocolStep = {
  band: string;
  summary: string;
  /** structured multi-medication plan (source of truth). */
  medications: MedOrder[];
  /** legacy single-medication fields (kept for back-compat). */
  medRxcui: string;
  medDisplay: string;
  addOralSteroid: boolean;
  specialistReferral: boolean;
  followUpWeeks: number;
  escalate: boolean;
  goal: string;
};

// ── Condition module (treatment) authoring ──────────────────────────────────

/** A code drawn from a terminology system (ICD-10, SNOMED, LOINC, …). */
export type Coding = { system: string; code: string; display: string };

/** One question on an instrument (mirrors an ordinal LOINC item). */
export type InstrumentItem = {
  linkId: string;
  loinc: string;
  prompt: string;
  scale: string;
  min: number;
  max: number;
};

/** A scoring band mapped from the instrument total. */
export type ScoreBand = { id: string; label: string; min: number; max: number };

/** The deterministic protocol step recommended for a band. */
export type ProtocolStepDef = {
  bandId: string;
  summary: string;
  /** structured multi-medication plan (source of truth). */
  medications?: MedOrder[];
  /** legacy single-medication fields (kept for back-compat). */
  medRxcui: string;
  medDisplay: string;
  addOralSteroid?: boolean;
  specialistReferral?: boolean;
  followUpWeeks: number;
  escalate: boolean;
  goal: string;
};

/** One expert persona on the peer-review panel. */
export type ExpertPersona = { key: string; label: string; systemPrompt: string };

/** A single document in the Moss knowledge corpus. */
export type MossCorpusDoc = { id: string; text: string; source: string };

/** A full treatment definition — drives the entire intake→plan pipeline. */
export type ConditionModule = {
  id: string;
  label: string;
  conditionCodes: { icd10: Coding; snomed?: Coding };
  instrument: {
    name: string;
    panelLoinc: string;
    totalLoinc: string;
    items: InstrumentItem[];
    direction: 'higherIsBetter' | 'higherIsWorse';
    bands: ScoreBand[];
  };
  /** keyed by band id */
  protocol: Record<string, ProtocolStepDef>;
  moss: { indexName: string; corpus: MossCorpusDoc[] };
  agent: { globalPrompt: string };
  /** placeholders {{conditionDisplay}} {{triggers}} {{bandLabel}} {{total}} */
  researchTopicTemplate: string;
  expertPanel: ExpertPersona[];
  currentMedication?: { rxcui: string; display: string };
};

// ── Integration contracts ───────────────────────────────────────────────────

export type CoverageResult = {
  covered: boolean;
  priorAuthRequired: boolean;
  /** estimated out-of-pocket in USD */
  copayUsd: number;
  planName: string;
  notes: string;
};

// ── Research + expert review ────────────────────────────────────────────────

export type Citation = { title: string; url: string; note?: string };

export type ResearchFinding = {
  topic: string;
  rationale: string;
  citations: Citation[];
};

export type ExpertVerdict = 'agree' | 'concern' | 'suggest-edit';

export type ExpertReview = {
  /** persona key from the condition module (e.g. 'pulmonology', 'psychiatry') */
  expert: string;
  /** human-readable persona label */
  label?: string;
  verdict: ExpertVerdict;
  rationale: string;
  suggestedEdit?: string;
};

export type PeerReviewSummary = {
  reviews: ExpertReview[];
  consensus: 'approve-as-drafted' | 'approve-with-notes' | 'revise';
  flagged: string[];
};

// ── Draft plan the Bot produces ─────────────────────────────────────────────

export type DraftPlan = {
  patientId: string;
  conditionId: string;
  /** which ConditionModule this plan was built from */
  conditionModuleId: string;
  actResult: ActResult;
  step: ProtocolStep;
  replacesCarePlanId: string | null;
  concerns: ConcernNote[];
  research: ResearchFinding[];
  peerReview?: PeerReviewSummary;
  coverage?: CoverageResult;
  /** safety flags surfaced against the plan (allergy / interaction / etc). */
  safetyFlags?: SafetyFlag[];
  /** GINA future-risk findings from the supplemental risk questions. */
  riskFindings?: RiskFinding[];
  /** patient-facing recap of the call (plain language). */
  patientSummary?: string;
};

// ── Dashboard-only view models ──────────────────────────────────────────────

/** A live charting line (mirrors a Medplum Communication). */
export type ChartLine = {
  id: string;
  /** ISO timestamp */
  at: string;
  text: string;
  /** category shown as a small chip */
  kind: 'act' | 'concern' | 'qa' | 'system';
};

export type CarePlanStatus = 'draft' | 'active';

/** A draft CarePlan row synced live from Medplum for the selected patient. */
export type DraftCarePlanRow = {
  id: string;
  title: string;
  /** ISO timestamp (created or lastUpdated), empty if unknown */
  created: string;
  /** medication display, if the plan references one */
  med?: string;
};

/** One row in the cross-patient review queue (worklist). */
export type ReviewQueueRow = {
  carePlanId: string;
  patientId: string | null;
  treatment: string;
  medication: string;
  created: string;
  hasArtifact: boolean;
  conditionDisplay?: string;
  conditionModuleId?: string;
  conditionCode?: string;
  scoreTotal?: number;
  scoreBand?: string;
  scoreBandLabel?: string;
  priorScores?: { date: string; total: number }[];
  peerConsensus?: string;
  peerAgree?: number;
  peerTotal?: number;
  safetyCritical?: number;
  safetyWarning?: number;
  riskCritical?: number;
  researchCount?: number;
  copayUsd?: number;
  covered?: boolean;
  priorAuthRequired?: boolean;
  medicationCount?: number;
  patientSummary?: string;
  /** full detail (not just counts) — powers the plan preview modal */
  safetyFlags?: SafetyFlag[];
  /** full detail (not just counts) — powers the plan preview modal */
  riskFindings?: RiskFinding[];
};
