import WebSocket from 'ws';
import { config } from '../config.js';
import { log } from '../logger.js';

/**
 * Deepgram Voice Agent ("Agent Converse") WebSocket client.
 *
 * This wraps the single duplex WebSocket that carries BOTH the conversation
 * control plane (JSON messages) and the media plane (binary audio frames). The
 * bridge stays transport-agnostic: it only ever touches the returned handle +
 * callbacks, so we can swap the mock in with zero credentials.
 *
 * ── Assumed protocol (CONFIRM against Deepgram docs before going live) ──────────
 * Endpoint:  wss://agent.deepgram.com/v1/agent/converse
 * Auth:      subprotocols ['token', <DEEPGRAM_API_KEY>]  (Deepgram-style token auth)
 *
 * 1. Client → server, first message: a JSON `Settings` object describing audio
 *    in/out encodings and the agent (listen/think/speak). We configure:
 *      - audio.input  = mulaw @ 8000 Hz   (Twilio PCMU)
 *      - audio.output = mulaw @ 8000 Hz   (sent straight back to Twilio)
 *      - agent.think  = an LLM provider + system `prompt` + `functions`
 *      - agent.greeting = optional opening line
 *
 * 2. Client → server: raw binary μ-law frames as the caller speaks.
 *
 * 3. Server → client, JSON events we care about (by `type`):
 *      - 'Welcome' / 'SettingsApplied'  → session ready
 *      - 'ConversationText' { role: 'user'|'assistant', content } → transcripts
 *      - 'UserStartedSpeaking'          → (barge-in; ignored here)
 *      - 'FunctionCallRequest' { functions: [{ id, name, arguments }] } OR a flat
 *        { function_call_id, function_name, input } → our tools to run
 *      - 'AgentAudioDone' / 'Error' / 'Warning'
 *    Server → client binary frames = agent TTS audio (μ-law) → forward to caller.
 *
 * 4. Client → server control messages we send:
 *      - { type: 'UpdatePrompt', prompt, functions }        (per-node re-prompt)
 *      - { type: 'FunctionCallResponse', id, name?, content } (tool result)
 *
 * All field names above are best-effort; keep them isolated to build/parse
 * helpers below so a schema fix is a one-line change.
 */

const AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';

export type DeepgramAgentHandle = {
  sendAudio(mulaw: Buffer): void;
  updatePrompt(instruction: string, functions?: unknown[]): void;
  sendFunctionResult(id: string, name: string, result: unknown): void;
  close(): void;
};

export type DeepgramAgentCallbacks = {
  onReady?: () => void;
  onUserText?: (t: string) => void;
  onAgentText?: (t: string) => void;
  onAudio?: (mulaw: Buffer) => void;
  onFunctionCall?: (fc: { id: string; name: string; arguments: any }) => void;
  onClose?: () => void;
};

export type ConnectDeepgramAgentOpts = {
  systemPrompt: string;
  functions: unknown[];
  callbacks: DeepgramAgentCallbacks;
  greeting?: string;
};

/** Build the initial `Settings` message for μ-law @ 8000 in and out. */
function buildSettings(opts: ConnectDeepgramAgentOpts): Record<string, unknown> {
  return {
    type: 'Settings',
    audio: {
      input: { encoding: 'mulaw', sample_rate: 8000 },
      output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' },
    },
    agent: {
      language: 'en',
      listen: { provider: { type: 'deepgram', model: 'nova-3' } },
      think: {
        provider: { type: 'open_ai', model: 'gpt-4o-mini' },
        prompt: opts.systemPrompt,
        functions: opts.functions,
      },
      speak: { provider: { type: 'deepgram', model: 'aura-2-thalia-en' } },
      ...(opts.greeting ? { greeting: opts.greeting } : {}),
    },
  };
}

// ── MOCK ────────────────────────────────────────────────────────────────────
// No key configured: return a handle that just logs and reports ready, so the
// bridge can be constructed and exercised offline. It emits no audio/text.
function mockHandle(callbacks: DeepgramAgentCallbacks): DeepgramAgentHandle {
  log.info('deepgram.mock', { reason: 'no-api-key' });
  // Fire onReady on next tick so callers can finish wiring first.
  setImmediate(() => callbacks.onReady?.());
  let closed = false;
  return {
    sendAudio(_mulaw: Buffer): void {
      /* swallow audio in mock mode */
    },
    updatePrompt(instruction: string): void {
      log.debug('deepgram.mock.updatePrompt', { instruction });
    },
    sendFunctionResult(id: string, name: string, result: unknown): void {
      log.debug('deepgram.mock.functionResult', { id, name, result });
    },
    close(): void {
      if (closed) return;
      closed = true;
      log.info('deepgram.mock.close', {});
      callbacks.onClose?.();
    },
  };
}

