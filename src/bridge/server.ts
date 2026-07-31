import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { config, streamUrl } from '../config.js';
import { log } from '../logger.js';
import type { PatientContext, ToolName } from '../types.js';
import type { FlowSpec } from '../types.js';
import { buildIntakeFlow, buildDynamicVars } from '../conditions/types.js';
import {
  getCondition,
  requireCondition,
  listConditions,
  isBuiltInCondition,
  initConditionRegistry,
  refreshCondition,
  DEFAULT_CONDITION_ID,
} from '../conditions/registry.js';
import { upsertConditionResource, validateModule } from '../conditions/store.js';
import type { ConditionModule } from '../conditions/types.js';
import {
  buildQuestionnaireResponse,
  defaultToolDeps,
  newSession,
  runTool,
  TOOL_SCHEMAS,
  toDeepgramFunctions,
  type CallSession,
  type ToolDeps,
} from '../orchestration/tools.js';
import { renderSystemPrompt } from '../orchestration/prompt-renderer.js';
import { FlowStateMachine } from '../orchestration/state-machine.js';
import { connectDeepgramAgent, type DeepgramAgentHandle } from '../integrations/deepgram.js';
import {
  twimlConnectStream,
  verifyTwilioSignature,
  startOutboundCall,
} from '../integrations/twilio.js';
import { createIntakePatient } from '../medplum/intake.js';
import { recordCallInitiated, updateCall } from '../medplum/calllog.js';
import { getModuleForPatient } from '../conditions/registry.js';
import { getMedplum, medplumEnabled } from '../medplum/client.js';
import { buildDraftPlan, persistDraftPlan, type PostCallDeps } from '../bot/questionnaire-response.js';
import { writeDashboardArtifact } from '../medplum/artifact.js';
import { researchPlan } from '../workers/research.js';
import { peerReview } from '../workers/expert-panel.js';
import { getCoverageClient } from '../integrations/stedi.js';

/**
 * Post-call pipeline: turn the submitted QuestionnaireResponse into a coded n=1
 * draft CarePlan (+ research, peer review, coverage) and publish the dashboard
 * artifact — the same work the simulator/Bot does, run inline on the live path so
 * a real call produces a review immediately. Fire-and-forget; never blocks the call.
 */
