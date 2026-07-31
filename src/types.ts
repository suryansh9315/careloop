/**
 * Shared domain + orchestration contracts for CareLoop.
 *
 * Every module builds against this file. Keep it dependency-free (no imports from
 * integrations) so it can be imported anywhere — bridge, bot, workers, dashboard.
 */

// ────────────────────────────────────────────────────────────────────────────
// Clinical domain
// ────────────────────────────────────────────────────────────────────────────

/** A single ACT answer captured during the call. */
export type ActAnswer = {
  /** questionnaire linkId, e.g. 'act1' */
  linkId: string;
  /** 1–5 */
  value: number;
};

export type ActBand = 'well' | 'partial' | 'poor';

export type ActResult = {
  answers: ActAnswer[];
  /** summed instrument total */
  total: number;
  /** band id from the condition module (e.g. 'poor', 'moderate') */
  band: string;
  /** human-readable band label */
  bandLabel?: string;
};

/** A free-text health concern the patient raised beyond the structured ACT. */
export type ConcernNote = {
  id: string;
  text: string;
  /** ISO timestamp captured */
  at: string;
};

/**
 * Patient context injected into the agent at call start (history-aware) and
 * carried through the pipeline. Read from Medplum; never invented by the model.
 */
export type PatientContext = {
  patientId: string;
  conditionId: string;
  /** which ConditionModule drives this patient (e.g. 'asthma', 'depression') */
  conditionModuleId: string;
  appointmentId?: string;
  givenName: string;
  familyName: string;
  /** YYYY-MM-DD, used for identity verification */
  dob: string;
  /** administrative sex, if recorded (e.g. 'female') */
  sex?: string;
  /** home city/state, if recorded, for the clinical snapshot */
  city?: string;
  state?: string;
  /** ICD-10 code of the anchor condition, e.g. 'J45.40' */
  conditionCode: string;
  conditionDisplay: string;
  /** current controller/reliever medications, human-readable */
  currentMedications: string[];
  allergies: string[];
  triggers: string[];
  /** prior instrument total scores, oldest→newest, for the recap + trend viz */
  priorActScores: { date: string; total: number }[];
  /** insurance for the Stedi eligibility check (from the patient's Coverage) */
  coverage?: CoverageInfo;
};

/** Insurance details captured at patient creation → drives the Stedi 270. */
export type CoverageInfo = {
  /** Stedi tradingPartnerServiceId, e.g. '87726' */
  payerId: string;
  payerName?: string;
  memberId: string;
  subscriberFirstName: string;
  subscriberLastName: string;
  /** YYYYMMDD */
  subscriberDob: string;
};

// ────────────────────────────────────────────────────────────────────────────
// Clinical protocol (deterministic)
// ────────────────────────────────────────────────────────────────────────────

/** The plan template the Bot instantiates for a given ACT band. */
/** One structured, coded medication order in a plan. */
export type MedOrder = {
  rxcui: string;
  display: string;
  /** role in the regimen (drives grouping/labels) */
  role?: 'controller' | 'reliever' | 'rescue' | 'acute-course' | 'adjunct' | 'other';
  /** human-readable sig, e.g. "Inhale 2 puffs twice daily" */
  sig?: string;
  doseText?: string; // e.g. "160/4.5 mcg"
  route?: string; // e.g. "inhalation", "oral"
  frequency?: string; // e.g. "twice daily", "as needed"
  durationDays?: number; // time-limited course (e.g. oral steroid)
  quantity?: number; // dispense quantity
  refills?: number;
  prn?: boolean; // as-needed
};

/** A safety finding on the drafted regimen; `critical` gates approval. */
export type SafetyFlag = {
  severity: 'info' | 'warning' | 'critical';
  kind: 'allergy' | 'interaction' | 'contraindication' | 'duplicate';
  message: string;
};

/**
 * A supplemental, NON-scored intake question capturing GINA "future-risk" and
 * modifiable factors the control instrument (ACT) misses (exacerbation history,
 * reliever overuse, adherence). The agent asks it, maps the answer to `value`,
 * and charts it; deterministic rules turn answers into RiskFindings post-call.
 */
export type RiskQuestion = {
  /** stable id, e.g. 'exacerbations' */
  id: string;
  /** what the agent asks */
  prompt: string;
  /** how the agent should encode the spoken answer into an integer `value` */
  encoding: string;
};

/** A patient's answer to a RiskQuestion (charted during the call). */
export type RiskAnswer = {
  id: string;
  /** integer encoding per the question's `encoding` guidance */
  value: number;
  /** the patient's own words */
  note?: string;
};