// ── Incoming JSON event parsing ───────────────────────────────────────────────
function extractFunctionCalls(
  msg: Record<string, any>,
): Array<{ id: string; name: string; arguments: any }> {
  // Shape A: { type:'FunctionCallRequest', functions:[{ id, name, arguments }] }
  if (Array.isArray(msg.functions)) {
    return msg.functions.map((f: any) => ({
      id: String(f.id ?? f.function_call_id ?? ''),
      name: String(f.name ?? f.function_name ?? ''),
      arguments: normalizeArgs(f.arguments ?? f.input),
    }));
  }
  // Shape B: flat single call
  const id = msg.function_call_id ?? msg.id;
  const name = msg.function_name ?? msg.name;
  if (id && name) {
    return [{ id: String(id), name: String(name), arguments: normalizeArgs(msg.input ?? msg.arguments) }];
  }
  return [];
}

function normalizeArgs(raw: unknown): any {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { _raw: raw };
    }
  }
  return raw;
}

// ── LIVE ──────────────────────────────────────────────────────────────────────
function liveHandle(opts: ConnectDeepgramAgentOpts): DeepgramAgentHandle {
  const { callbacks } = opts;
  log.info('deepgram.live', { url: AGENT_URL });

  // Deepgram token auth via WebSocket subprotocol.
  const ws = new WebSocket(AGENT_URL, ['token', config.deepgram.apiKey]);

  let ready = false;
  let closed = false;
  // Buffer audio frames sent before the socket opens; flush on open.
  const pending: Buffer[] = [];

  const send = (obj: Record<string, unknown>): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  ws.on('open', () => {
    log.info('deepgram.open', {});
    send(buildSettings(opts));
    for (const buf of pending) ws.send(buf);
    pending.length = 0;
  });

  ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
    // Binary frames = agent TTS audio (μ-law) → forward to the caller.
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      callbacks.onAudio?.(buf);
      return;
    }

    let msg: Record<string, any>;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      log.warn('deepgram.badjson', {});
      return;
    }

    switch (msg.type) {
      case 'Welcome':
      case 'SettingsApplied': {
        if (!ready) {
          ready = true;
          callbacks.onReady?.();
        }
        break;
      }
      case 'ConversationText': {
        const content = String(msg.content ?? '');
        if (msg.role === 'user') callbacks.onUserText?.(content);
        else callbacks.onAgentText?.(content);
        break;
      }
      case 'FunctionCallRequest': {
        for (const fc of extractFunctionCalls(msg)) callbacks.onFunctionCall?.(fc);
        break;
      }
      case 'Error':
      case 'Warning': {
        log.warn('deepgram.server_event', { type: msg.type, message: msg.message ?? msg.description });
        break;
      }
      default:
        log.debug('deepgram.event', { type: msg.type });
    }
  });

  ws.on('close', (code: number) => {
    if (closed) return;
    closed = true;
    log.info('deepgram.close', { code });
    callbacks.onClose?.();
  });

  ws.on('error', (err: Error) => {
    log.error('deepgram.error', { error: err.message });
  });

  return {
    sendAudio(mulaw: Buffer): void {
      if (closed) return;
      if (ws.readyState === WebSocket.OPEN) ws.send(mulaw);
      else pending.push(mulaw);
    },
    updatePrompt(instruction: string): void {
      // Deepgram UpdatePrompt only carries `prompt` (no functions — the function
      // list is fixed at Settings time) and ADDS to the running prompt. State mode
      // uses this to nudge per-node; single-prompt mode never calls it.
      send({ type: 'UpdatePrompt', prompt: instruction });
    },
    sendFunctionResult(id: string, name: string, result: unknown): void {
      const content = typeof result === 'string' ? result : JSON.stringify(result);
      send({ type: 'FunctionCallResponse', id, name, content });
    },
    close(): void {
      if (closed) return;
      closed = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

export function connectDeepgramAgent(opts: ConnectDeepgramAgentOpts): DeepgramAgentHandle {
  return config.deepgram.enabled ? liveHandle(opts) : mockHandle(opts.callbacks);
}
