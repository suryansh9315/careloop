import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { log } from '../logger.js';

/**
 * Provider-agnostic LLM layer for the post-call workers (research + expert panel).
 * Supports BOTH Groq (OpenAI-compatible chat completions, via fetch — no extra SDK)
 * and Anthropic (via @anthropic-ai/sdk). Selected by `LLM_PROVIDER` (default groq).
 * Callers ask for JSON and get a parsed object; any failure throws so the worker
 * falls back to its deterministic mock.
 */

export function llmProvider(): 'groq' | 'anthropic' {
  return config.llm.provider;
}

export function llmEnabled(): boolean {
  return config.llm.provider === 'anthropic' ? config.anthropic.enabled : config.groq.enabled;
}

export function llmLabel(): string {
  return config.llm.provider === 'anthropic'
    ? `anthropic:${config.anthropic.model}`
    : `groq:${config.groq.model}`;
}

export async function chatJSON<T>(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  const text =
    config.llm.provider === 'anthropic' ? await anthropicChat(opts) : await groqChat(opts);
  return parseJsonBlock<T>(text);
}

async function groqChat(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.groq.apiKey}`,
    },
    body: JSON.stringify({
      model: config.groq.model,
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`groq ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('groq: empty content');
  log.debug('llm.groq.ok', { model: config.groq.model });
  return content;
}

async function anthropicChat(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });
  const resp = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.1,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });
  const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
  if (!text.trim()) throw new Error('anthropic: empty content');
  log.debug('llm.anthropic.ok', { model: config.anthropic.model });
  return text;
}

/** Parse the first `{...}` JSON block out of a model response. Throws if none. */
export function parseJsonBlock<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON object found in model response');
  }
  return JSON.parse(text.slice(start, end + 1)) as T;
}
