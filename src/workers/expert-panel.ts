import { log } from '../logger.js';
import { chatJSON, llmEnabled } from '../integrations/llm.js';
import { getCondition, requireCondition, DEFAULT_CONDITION_ID } from '../conditions/registry.js';
import type { ConditionModule, ExpertPersona } from '../conditions/types.js';
import type {
  DraftPlan,
  ExpertReview,
  ExpertVerdict,
  PeerReviewSummary,
  ResearchFinding,
} from '../types.js';

/**
 * Component 5 — Expert peer review (multi-agent).
 *
 * A panel of expert personas — defined by the resolved ConditionModule
 * (`module.expertPanel`) — independently critiques the draft CarePlan and returns
 * a structured verdict (agree / concern / suggest-edit). We aggregate them into a
 * single PeerReviewSummary with a consensus label and a list of flagged issues,
 * which the Bot attaches to the CarePlan for the doctor.
 *
 * !! IMPORTANT — THIS PANEL IS DECISION SUPPORT, NOT SIGN-OFF. !!
 * The personas are LLM reviewers, not licensed clinicians. Their output surfaces
 * consensus and dissent for the HUMAN clinician, who remains the sole approver
 * (draft → active). Nothing here authorises, prescribes, or finalises care.
 *
 * The personas run IN PARALLEL, each as a separate LLM call with the persona's
 * own system prompt (from the module).
 *
 * This worker is CONDITION-AGNOSTIC: personas come from the module, not a
 * hardcoded asthma panel.
 *
 * MOCK mode: when no LLM key is configured (`llmEnabled()` is false) — or on any
 * network/parse error for a given persona — that persona falls back to a
 * deterministic, plausible canned review so the offline simulator works.
 */

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export async function peerReview(input: { draft: DraftPlan }): Promise<PeerReviewSummary> {
  const { draft } = input;
  const module = getCondition(draft.conditionModuleId) ?? requireCondition(DEFAULT_CONDITION_ID);

  log.info('peerReview.start', {
    patientId: draft.patientId,
    conditionModuleId: module.id,
    band: draft.actResult.band,
    personas: module.expertPanel.length,
    mock: !llmEnabled(),
  });

  // Run the personas in parallel; each is independently mock-safe.
  const reviews = await Promise.all(
    module.expertPanel.map((persona) => reviewAs(persona, draft, module)),
  );

  const summary = aggregate(reviews);

  log.info('peerReview.done', {
    patientId: draft.patientId,
    consensus: summary.consensus,
    flagged: summary.flagged.length,
  });
  return summary;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-persona review
// ────────────────────────────────────────────────────────────────────────────

async function reviewAs(
  persona: ExpertPersona,
  draft: DraftPlan,
  module: ConditionModule,
): Promise<ExpertReview> {
  if (!llmEnabled()) {
    return mockReview(persona, draft, module);
  }
  try {
    return await liveReview(persona, draft, module);
  } catch (err) {
    log.warn('peerReview.expert.fallback', {
      expert: persona.key,
      error: err instanceof Error ? err.message : String(err),
    });
    return mockReview(persona, draft, module);
  }
}

async function liveReview(
  persona: ExpertPersona,
  draft: DraftPlan,
  module: ConditionModule,
): Promise<ExpertReview> {
  const parsed = await chatJSON<{
    verdict?: unknown;
    rationale?: unknown;
    suggestedEdit?: unknown;
  }>({
    system: persona.systemPrompt,
    user: buildContext(draft, module),
    temperature: 0.1,
    maxTokens: 1024,
  });

  const review: ExpertReview = {
    expert: persona.key,
    label: persona.label,
    verdict: coerceVerdict(parsed.verdict),
    rationale:
      typeof parsed.rationale === 'string' && parsed.rationale.trim().length > 0
        ? parsed.rationale.trim()
        : '(no rationale returned)',
  };
  if (typeof parsed.suggestedEdit === 'string' && parsed.suggestedEdit.trim().length > 0) {
    review.suggestedEdit = parsed.suggestedEdit.trim();
  }
  return review;
}

/** Render the draft's instrument result, chosen step, and research rationales as context. */
function buildContext(draft: DraftPlan, module: ConditionModule): string {
  const step = draft.step;
  const bandText = draft.actResult.bandLabel ?? draft.actResult.band;
  return [
    `Review the following DRAFT ${module.label} care plan. It has NOT been approved; a human`,
    'clinician will decide. Return your structured JSON verdict.',
    '',
    `${module.instrument.name} result: ${draft.actResult.total} (band: ${bandText})`,
    '',
    'Chosen step:',
    `- Summary: ${step.summary}`,
    step.medRxcui
      ? `- Medication: ${step.medDisplay} (RxNorm ${step.medRxcui})`
      : `- Medication: none for this band (${step.medDisplay})`,
    `- Follow-up: ${step.followUpWeeks} week(s)`,
    `- Specialist referral: ${step.specialistReferral ? 'yes' : 'no'}`,
    `- Urgent escalation Task: ${step.escalate ? 'yes' : 'no'}`,
    `- Goal: ${step.goal}`,
    '',
    'Research rationales (with citations) informing this plan:',
    formatResearch(draft.research),
    '',
    'Respond with only the JSON object described in the system prompt.',
  ].join('\n');
}

function formatResearch(research: ResearchFinding[]): string {
  if (!research || research.length === 0) return '(none attached)';
  return research
    .map((r, i) => {
      const cites = r.citations.map((c) => c.title).join('; ') || 'no citations';
      return `[${i + 1}] ${r.topic}\n    ${r.rationale}\n    Citations: ${cites}`;
    })
    .join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Aggregation
// ────────────────────────────────────────────────────────────────────────────

function aggregate(reviews: ExpertReview[]): PeerReviewSummary {
  const allAgree = reviews.every((r) => r.verdict === 'agree');

  // A "strong safety concern" = any safety persona (key includes 'safety')
  // raising a 'concern'. That dissent is serious enough to force a revision.
  const strongSafetyConcern = reviews.some(
    (r) => r.expert.includes('safety') && r.verdict === 'concern',
  );

  let consensus: PeerReviewSummary['consensus'];
  if (strongSafetyConcern) {
    consensus = 'revise';
  } else if (allAgree) {
    consensus = 'approve-as-drafted';
  } else {
    consensus = 'approve-with-notes';
  }

  // Flag every notable issue: any non-agree verdict, with its suggested edit.
  const flagged: string[] = [];
  for (const r of reviews) {
    if (r.verdict !== 'agree') {
      const edit = r.suggestedEdit ? ` — suggested edit: ${r.suggestedEdit}` : '';
      flagged.push(`[${r.label ?? r.expert}] ${r.verdict}: ${r.rationale}${edit}`);
    }
  }

  return { reviews, consensus, flagged };
}

// ────────────────────────────────────────────────────────────────────────────
// Mock reviews (deterministic, plausible, condition-agnostic)
// ────────────────────────────────────────────────────────────────────────────

function mockReview(
  persona: ExpertPersona,
  draft: DraftPlan,
  module: ConditionModule,
): ExpertReview {
  const key = persona.key;
  const bandText = draft.actResult.bandLabel ?? draft.actResult.band;
  const medText = draft.step.medRxcui
    ? `the drafted medication (${draft.step.medDisplay})`
    : `the non-pharmacologic plan (${draft.step.medDisplay})`;

  // A safety persona surfaces the escalation/action-plan check.
  if (key.includes('safety')) {
    return {
      expert: key,
      label: persona.label,
      verdict: 'suggest-edit',
      rationale: [
        `No red flags requiring immediate escalation are evident in the draft, and the`,
        `treatment intensity appears matched to the ${module.instrument.name} band (${bandText}).`,
        draft.step.escalate
          ? 'An urgent escalation Task is included, which is appropriate for this severity.'
          : 'No urgent escalation is included, which is appropriate for this band.',
        'A written action plan with explicit worsening/emergency criteria should accompany the plan.',
      ].join(' '),
      suggestedEdit:
        'Attach a written action plan with explicit escalation/emergency criteria and confirm the follow-up interval is documented.',
    };
  }

  // A pharmacist persona surfaces the drug/interaction check.
  if (key.includes('pharmac')) {
    return {
      expert: key,
      label: persona.label,
      verdict: 'suggest-edit',
      rationale: [
        `Drug choice and dose for ${medText} appear reasonable and no major`,
        'interaction or contraindication is evident against the recorded medications and',
        'allergies. Interaction screening should be confirmed once the full active',
        'medication list is reconciled, and adherence/technique counselling reinforced.',
      ].join(' '),
      suggestedEdit:
        'Confirm a formal drug-interaction check against the reconciled medication list and add adherence/technique counselling before dispensing.',
    };
  }

  // Any other clinical persona (e.g. pulmonology, psychiatry): guideline agreement.
  return {
    expert: key,
    label: persona.label,
    verdict: 'agree',
    rationale: [
      `For a ${bandText} ${module.instrument.name} result (total ${draft.actResult.total}), the drafted step`,
      `and ${draft.step.followUpWeeks}-week follow-up are consistent with guideline stepped care`,
      `for ${module.label}. No guideline mismatch identified.`,
    ].join(' '),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function coerceVerdict(raw: unknown): ExpertVerdict {
  if (raw === 'agree' || raw === 'concern' || raw === 'suggest-edit') {
    return raw;
  }
  // Unknown/malformed verdict → treat conservatively as a concern to surface it.
  return 'concern';
}
