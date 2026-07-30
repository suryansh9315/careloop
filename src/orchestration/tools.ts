import type { QuestionnaireResponse, QuestionnaireResponseItem } from '@medplum/fhirtypes';
import type {
  ConcernNote,
  CoverageClient,
  MossClient,
  PatientContext,
  RiskAnswer,
  ToolName,
  ToolResult,
  ToolSchema,
} from '../types.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { getModuleForPatient, CONDITION_TAG_SYSTEM } from '../conditions/registry.js';
import { getMossClient } from '../integrations/moss.js';

/**
 * Own-server tool layer invoked by the voice agent (Deepgram function calls).
 * Mirrors 2care's tool-endpoint mechanics: idempotency guard + structured logs.
 * State that must survive across tool calls (collected answers/concerns) lives in
 * the per-call `CallSession`, which the bridge/simulator owns.
 */

export type CallSession = {
  callId: string;
  patient: PatientContext;
  answers: Map<string, { value: number; note?: string }>;
  /** supplemental risk-question answers (keyed by risk id; not scored) */
  riskAnswers: Map<string, RiskAnswer>;
  concerns: ConcernNote[];
  submitted: boolean;
  /** questionnaireResponse produced by submitQuestionnaire (also fed to the bot) */
  questionnaireResponse?: QuestionnaireResponse;
  /** idempotency: tool-call ids already handled */
  handled: Set<string>;
};

export function newSession(callId: string, patient: PatientContext): CallSession {
  return {
    callId,
    patient,
    answers: new Map(),
    riskAnswers: new Map(),
    concerns: [],
    submitted: false,
    handled: new Set(),
  };
}