/** A derived future-risk finding surfaced to the clinician (does not gate approval). */
export type RiskFinding = {
  severity: 'info' | 'warning' | 'critical';
  /** short label, e.g. 'Reliever overuse' */
  label: string;
  /** one-line clinical detail + rationale */
  detail: string;
};

export type ProtocolStep = {
  /** band id from the condition module */
  band: string;
  summary: string;
  /** the structured medication regimen (may be empty, e.g. watchful waiting) */
  medications: MedOrder[];
  /** primary med (= medications[0]) — kept for coverage + legacy readers */
  medRxcui: string;
  medDisplay: string;
  addOralSteroid: boolean;
  specialistReferral: boolean;
  followUpWeeks: number;
  /** true → create an urgent Task for the care team */
  escalate: boolean;
  /** patient-facing goal text */
  goal: string;
};

// ────────────────────────────────────────────────────────────────────────────
// Flow spec (2care-style conversation graph)
// ────────────────────────────────────────────────────────────────────────────

export type ToolName = 'getCareContext' | 'chartLive' | 'submitQuestionnaire' | 'checkCoverage' | 'endCall';

export type NodeType = 'conversation' | 'subagent' | 'end';

export type FlowEdge = {
  to: string;
  /** natural-language transition condition the LLM/router evaluates */
  when: string;
};

export type FlowNode = {
  id: string;
  type: NodeType;
  /** instruction shown to the agent for this node */
  instruction: string;
  /** tools exposed ONLY at this node (per-node gating). Empty for conversation/end. */
  allowedTools: ToolName[];
  edges: FlowEdge[];
};

export type FlowSpec = {
  id: string;
  /** persona + global rules (emergency override, style) applied at every node */
  globalPrompt: string;
  startNode: string;
  nodes: FlowNode[];
};

// ────────────────────────────────────────────────────────────────────────────
// Tools (own-server function calls invoked by the voice agent)
// ────────────────────────────────────────────────────────────────────────────

/** Context recovered on every tool call (mirrors 2care resolveCallContext). */
export type CallContext = {
  callId: string;
  patient: PatientContext;
};

export type ToolResult = {
  ok: boolean;
  /** structured payload returned to the agent (mapped into its response variables) */
  data?: Record<string, unknown>;
  /** spoken/summary string for the agent, when useful */
  say?: string;
  error?: string;
};

/** JSON-schema-ish parameter description for exposing a tool to Deepgram. */
export type ToolSchema = {
  name: ToolName;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
};

// ────────────────────────────────────────────────────────────────────────────
// Integration contracts (implemented in src/integrations, mockable)
// ────────────────────────────────────────────────────────────────────────────

export type MossSnippet = {
  text: string;
  source: string;
  score: number;
};

export interface MossClient {
  /** mid-call grounding: retrieve a patient-safe snippet for a question */
  retrieve(query: string, opts?: { k?: number }): Promise<MossSnippet[]>;
}

export type CoverageResult = {
  covered: boolean;
  priorAuthRequired: boolean;
  /** estimated out-of-pocket in USD */
  copayUsd: number;
  planName: string;
  notes: string;
};

export interface CoverageClient {
  checkMedication(input: {
    patientId: string;
    rxcui: string;
    medDisplay: string;
    /** patient's insurance; when present the 270 is built from it (else env test defaults) */
    coverage?: CoverageInfo;
  }): Promise<CoverageResult>;
}

// ────────────────────────────────────────────────────────────────────────────
// Research + expert review (post-call workers)
// ────────────────────────────────────────────────────────────────────────────

export type Citation = { title: string; url: string; note?: string };

export type ResearchFinding = {
  /** what was researched: the condition phenotype or an open concern */
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

// ────────────────────────────────────────────────────────────────────────────
// The draft plan the Bot produces (before it is written as FHIR)
// ────────────────────────────────────────────────────────────────────────────

export type DraftPlan = {
  patientId: string;
  conditionId: string;
  /** which ConditionModule this plan was built from */
  conditionModuleId: string;
  actResult: ActResult;
  step: ProtocolStep;
  /** null when creating a brand-new plan; set when revising an existing active plan */
  replacesCarePlanId: string | null;
  concerns: ConcernNote[];
  research: ResearchFinding[];
  peerReview?: PeerReviewSummary;
  coverage?: CoverageResult;
  /** medication safety checks; a `critical` flag gates one-click approval */
  safetyFlags?: SafetyFlag[];
  /** GINA future-risk findings derived from the supplemental risk questions */
  riskFindings?: RiskFinding[];
  /** a short, patient-facing recap of the call (plain language) */
  patientSummary?: string;
};
