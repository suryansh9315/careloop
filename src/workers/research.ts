import { log } from '../logger.js';
import { getMossClient } from '../integrations/moss.js';
import { chatJSON, llmEnabled } from '../integrations/llm.js';
import { getModuleForPatient } from '../conditions/registry.js';
import { renderResearchTopic, type ConditionModule } from '../conditions/types.js';
import type {
  ActResult,
  Citation,
  ConcernNote,
  MossSnippet,
  PatientContext,
  ResearchFinding,
} from '../types.js';

/**
 * Component 3 — Deep research (Moss + agents).
 *
 * After the call, we research the patient's specific condition phenotype/severity
 * (from the resolved ConditionModule) AND every additional concern captured during
 * the call. For each topic we optionally pull grounding snippets from Moss (clinic
 * knowledge, from the module's index) and ask the configured LLM to synthesise a
 * short, cited clinical rationale.
 *
 * This runs off the hot path and attaches its findings to the draft CarePlan for
 * the human clinician. It is INFORMATIONAL EVIDENCE ONLY — a set of cited rationales
 * to inform the doctor, never an autonomous clinical decision.
 *
 * This worker is CONDITION-AGNOSTIC: all condition-specific text (topic, corpus,
 * index, labels) comes from the ConditionModule.
 *
 * MOCK mode: when no LLM key is configured (`llmEnabled()` is false) — or on any
 * network/parse error — we fall back to deterministic, well-written canned findings
 * so the offline simulator produces a full pipeline.
 */

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export async function researchPlan(input: {
  patient: PatientContext;
  actResult: ActResult;
  concerns: ConcernNote[];
}): Promise<ResearchFinding[]> {
  const { patient, actResult, concerns } = input;
  const module = getModuleForPatient(patient);

  // Build the list of topics: the condition phenotype first, then one per concern.
  const phenotypeTopic = renderResearchTopic(module, {
    conditionDisplay: patient.conditionDisplay,
    triggers: patient.triggers,
    bandLabel: actResult.bandLabel ?? actResult.band,
    total: actResult.total,
  });
  const topics: string[] = [phenotypeTopic, ...concerns.map((c) => c.text)];

  log.info('research.start', {
    patientId: patient.patientId,
    conditionModuleId: module.id,
    topics: topics.length,
    mock: !llmEnabled(),
  });

  // Research each topic independently and in parallel.
  const findings = await Promise.all(
    topics.map((topic, i) =>
      researchTopic({
        topic,
        // The first topic is the phenotype; the rest are open concerns.
        kind: i === 0 ? 'phenotype' : 'concern',
        patient,
        actResult,
        module,
      }),
    ),
  );

  log.info('research.done', { patientId: patient.patientId, findings: findings.length });
  return findings;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-topic research
// ────────────────────────────────────────────────────────────────────────────

async function researchTopic(input: {
  topic: string;
  kind: 'phenotype' | 'concern';
  patient: PatientContext;
  actResult: ActResult;
  module: ConditionModule;
}): Promise<ResearchFinding> {
  const { topic, kind, patient, actResult, module } = input;

  // 1. Optionally ground the topic in clinic knowledge via Moss. Best-effort:
  //    a Moss failure must never sink the research step.
  const snippets = await retrieveGrounding(topic, module);

  // 2. Mock fallback when no LLM provider is configured.
  if (!llmEnabled()) {
    return mockFinding({ topic, kind, patient, actResult, module });
  }

  // 3. Live synthesis via the configured LLM (Groq or Anthropic). Any error falls back to the mock.
  try {
    return await synthesizeFinding({ topic, kind, patient, actResult, module, snippets });
  } catch (err) {
    log.warn('research.topic.fallback', {
      topic,
      error: err instanceof Error ? err.message : String(err),
    });
    return mockFinding({ topic, kind, patient, actResult, module });
  }
}

/** Best-effort grounding retrieval from Moss (module's index/corpus); returns [] on any error. */
async function retrieveGrounding(topic: string, module: ConditionModule): Promise<MossSnippet[]> {
  try {
    const moss = getMossClient({ indexName: module.moss.indexName, corpus: module.moss.corpus });
    const snippets = await moss.retrieve(topic, { k: 4 });
    log.debug('research.moss.retrieve', { topic, snippets: snippets.length });
    return snippets;
  } catch (err) {
    log.warn('research.moss.skip', {
      topic,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Live model synthesis
// ────────────────────────────────────────────────────────────────────────────

function researchSystemPrompt(module: ConditionModule): string {
  return [
    `You are a clinical evidence-synthesis assistant supporting a pre-visit ${module.label}`,
    'follow-up workflow. You produce concise, guideline-anchored rationales with',
    'citations for a licensed clinician to review. You are DECISION SUPPORT ONLY:',
    'you never prescribe or issue orders, and every claim must be attributable to a',
    'named guideline or reputable source. Prefer authoritative specialty guidelines and',
    'national bodies relevant to the condition. Do not invent patient facts beyond what is provided.',
    '',
    'Respond with a SINGLE JSON object and nothing else, matching exactly:',
    '{"rationale": string, "citations": [{"title": string, "url": string, "note"?: string}]}',
    'Provide 2-3 citations. Keep the rationale to a short clinical paragraph.',
  ].join('\n');
}

async function synthesizeFinding(input: {
  topic: string;
  kind: 'phenotype' | 'concern';
  patient: PatientContext;
  actResult: ActResult;
  module: ConditionModule;
  snippets: MossSnippet[];
}): Promise<ResearchFinding> {
  const { topic, kind, patient, actResult, module, snippets } = input;

  const grounding = snippets.length
    ? snippets.map((s, i) => `[${i + 1}] (${s.source}) ${s.text}`).join('\n')
    : '(no clinic-specific grounding snippets retrieved)';

  const bandText = actResult.bandLabel ?? actResult.band;
  const userPrompt = [
    `Research topic (${kind}): ${topic}`,
    '',
    'Patient context (do not invent beyond this):',
    `- Condition: ${patient.conditionDisplay} (${patient.conditionCode})`,
    `- Current medications: ${fmtList(patient.currentMedications)}`,
    `- Allergies: ${fmtList(patient.allergies)}`,
    `- Triggers: ${fmtList(patient.triggers)}`,
    `- Latest ${module.instrument.name}: ${actResult.total} (band: ${bandText})`,
    '',
    'Clinic knowledge grounding (may be empty):',
    grounding,
    '',
    kind === 'phenotype'
      ? `Synthesise the ${module.label} phenotype/severity and the guideline rationale for the appropriate step and any non-pharmacologic measures.`
      : 'Synthesise a brief, sensible evidence-based rationale for evaluating and managing this patient-raised concern, and when it should be escalated.',
    '',
    'Return only the JSON object described in the system prompt.',
  ].join('\n');

  const parsed = await chatJSON<{ rationale?: unknown; citations?: unknown }>({
    system: researchSystemPrompt(module),
    user: userPrompt,
    temperature: 0.1,
    maxTokens: 1024,
  });

  const rationale =
    typeof parsed.rationale === 'string' && parsed.rationale.trim().length > 0
      ? parsed.rationale.trim()
      : '';
  if (!rationale) throw new Error('no rationale in model response');
  const citations = normalizeCitations(parsed.citations);

  return { topic, rationale, citations };
}

// ────────────────────────────────────────────────────────────────────────────
// Mock findings (deterministic, condition-agnostic)
// ────────────────────────────────────────────────────────────────────────────

function mockFinding(input: {
  topic: string;
  kind: 'phenotype' | 'concern';
  patient: PatientContext;
  actResult: ActResult;
  module: ConditionModule;
}): ResearchFinding {
  const { topic, kind, patient, actResult, module } = input;

  if (kind === 'phenotype') {
    return mockPhenotypeFinding(topic, patient, actResult, module);
  }
  return mockConcernFinding(topic, patient, module);
}

function mockPhenotypeFinding(
  topic: string,
  patient: PatientContext,
  actResult: ActResult,
  module: ConditionModule,
): ResearchFinding {
  const triggers = fmtList(patient.triggers);
  const bandText = actResult.bandLabel ?? actResult.band;

  const rationale = [
    `For ${patient.conditionDisplay}, the ${module.instrument.name} indicates a ${bandText} presentation (total ${actResult.total}), which frames the stepped-care decision.`,
    triggers !== 'none recorded'
      ? `Recorded contributing factors (${triggers}) should be addressed alongside any pharmacologic step, as they can drive symptom burden.`
      : `No specific contributing factors were recorded; guideline stepped care for this severity band should be applied and factors re-assessed at follow-up.`,
    `Guideline-recommended non-pharmacologic and adherence measures for ${module.label} should accompany any change in therapy and be reviewed at the follow-up interval.`,
    'This is a cited rationale for clinician review, not an order.',
  ].join(' ');

  const citations: Citation[] = [
    {
      title: `Clinical practice guideline — ${module.label}`,
      url: 'https://www.guidelinecentral.com/',
      note: `Stepped-care approach and severity-band management for ${module.label}.`,
    },
    {
      title: 'AAFP — Primary-care management reference',
      url: 'https://www.aafp.org/pubs/afp.html',
      note: 'Primary-care severity assessment and non-pharmacologic guidance.',
    },
    {
      title: 'MedlinePlus (NIH) — Condition overview',
      url: 'https://medlineplus.gov/',
      note: 'Patient-safe background on the condition and its management.',
    },
  ];

  return { topic, rationale, citations };
}

function mockConcernFinding(
  topic: string,
  patient: PatientContext,
  module: ConditionModule,
): ResearchFinding {
  const rationale = [
    `Patient-raised concern: "${topic}".`,
    `A structured pre-visit review is warranted: characterise onset, duration, severity, and any red-flag features; screen for interactions with the current ${patient.conditionDisplay} regimen and for a plausible comorbidity or medication side effect before the visit.`,
    `Most presentations of this kind are low-acuity and can be addressed at the scheduled visit, but escalate early if there are systemic features (fever, spreading, functional impairment) or if it plausibly worsens ${module.label} control.`,
    'This is a cited rationale to orient the clinician, not a diagnosis or order.',
  ].join(' ');

  const citations: Citation[] = [
    {
      title: 'AAFP — Approach to the Patient with a New Symptom (clinical reference)',
      url: 'https://www.aafp.org/pubs/afp/collections/symptom-evaluation.html',
      note: 'General primary-care framework for evaluating a new patient-reported concern.',
    },
    {
      title: 'MedlinePlus (NIH) — Symptom overview and when to seek care',
      url: 'https://medlineplus.gov/',
      note: 'Patient-safe background and escalation guidance for common symptoms.',
    },
  ];

  return { topic, rationale, citations };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function fmtList(items: string[]): string {
  return items && items.length ? items.join(', ') : 'none recorded';
}

function normalizeCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return [];
  const out: Citation[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const title = typeof rec.title === 'string' ? rec.title : undefined;
      const url = typeof rec.url === 'string' ? rec.url : undefined;
      if (title && url) {
        const cite: Citation = { title, url };
        if (typeof rec.note === 'string') cite.note = rec.note;
        out.push(cite);
      }
    }
  }
  return out;
}
