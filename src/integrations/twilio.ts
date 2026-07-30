import crypto from 'node:crypto';
import { config } from '../config.js';
import { log } from '../logger.js';

/**
 * Twilio helpers: webhook signature verification + the tiny TwiML we return to
 * connect the call's media into our WebSocket bridge.
 *
 * Signature scheme (Twilio "Validating Signatures", X-Twilio-Signature):
 *   1. Take the full request URL (scheme+host+path+query as Twilio saw it).
 *   2. Sort the POST params by key, and append each `key + value` (no separators)
 *      to the URL string.
 *   3. HMAC-SHA1 that string with the account auth token, base64-encode.
 *   4. Compare (timing-safe) against the header value.
 */

/**
 * Verify an inbound Twilio webhook signature.
 *
 * In dev (no auth token configured) this returns `true` and logs a warning so the
 * offline simulator and local ngrok testing work without credentials.
 */
export function verifyTwilioSignature(input: {
  url: string;
  signature: string;
  params: Record<string, string>;
}): boolean {
  const token = config.twilio.authToken;
  if (!token) {
    log.warn('twilio.signature.skip', {
      reason: 'no-auth-token',
      note: 'dev mode: accepting webhook without verification',
    });
    return true;
  }

  // Build the signed payload: URL followed by sorted key+value pairs.
  const { url, params, signature } = input;
  let payload = url;
  for (const key of Object.keys(params).sort()) {
    payload += key + params[key];
  }

  const expected = crypto.createHmac('sha1', token).update(payload, 'utf8').digest('base64');

  // Timing-safe compare; guard against length mismatch (timingSafeEqual throws).
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature ?? '', 'utf8');
  if (a.length !== b.length) {
    log.warn('twilio.signature.reject', { reason: 'length-mismatch' });
    return false;
  }
  const ok = crypto.timingSafeEqual(a, b);
  if (!ok) log.warn('twilio.signature.reject', { reason: 'hmac-mismatch' });
  return ok;
}

/**
 * TwiML that bridges the call's audio into our WebSocket at `wssUrl` via a
 * bidirectional <Connect><Stream>. `<Connect>` (vs `<Start>`) gives us duplex
 * audio so we can send agent TTS back down the same stream.
 */
export function twimlConnectStream(wssUrl: string, params?: Record<string, string>): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const safe = esc(wssUrl);
  const children = Object.entries(params ?? {})
    .map(([name, value]) => `<Parameter name="${esc(name)}" value="${esc(value)}"/>`)
    .join('');
  const stream = children
    ? `<Stream url="${safe}">${children}</Stream>`
    : `<Stream url="${safe}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect>${stream}</Connect></Response>`;
}

/**
 * Start an outbound call via the Twilio REST API. Twilio will fetch our
 * `POST /voice` webhook (with patientId + conditionId in the query) for the TwiML
 * that connects the media stream into our bridge. Throws if Twilio isn't configured.
 */
export async function startOutboundCall(input: {
  to: string;
  patientId: string;
  conditionId: string;
}): Promise<{ callSid: string }> {
  if (!config.twilio.enabled) {
    throw new Error('Twilio is not configured (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)');
  }
  const { accountSid, authToken, phoneNumber } = config.twilio;
  const voiceUrl = `https://${config.publicHost}/voice?patientId=${encodeURIComponent(
    input.patientId,
  )}&conditionId=${encodeURIComponent(input.conditionId)}`;

  const body = new URLSearchParams({
    To: input.to,
    From: phoneNumber,
    Url: voiceUrl,
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );

  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok || !json.sid) {
    throw new Error(`Twilio call failed (${res.status}): ${json.message ?? 'unknown error'}`);
  }
  log.info('twilio.outbound', { callSid: json.sid, to: input.to, patientId: input.patientId });
  return { callSid: json.sid };
}