// ── Tool schemas exposed to the voice agent ────────────────────────────────
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'chartLive',
    description:
      'Record what the patient just said into the live chart. Use for an ACT answer (linkId + value 1–5), a risk-question answer (riskId + integer value), OR a free-text health concern (concern). Never announce it.',
    parameters: {
      type: 'object',
      properties: {
        linkId: { type: 'string', description: 'ACT item id: act1–act5 (omit for a concern/risk)' },
        value: { type: 'integer', description: 'ACT answer 1–5, or the risk-question integer encoding' },
        riskId: { type: 'string', description: 'risk-question id (e.g. exacerbations); pair with an integer value' },
        note: { type: 'string', description: "the patient's own words, optional" },
        concern: { type: 'string', description: 'a free-text health concern beyond asthma' },
      },
      required: [],
    },
  },
  {
    name: 'getCareContext',
    description:
      'Fetch a grounded, patient-safe answer to a question the patient asks (e.g. inhaler technique). Returns a snippet to relay in 1–2 sentences.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: "the patient's question" } },
      required: ['question'],
    },
  },
  {
    name: 'checkCoverage',
    description:
      "Answer an insurance/cost question (e.g. 'will this be covered?', 'what's my copay?', 'do I need prior authorization?'). Runs a real eligibility check on the patient's insurance and returns a patient-friendly summary to relay.",
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: "the patient's insurance/cost question" } },
      required: [],
    },
  },
  {
    name: 'submitQuestionnaire',
    description:
      'Finalize the check-in: sends the collected ACT answers and any concerns. Call once, silently, near the end.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

/** Convert our schemas into Deepgram Agent function definitions. */
export function toDeepgramFunctions(schemas: ToolSchema[] = TOOL_SCHEMAS): unknown[] {
  return schemas.map((s) => ({
    name: s.name,
    description: s.description,
    parameters: s.parameters,
  }));
}

export function schemasForTools(tools: ToolName[]): ToolSchema[] {
  return TOOL_SCHEMAS.filter((s) => tools.includes(s.name));
}

// ── Dependencies (injectable for tests/simulator) ──────────────────────────
export type ToolDeps = {
  moss: MossClient;
  coverage: CoverageClient;
  chartCommunication: (patientId: string, text: string) => Promise<string | null>;
  chartActObservation: (
    patientId: string,
    linkId: string,
    value: number,
    note?: string,
  ) => Promise<string | null>;
  /** persist the final QuestionnaireResponse (Medplum create triggers the Bot). */
  onSubmit: (qr: QuestionnaireResponse) => Promise<{ id: string | null }>;
};

/** Wire the real modules. Lazy-imported so tests/simulator can override cheaply. */
export async function defaultToolDeps(): Promise<ToolDeps> {
  const { getMossClient } = await import('../integrations/moss.js');
  const { getCoverageClient } = await import('../integrations/stedi.js');
  const { chartCommunication, chartActObservation } = await import('../medplum/chart.js');
  const { medplumEnabled, getMedplum } = await import('../medplum/client.js');
  return {
    moss: getMossClient(),
    coverage: getCoverageClient(),
    chartCommunication,
    chartActObservation,
    onSubmit: async (qr) => {
      if (!medplumEnabled()) {
        log.info('submit.mock', { note: 'QuestionnaireResponse not persisted (medplum disabled)' });
        return { id: null };
      }
      const created = await getMedplum().then((m) => m.createResource(qr));
      return { id: created.id ?? null };
    },
  };
}

// ── QuestionnaireResponse builder ──────────────────────────────────────────
export function buildQuestionnaireResponse(session: CallSession): QuestionnaireResponse {
  const module = getModuleForPatient(session.patient);
  const items: QuestionnaireResponseItem[] = [];
  for (const instItem of module.instrument.items) {
    const a = session.answers.get(instItem.linkId);
    if (a) items.push({ linkId: instItem.linkId, answer: [{ valueInteger: a.value }] });
  }
  for (const rq of module.riskQuestions ?? []) {
    const a = session.riskAnswers.get(rq.id);
    if (a) items.push({ linkId: `risk-${rq.id}`, text: a.note ?? rq.prompt, answer: [{ valueInteger: a.value }] });
  }
  session.concerns.forEach((c, i) => {
    items.push({ linkId: `concern-${i + 1}`, text: 'Additional concern', answer: [{ valueString: c.text }] });
  });
  return {
    resourceType: 'QuestionnaireResponse',
    status: 'completed',
    meta: { tag: [{ system: CONDITION_TAG_SYSTEM, code: session.patient.conditionModuleId }] },
    ...(config.seed.questionnaireId
      ? { questionnaire: `Questionnaire/${config.seed.questionnaireId}` }
      : {}),
    subject: { reference: `Patient/${session.patient.patientId}` },
    ...(session.patient.appointmentId
      ? { encounter: { reference: `Appointment/${session.patient.appointmentId}` } }
      : {}),
    authored: new Date().toISOString(),
    item: items,
  };
}

// ── Tool execution ─────────────────────────────────────────────────────────
export async function runTool(
  name: ToolName,
  args: Record<string, unknown>,
  session: CallSession,
  deps: ToolDeps,
  toolCallId?: string,
): Promise<ToolResult> {
  // Idempotency (2care claimToolCall pattern)
  if (toolCallId) {
    if (session.handled.has(toolCallId)) {
      log.info('tool.dedup', { name, toolCallId });
      return { ok: true, data: { deduplicated: true } };
    }
    session.handled.add(toolCallId);
  }
  const pid = session.patient.patientId;
  log.info('tool.call', { name, callId: session.callId, args });

  try {
    switch (name) {
      case 'chartLive': {
        const concern = typeof args.concern === 'string' ? args.concern.trim() : '';
        if (concern) {
          const note: ConcernNote = { id: `c${session.concerns.length + 1}`, text: concern, at: new Date().toISOString() };
          session.concerns.push(note);
          // Fire-and-forget: don't make the agent wait on the Medplum write.
          void deps.chartCommunication(pid, `Additional concern: ${concern}`);
          return { ok: true, data: { charted: 'concern' } };
        }
        const noteText = typeof args.note === 'string' ? args.note : undefined;
        const module = getModuleForPatient(session.patient);

        // Supplemental risk-question answer (charted, not scored).
        const riskId = typeof args.riskId === 'string' ? args.riskId : '';
        if (riskId) {
          const rq = (module.riskQuestions ?? []).find((r) => r.id === riskId);
          const rv = typeof args.value === 'number' ? args.value : Number(args.value);
          if (!rq || !Number.isFinite(rv)) {
            const ids = (module.riskQuestions ?? []).map((r) => r.id).join(', ') || '(none)';
            return { ok: false, error: `chartLive risk needs {riskId in ${ids}, integer value}` };
          }
          session.riskAnswers.set(riskId, { id: riskId, value: Math.round(rv), note: noteText });
          void deps.chartCommunication(pid, `Risk · ${riskId}: ${Math.round(rv)}${noteText ? ` — "${noteText}"` : ''}`);
          return { ok: true, data: { charted: 'risk', riskId } };
        }

        const linkId = typeof args.linkId === 'string' ? args.linkId : '';
        const value = typeof args.value === 'number' ? args.value : Number(args.value);
        const item = module.instrument.items.find((it) => it.linkId === linkId);
        if (!item || !Number.isFinite(value)) {
          const ids = module.instrument.items.map((it) => it.linkId).join(', ');
          return { ok: false, error: `chartLive needs {linkId in ${ids}, value} or {concern}` };
        }
        const v = Math.max(item.min, Math.min(item.max, Math.round(value)));
        session.answers.set(linkId, { value: v, note: noteText });
        // Fire-and-forget the Medplum writes so the agent responds immediately —
        // the answer is already captured in the in-memory session (what the plan
        // is built from); the Observation/Communication are a record/display
        // side-effect that lands a beat later.
        void deps.chartActObservation(pid, linkId, v, noteText);
        void deps.chartCommunication(pid, `${linkId.toUpperCase()}: ${v}/5${noteText ? ` — "${noteText}"` : ''}`);
        return { ok: true, data: { charted: linkId, value: v } };
      }

      case 'getCareContext': {
        const question = typeof args.question === 'string' ? args.question : '';
        const module = getModuleForPatient(session.patient);
        const moss = getMossClient({ indexName: module.moss.indexName, corpus: module.moss.corpus });
        const hits = await moss.retrieve(question, { k: 1 });
        const top = hits[0];
        if (!top) return { ok: true, say: "I don't have that handy, but your care team can walk you through it at the visit.", data: { grounded: false } };
        await deps.chartCommunication(pid, `Patient asked: "${question}" → answered from ${top.source}`);
        return { ok: true, say: top.text, data: { grounded: true, source: top.source } };
      }

      case 'checkCoverage': {
        const p = session.patient;
        const medDisplay = p.currentMedications[0] ?? `${p.conditionDisplay} treatment`;
        const result = await deps.coverage.checkMedication({
          patientId: pid,
          rxcui: '',
          medDisplay,
          coverage: p.coverage,
        });
        const say =
          `Your ${result.planName} plan is ${result.covered ? 'active' : 'not showing active coverage right now'}. ` +
          `Your estimated out-of-pocket is about $${result.copayUsd}` +
          `${result.priorAuthRequired ? ', and a prior authorization may be needed — your care team can take care of that.' : '.'}`;
        await deps.chartCommunication(
          pid,
          `Coverage check → covered: ${result.covered}, copay: $${result.copayUsd}, prior-auth: ${result.priorAuthRequired}`,
        );
        return {
          ok: true,
          say,
          data: {
            covered: result.covered,
            copayUsd: result.copayUsd,
            priorAuthRequired: result.priorAuthRequired,
          },
        };
      }

      case 'submitQuestionnaire': {
        if (session.submitted) return { ok: true, data: { deduplicated: true } };
        const qr = buildQuestionnaireResponse(session);
        session.questionnaireResponse = qr;
        session.submitted = true;
        const { id } = await deps.onSubmit(qr);
        log.info('tool.submit', { callId: session.callId, answers: session.answers.size, concerns: session.concerns.length, questionnaireResponseId: id });
        return { ok: true, data: { questionnaireResponseId: id, submitted: true } };
      }

      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  } catch (err) {
    log.error('tool.error', { name, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: 'tool failed' };
  }
}
