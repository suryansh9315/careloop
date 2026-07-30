/**
 * Condition Registry — the abstraction that makes CareLoop generic across
 * treatments. Each ConditionModule is pure data + a few pure functions; the
 * engine (bridge, tools, bot, workers, seed) reads a module and is otherwise
 * condition-agnostic. Add a new treatment = add a new module, nothing else.
 */
import type { FlowSpec, MedOrder, PatientContext, RiskQuestion, ToolName } from '../types.js';

export type Coding = { system: string; code: string; display: string };

export type InstrumentItem = {
  /** questionnaire linkId, e.g. 'q1' */
  linkId: string;
  /** LOINC code for this item */
  loinc: string;
  /** what the agent asks */
  prompt: string;
  /** answer scale description shown to the agent, e.g. '0 = not at all … 3 = nearly every day' */
  scale: string;
  /** min/max allowed answer value (inclusive) */
  min: number;
  max: number;
};

export type ScoreBand = {
  /** stable id used to key the protocol, e.g. 'poor' */
  id: string;
  label: string;
  /** inclusive total-score range that maps to this band */
  min: number;
  max: number;
};

export type ProtocolStepDef = {
  bandId: string;
  summary: string;
  /** structured medication regimen (controller + reliever + course, etc.). */
  medications?: MedOrder[];
  /** legacy single-med fields — used as a fallback when `medications` is absent */
  medRxcui: string;
  medDisplay: string;
  addOralSteroid?: boolean;
  specialistReferral?: boolean;
  followUpWeeks: number;
  /** true → create an urgent Task for the care team */
  escalate: boolean;
  goal: string;
};

export type ExpertPersona = {
  key: string;
  label: string;
  /** system prompt for this reviewer; must end asking for the standard JSON verdict */
  systemPrompt: string;
};

export type ConditionAgentConfig = {
  /** persona + global rules injected at every flow node */
  globalPrompt: string;
};

/** Everything needed to run one treatment end-to-end. */
export type ConditionModule = {
  id: string;
  label: string;
  conditionCodes: { icd10: Coding; snomed?: Coding };

  instrument: {
    name: string;
    panelLoinc: string;
    totalLoinc: string;
    items: InstrumentItem[];
    /** higher total = better control (ACT) or worse (PHQ-9); affects band copy only */
    direction: 'higherIsBetter' | 'higherIsWorse';
    bands: ScoreBand[];
  };

  /** bandId → deterministic plan step */
  protocol: Record<string, ProtocolStepDef>;

  /**
   * Supplemental, NON-scored questions asked after the instrument to capture
   * GINA future-risk / modifiable factors it misses. Charted but not scored;
   * turned into RiskFindings post-call by src/clinical/risk.ts.
   */
  riskQuestions?: RiskQuestion[];

  moss: {
    indexName: string;
    corpus: { id: string; text: string; source: string }[];
  };

  agent: ConditionAgentConfig;

  /**
   * Template for the phenotype/topic string the deep-research step investigates.
   * Placeholders: {{conditionDisplay}} {{triggers}} {{bandLabel}} {{total}}.
   * A string (not a function) so a ConditionModule is fully JSON-serializable and
   * can be stored/edited as data — see renderResearchTopic().
   */
  researchTopicTemplate: string;

  expertPanel: ExpertPersona[];

  /** default medication seeded as the patient's "current" therapy (for demos) */
  currentMedication?: { rxcui: string; display: string };
};

/** Pure engine helpers over a module (no I/O). */

export function scoreInstrument(
  module: ConditionModule,
  answers: { linkId: string; value: number }[],
): { total: number; band: ScoreBand } {
  const byId = new Map(answers.map((a) => [a.linkId, a.value]));
  let total = 0;
  for (const item of module.instrument.items) {
    const raw = byId.get(item.linkId);
    if (typeof raw === 'number') {
      total += Math.max(item.min, Math.min(item.max, Math.round(raw)));
    }
  }
  const band =
    module.instrument.bands.find((b) => total >= b.min && total <= b.max) ??
    module.instrument.bands[module.instrument.bands.length - 1]!;
  return { total, band };
}

/** Render a module's researchTopicTemplate into the concrete deep-research topic. */
export function renderResearchTopic(
  module: ConditionModule,
  ctx: { conditionDisplay: string; triggers: string[]; bandLabel: string; total: number },
): string {
  const triggers = ctx.triggers.length ? ctx.triggers.join(', ') : 'none recorded';
  return (module.researchTopicTemplate || `Evidence-based management for {{conditionDisplay}} at {{bandLabel}} severity (score {{total}})`)
    .replaceAll('{{conditionDisplay}}', ctx.conditionDisplay)
    .replaceAll('{{triggers}}', triggers)
    .replaceAll('{{bandLabel}}', ctx.bandLabel)
    .replaceAll('{{total}}', String(ctx.total));
}

export function stepForBand(module: ConditionModule, bandId: string): ProtocolStepDef {
  return module.protocol[bandId] ?? module.protocol[module.instrument.bands[module.instrument.bands.length - 1]!.id]!;
}

/** Interpolation values for {{...}} flow placeholders — condition-agnostic. */
export function buildDynamicVars(p: PatientContext): Record<string, string> {
  const priors = p.priorActScores;
  const last = priors[priors.length - 1];
  const historyRecap = last
    ? `Last time your score was ${last.total}${
        p.triggers.length ? `, and we'd noted ${p.triggers.join(' and ')}` : ''
      } — I want to see how you've been since then.`
    : `I want to see how you've been feeling lately.`;
  return {
    givenName: p.givenName,
    familyName: p.familyName,
    dob: p.dob,
    conditionDisplay: p.conditionDisplay,
    currentMeds: p.currentMedications.join(', ') || 'your current medication',
    historyRecap,
  };
}