async function processSubmission(session: CallSession): Promise<void> {
  try {
    if (!medplumEnabled()) return;
    const patient = session.patient;
    const module = getModuleForPatient(patient);

    // Only build a plan from a COMPLETE interview — regardless of whether the
    // agent called submitQuestionnaire. The score comes from the in-memory
    // session (what chartLive captured), NOT from the QR the agent submitted:
    // in prompt mode the agent sometimes narrates answers ("I'll note that…")
    // without ever calling chartLive, which would submit an EMPTY questionnaire
    // and mis-score everything to 0 → a bogus "poor" plan. Guarding on the
    // captured answers prevents that.
    const complete = module.instrument.items.every((it) => session.answers.has(it.linkId));
    if (!complete) {
      log.info('postcall.incomplete', {
        patientId: patient.patientId,
        answered: session.answers.size,
        needed: module.instrument.items.length,
      });
      return;
    }

    const medplum = await getMedplum();

    // Ensure a well-formed QR exists (rebuild from the session if the agent never
    // submitted, or submitted an empty one).
    if (!session.questionnaireResponse || (session.questionnaireResponse.item?.length ?? 0) === 0) {
      const qr = buildQuestionnaireResponse(session);
      session.questionnaireResponse = qr;
      session.submitted = true;
      log.info('postcall.salvaged', { patientId: patient.patientId, answered: session.answers.size });
      try {
        await medplum.createResource(qr);
      } catch (err) {
        log.warn('postcall.salvage_persist_failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    const findPrior = async (patientId: string): Promise<string | null> => {
      const cp = await medplum.searchOne('CarePlan', {
        subject: `Patient/${patientId}`,
        status: 'active',
        _sort: '-_lastUpdated',
      });
      return cp?.id ?? null;
    };
    const deps: PostCallDeps = {
      research: (d) => researchPlan({ patient, actResult: d.actResult, concerns: d.concerns }),
      peerReview: (d) => peerReview({ draft: d }),
      coverage: (rxcui, display, patientId) =>
        getCoverageClient().checkMedication({ patientId, rxcui, medDisplay: display, coverage: patient.coverage }),
    };
    const draft = await buildDraftPlan(session.questionnaireResponse, patient, module, findPrior, deps);
    draft.conditionModuleId = module.id;
    const ids = await persistDraftPlan(medplum, draft, module);
    await writeDashboardArtifact(patient, draft);
    log.info('postcall.done', { patientId: patient.patientId, carePlanId: ids.carePlanId });
  } catch (err) {
    log.error('postcall.error', { error: err instanceof Error ? err.message : String(err) });
  }
}
import { demoPatientContext } from '../demo.js';

/**
 * CareLoop voice bridge.
 *   POST /voice   → returns TwiML that opens a Media Stream to wss://host/twilio
 *   WS   /twilio  → Twilio media stream ⇄ Deepgram Voice Agent ⇄ tool handlers
 *
 * Supports both ORCH_MODE=prompt (one system prompt, all tools) and
 * ORCH_MODE=state (per-node prompt + gated tools, driven by the FlowStateMachine).
 * Node advancement in state mode is a pragmatic driver (advance ACT nodes on a
 * charted answer, conversation nodes on a user turn); the deterministic proof of
 * both modes lives in scripts/simulate-call.ts.
 */

const CONVERSATION_ADVANCE_NODES = new Set(['greeting', 'verify_identity', 'recap_history', 'wrap_up', 'open_concerns']);

// ── HTTP: Twilio voice webhook ───────────────────────────────────────────────
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  // CORS: permissive on every response + preflight short-circuit.
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`CareLoop bridge up. ORCH_MODE=${config.orchMode}. Point your Twilio number's voice webhook at POST /voice.`);
    return;
  }

  // Treatment catalog for the intake form's dropdown + Treatments admin.
  if (req.method === 'GET' && url.pathname === '/conditions') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(listConditions().map((c) => ({ ...c, builtIn: isBuiltInCondition(c.id) }))));
    return;
  }

  // Full module JSON for the Treatments editor: GET /conditions/:id
  const condMatch = url.pathname.match(/^\/conditions\/([^/]+)$/);
  if (condMatch && req.method === 'GET') {
    const module = getCondition(decodeURIComponent(condMatch[1]!));
    if (!module) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown condition' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...module, builtIn: isBuiltInCondition(module.id) }));
    return;
  }

  // Create (POST /conditions) or update (PUT /conditions/:id) a treatment.
  if ((req.method === 'POST' && url.pathname === '/conditions') || (condMatch && req.method === 'PUT')) {
    try {
      if (!medplumEnabled()) throw new Error('Medplum is not configured — cannot persist treatments.');
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}');
      if (condMatch) parsed.id = decodeURIComponent(condMatch[1]!); // URL id wins on update
      const module = validateModule(parsed) as ConditionModule;
      const medplum = await getMedplum();
      const planDefinitionId = await upsertConditionResource(medplum, module);
      await refreshCondition(medplum, module.id);
      log.info('conditions.saved', { condition: module.id, planDefinitionId, update: !!condMatch });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: module.id, planDefinitionId }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('conditions.save_error', { message });
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // Create a custom patient + start the outbound call.
  if (req.method === 'POST' && url.pathname === '/intake') {
    try {
      const body = await readBody(req);
      const input = JSON.parse(body || '{}') as {
        givenName: string;
        familyName: string;
        dob: string;
        phone?: string;
        conditionId: string;
        coverage?: PatientContext['coverage'];
      };
      const { patientId, moduleId } = await createIntakePatient({
        givenName: input.givenName,
        familyName: input.familyName,
        dob: input.dob,
        phone: input.phone,
        conditionId: input.conditionId,
        coverage: input.coverage,
      });
      // The call/stream carries the MODULE id (e.g. 'depression') so the bridge
      // loads the right flow — not the FHIR Condition resource id.
      const { callSid } = await startOutboundCall({
        to: input.phone ?? '',
        patientId,
        conditionId: moduleId,
      });
      await recordCallInitiated({ patientId, conditionId: moduleId, callSid, to: input.phone });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ patientId, conditionId: moduleId, callSid }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('intake.error', { message });
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // Start an outbound call for an EXISTING patient (module id + phone).
  if (req.method === 'POST' && url.pathname === '/call') {
    try {
      const body = await readBody(req);
      const input = JSON.parse(body || '{}') as {
        patientId: string;
        conditionId: string;
        phone: string;
      };
      if (!input.patientId || !input.phone) throw new Error('patientId and phone are required');
      const conditionId = input.conditionId || DEFAULT_CONDITION_ID;
      const { callSid } = await startOutboundCall({
        to: input.phone,
        patientId: input.patientId,
        conditionId,
      });
      await recordCallInitiated({ patientId: input.patientId, conditionId, callSid, to: input.phone });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ patientId: input.patientId, callSid }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('call.error', { message });
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/voice') {
    const body = await readBody(req);
    const params = Object.fromEntries(new URLSearchParams(body));
    const fullUrl = `https://${req.headers.host}${req.url}`;
    const sig = (req.headers['x-twilio-signature'] as string) ?? '';
    if (!verifyTwilioSignature({ url: fullUrl, signature: sig, params })) {
      log.warn('twilio.signature_invalid', { from: params.From });
      res.writeHead(403).end('invalid signature');
      return;
    }
    const patientId = url.searchParams.get('patientId') ?? '';
    const conditionId = url.searchParams.get('conditionId') ?? '';
    log.info('call.incoming', { from: params.From, callSid: params.CallSid, patientId, conditionId });
    const twiml = twimlConnectStream(streamUrl(), { patientId, conditionId });
    res.writeHead(200, { 'content-type': 'text/xml' });
    res.end(twiml);
    return;
  }

  res.writeHead(404).end('not found');
});