/**
 * Generate the intake conversation flow from a module: greeting → verify →
 * recap → one node per instrument item (each charts its answer) → open concerns
 * → submit → close. Condition-specific persona/emergency live in globalPrompt.
 */
export function buildIntakeFlow(module: ConditionModule): FlowSpec {
  const items = module.instrument.items;
  const risks = module.riskQuestions ?? [];
  // After the last instrument item, go to the first risk question (if any), else open concerns.
  const afterItems = risks.length ? `risk-${risks[0]!.id}` : 'open_concerns';

  const itemNodes = items.map((item, i) => ({
    id: item.linkId,
    type: 'subagent' as const,
    allowedTools: ['chartLive', 'getCareContext', 'checkCoverage'] as ToolName[],
    instruction: `Ask this ${module.instrument.name} question conversationally, then wait:\n"${item.prompt}"\nMap the answer to a value (${item.scale}). Once you have a clear value, call chartLive with { linkId: "${item.linkId}", value: <${item.min}-${item.max}>, note: "<their words>" }. Never say the number.`,
    edges: [
      { to: 'answer_qa', when: 'the patient asks a question instead of answering' },
      { to: i === items.length - 1 ? afterItems : items[i + 1]!.linkId, when: 'a clear answer has been captured' },
    ],
  }));

  // Supplemental risk-factor questions (charted, not scored).
  const riskNodes = risks.map((rq, i) => ({
    id: `risk-${rq.id}`,
    type: 'subagent' as const,
    allowedTools: ['chartLive', 'getCareContext', 'checkCoverage'] as ToolName[],
    instruction: `Ask this follow-up question in a warm, unhurried way, then wait:\n"${rq.prompt}"\nMap what they say to an integer value (${rq.encoding}). Once you have it, call chartLive with { riskId: "${rq.id}", value: <integer>, note: "<their words>" }. Never say the number or mention scoring.`,
    edges: [
      { to: 'answer_qa', when: 'the patient asks a question instead of answering' },
      { to: i === risks.length - 1 ? 'open_concerns' : `risk-${risks[i + 1]!.id}`, when: 'a clear answer has been captured' },
    ],
  }));

  return {
    id: `${module.id}-intake`,
    globalPrompt: module.agent.globalPrompt,
    startNode: 'greeting',
    nodes: [
      { id: 'greeting', type: 'conversation', allowedTools: [], instruction: `Greet {{givenName}} warmly, say you're calling from the clinic for a quick pre-visit check-in, and confirm it's a good time.`, edges: [{ to: 'verify_identity', when: 'the patient agrees' }] },
      { id: 'verify_identity', type: 'conversation', allowedTools: [], instruction: `Ask them to confirm their date of birth for security. Their DOB on file is {{dob}}. Accept it when what they say reasonably matches {{dob}} in any spoken format (e.g. "first of January nineteen ninety" = 1990-01-01, "May fourteenth seventy-nine" = 1979-05-14). Then thank them and continue. If it clearly doesn't match after one gentle retry, say you'll double-check with the team but CONTINUE the check-in anyway — never end the call over this.`, edges: [{ to: 'recap_history', when: 'identity is confirmed or after one retry' }] },
      { id: 'recap_history', type: 'conversation', allowedTools: [], instruction: `Briefly ground the call in their history: "{{historyRecap}}". Then say you have a few quick questions.`, edges: [{ to: items[0]!.linkId, when: 'ready to begin' }] },
      ...itemNodes,
      ...riskNodes,
      { id: 'open_concerns', type: 'subagent', allowedTools: ['chartLive', 'getCareContext', 'checkCoverage'], instruction: `Ask if anything else has been bothering them health-wise. For each concern, call chartLive with { concern: "<their words>" }. Don't advise — capture and reassure.`, edges: [{ to: 'submit', when: 'no more concerns' }] },
      { id: 'submit', type: 'subagent', allowedTools: ['submitQuestionnaire'], instruction: `Call submitQuestionnaire SILENTLY — do not announce it, do not say "one moment" or that you're saving anything. The instant it's done, move straight into the value recap.`, edges: [{ to: 'recap', when: 'submitted' }] },
      { id: 'recap', type: 'subagent', allowedTools: ['getCareContext'], instruction: `Give {{givenName}} a brief, warm PERSONALIZED wrap-up so the call feels worth their time:\n1) Reflect back the 1–2 most important things they shared today, in their own terms (e.g. more night-time symptoms, using the reliever a lot, a concern they raised).\n2) Offer ONE concrete, reassuring tip relevant to what they said — if useful, call getCareContext to ground it (e.g. inhaler technique, spacer, trigger avoidance). Keep it to one sentence, non-prescriptive.\n3) Tell them what happens next: their care team will review everything before the visit and follow up, and remind them to seek urgent care if breathing suddenly worsens.\nWarm, unhurried, plain language. Do not read back numbers or scores. Then say a warm goodbye.`, edges: [{ to: 'close', when: 'the recap and goodbye are done' }] },
      { id: 'answer_qa', type: 'subagent', allowedTools: ['getCareContext', 'checkCoverage'], instruction: `The patient asked a question. For an insurance/cost question call checkCoverage; otherwise call getCareContext. Relay the answer in 1–2 sentences, then return to where you left off.`, edges: [{ to: '__resume__', when: 'answered' }] },
      { id: 'close', type: 'end', allowedTools: [], instruction: `Warm close: thank {{givenName}}, say the team will review before the visit, and say goodbye.`, edges: [] },
    ],
  };
}