// ── WS: Twilio media stream ⇄ Deepgram ───────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/twilio' });

wss.on('connection', (twilioWs: WebSocket) => {
  let streamSid = '';
  let session: CallSession | null = null;
  let agent: DeepgramAgentHandle | null = null;
  let deps: ToolDeps | null = null;
  let sm: FlowStateMachine | null = null;
  const mode = config.orchMode;
  let activeCallSid = '';
  let callStartMs = 0;
  let finalized = false;
  let processed = false;
  // Call ending (industry-standard pattern): the agent calls the `endCall` tool
  // when the conversation is truly done (after goodbye, no more questions). Only
  // THEN do we drain the final goodbye audio and hang up — estimated from the
  // μ-law bytes streamed to Twilio (8kHz = 8000 bytes/sec), since Deepgram's
  // AgentAudioDone fires before the audio has actually played. No countdown runs
  // before endCall, so the patient can ask anything after the recap. A long
  // safety fallback (armed at submit) still ends the call if endCall never comes.
  let awaitingHangup = false;
  let hangupTimer: ReturnType<typeof setTimeout> | undefined;
  let firstAudioMs = 0;
  let audioBytesSinceEnd = 0;
  const MULAW_BYTES_PER_SEC = 8000;
  const HANGUP_TAIL_MS = 3000; // let the goodbye audio finish playing
  const ENDCALL_MAX_MS = 12000; // ceiling after endCall
  const SUBMIT_SAFETY_MS = 120000; // absolute safety if the agent never ends
  const scheduleDrainHangup = () => {
    if (!awaitingHangup) return;
    const now = Date.now();
    const playbackEndMs = (firstAudioMs || now) + (audioBytesSinceEnd / MULAW_BYTES_PER_SEC) * 1000;
    const fireInMs = Math.min(Math.max(playbackEndMs + HANGUP_TAIL_MS - now, 1500), ENDCALL_MAX_MS);
    if (hangupTimer) clearTimeout(hangupTimer);
    hangupTimer = setTimeout(hangUp, fireInMs);
  };
  const armSafetyHangup = () => {
    if (awaitingHangup) return; // an active drain takes precedence
    if (hangupTimer) clearTimeout(hangupTimer);
    hangupTimer = setTimeout(hangUp, SUBMIT_SAFETY_MS);
  };
  const endCallDrain = () => {
    awaitingHangup = true;
    firstAudioMs = 0;
    audioBytesSinceEnd = 0;
    scheduleDrainHangup();
  };

  const sendToTwilio = (mulaw: Buffer) => {
    if (!streamSid) return;
    twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: { payload: mulaw.toString('base64') } }));
  };
  const clearTwilio = () => {
    if (streamSid) twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
  };
  const finalizeCall = () => {
    if (finalized || !activeCallSid) return;
    finalized = true;
    const durationSeconds = callStartMs ? Math.round((Date.now() - callStartMs) / 1000) : undefined;
    void updateCall(activeCallSid, { status: 'completed', endedAt: new Date().toISOString(), durationSeconds });
    // Build the plan on ANY terminal path (graceful hangup OR the patient hanging
    // up). processSubmission salvages a completed-but-unsubmitted interview and
    // no-ops when too little was captured. Idempotent via `processed`.
    if (!processed && session && (session.questionnaireResponse || session.answers.size > 0)) {
      processed = true;
      void processSubmission(session);
    }
  };
  // End the phone call from our side: closing the Twilio media-stream WS ends the
  // <Connect><Stream> verb, so (with no further TwiML) Twilio hangs up the PSTN leg.
  const hangUp = () => {
    log.info('call.hangup', { callSid: activeCallSid });
    finalizeCall();
    try {
      agent?.close();
    } catch {
      /* ignore */
    }
    try {
      twilioWs.close();
    } catch {
      /* ignore */
    }
    // The heavy post-call work (draft plan, research, expert panel, coverage,
    // persist) runs from finalizeCall() above — once, only if the patient got far
    // enough to submit — so it fires on graceful hangups AND abrupt disconnects.
  };

  const startCall = async (customParameters: Record<string, string>, callSid: string) => {
    const module =
      getCondition(customParameters.conditionId ?? '') ?? requireCondition(DEFAULT_CONDITION_ID);
    const patient = await getPatientContextForCall(customParameters);
    patient.conditionModuleId = module.id;
    const flow: FlowSpec = buildIntakeFlow(module);
    const vars = buildDynamicVars(patient);
    session = newSession(callSid || streamSid, patient);
    deps = await defaultToolDeps();

    let systemPrompt: string;
    let functions: unknown[];
    if (mode === 'state') {
      sm = new FlowStateMachine(flow, vars);
      const v = sm.view();
      systemPrompt = v.instruction;
      functions = withCareContext(v.functions);
    } else {
      systemPrompt = renderSystemPrompt(flow, vars);
      functions = toDeepgramFunctions(TOOL_SCHEMAS);
    }

    log.info('call.start', { callSid, patientId: patient.patientId, mode });
    activeCallSid = callSid;
    callStartMs = Date.now();
    void updateCall(callSid, { status: 'in-progress', startedAt: new Date().toISOString() });

    agent = connectDeepgramAgent({
      systemPrompt,
      functions,
      greeting: `Hi ${patient.givenName}, this is Maya from the clinic.`,
      callbacks: {
        onReady: () => log.info('deepgram.ready', { callSid }),
        onAudio: (mulaw) => {
          sendToTwilio(mulaw);
          if (awaitingHangup) {
            if (!firstAudioMs) firstAudioMs = Date.now();
            audioBytesSinceEnd += mulaw.length;
            scheduleDrainHangup(); // hang up once the goodbye audio finishes playing
          }
        },
        onUserText: (t) => {
          clearTwilio(); // barge-in
          log.info('call.user', { t });
          // Patient spoke after the agent tried to end — they have more to say, so
          // cancel the drain and let the agent respond (it will endCall again).
          if (awaitingHangup) {
            awaitingHangup = false;
            armSafetyHangup();
          }
          if (mode === 'state' && sm && CONVERSATION_ADVANCE_NODES.has(sm.currentNodeId)) {
            advance();
          }
        },
        onAgentText: (t) => log.info('call.agent', { t }),
        onFunctionCall: async (fc) => {
          if (!session || !deps || !agent) return;
          const result = await runTool(fc.name as ToolName, fc.arguments ?? {}, session, deps, fc.id);
          agent.sendFunctionResult(fc.id, fc.name, result);
          if (result.data?.submitted) {
            // Arm only a long safety net — the call ends when the agent calls
            // endCall, not on a timer, so the recap + any questions run freely.
            armSafetyHangup();
          }
          if (result.data?.endCall) {
            // Agent signalled the conversation is done — drain the goodbye audio.
            log.info('call.endcall', { callSid });
            endCallDrain();
          }
          if (mode === 'state' && sm) {
            const charted = result.data?.charted;
            const submitted = result.data?.submitted;
            // Advance on any charted instrument answer (not a free-text concern) or on submit.
            if ((typeof charted === 'string' && charted !== 'concern') || submitted) advance();
          }
        },
        onClose: () => log.info('deepgram.closed', { callSid }),
      },
    });
  };

  const advance = () => {
    if (!sm || !agent) return;
    const v = sm.advance();
    agent.updatePrompt(v.instruction, withCareContext(v.functions));
    log.info('flow.advance', { node: v.nodeId });
    if (v.isEnd) setTimeout(() => agent?.close(), 4000);
  };

  twilioWs.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.event) {
      case 'start':
        streamSid = msg.start?.streamSid ?? msg.streamSid ?? '';
        void startCall(msg.start?.customParameters ?? {}, msg.start?.callSid ?? '');
        break;
      case 'media':
        if (agent && msg.media?.payload) agent.sendAudio(Buffer.from(msg.media.payload, 'base64'));
        break;
      case 'stop':
        log.info('call.stop', { streamSid });
        finalizeCall();
        agent?.close();
        break;
      default:
        break;
    }
  });

  twilioWs.on('close', () => {
    finalizeCall();
    agent?.close();
    log.info('twilio.ws_closed', { streamSid });
  });
});

// getCareContext is always available (patients ask questions anytime).
function withCareContext(functions: unknown[]): unknown[] {
  const names = new Set(functions.map((f) => (f as { name?: string }).name));
  if (names.has('getCareContext')) return functions;
  const cc = toDeepgramFunctions(TOOL_SCHEMAS.filter((s) => s.name === 'getCareContext'));
  return [...functions, ...cc];
}

async function getPatientContextForCall(custom: Record<string, string>): Promise<PatientContext> {
  const patientId = custom.patientId || config.seed.patientId;
  try {
    const { medplumEnabled } = await import('../medplum/client.js');
    if (patientId && medplumEnabled()) {
      const { loadPatientContext } = await import('../medplum/seed.js');
      return await loadPatientContext(patientId);
    }
  } catch (err) {
    log.warn('patient.load_failed', { error: err instanceof Error ? err.message : String(err) });
  }
  return demoPatientContext(patientId);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

server.listen(config.port, () => {
  log.info('bridge.listening', { port: config.port, mode: config.orchMode, streamUrl: streamUrl() });
  // Overlay any Medplum-stored treatments on the code-defined seeds (best-effort).
  if (medplumEnabled()) {
    getMedplum()
      .then((medplum) => initConditionRegistry(medplum))
      .catch((err) => log.warn('registry.init_failed', { error: err instanceof Error ? err.message : String(err) }));
  }
});
