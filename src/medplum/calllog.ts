import { getMedplum, medplumEnabled } from './client.js';
import { log } from '../logger.js';

/**
 * Lightweight call log backed by Medplum. Each call is a Communication tagged
 * `careloop-call`, keyed by the Twilio callSid (identifier), carrying a JSON
 * payload with direction/status/timing. The dashboard Calls page reads these.
 */

export const CALL_SYSTEM = 'https://careloop.demo';
export const CALL_CODE = 'careloop-call';
export const CALLSID_SYSTEM = 'https://careloop.demo/callSid';

export type CallStatus = 'initiated' | 'in-progress' | 'completed' | 'failed' | 'no-answer';

export type CallRecord = {
  callSid: string;
  patientId: string;
  conditionId: string;
  direction: 'outbound' | 'inbound';
  status: CallStatus;
  to?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
};

export async function recordCallInitiated(rec: {
  patientId: string;
  conditionId: string;
  callSid: string;
  to?: string;
  direction?: 'outbound' | 'inbound';
}): Promise<string | null> {
  if (!medplumEnabled() || !rec.callSid) return null;
  try {
    const medplum = await getMedplum();
    const payload: CallRecord = {
      callSid: rec.callSid,
      patientId: rec.patientId,
      conditionId: rec.conditionId,
      direction: rec.direction ?? 'outbound',
      status: 'initiated',
      to: rec.to,
    };
    const created = await medplum.createResource({
      resourceType: 'Communication',
      status: 'in-progress',
      category: [{ coding: [{ system: CALL_SYSTEM, code: CALL_CODE }] }],
      identifier: [{ system: CALLSID_SYSTEM, value: rec.callSid }],
      subject: { reference: `Patient/${rec.patientId}` },
      sent: new Date().toISOString(),
      payload: [{ contentString: JSON.stringify(payload) }],
    });
    log.info('calllog.initiated', { callSid: rec.callSid, id: created.id });
    return created.id ?? null;
  } catch (err) {
    log.warn('calllog.init_failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Merge a status/timing update into the call record identified by callSid. */
export async function updateCall(callSid: string, patch: Partial<CallRecord>): Promise<void> {
  if (!medplumEnabled() || !callSid) return;
  try {
    const medplum = await getMedplum();
    const existing = await medplum.searchOne('Communication', {
      identifier: `${CALLSID_SYSTEM}|${callSid}`,
    });
    if (!existing?.id) return;
    let prev: CallRecord;
    try {
      prev = JSON.parse(existing.payload?.[0]?.contentString ?? '{}') as CallRecord;
    } catch {
      prev = { callSid, patientId: '', conditionId: '', direction: 'outbound', status: 'initiated' };
    }
    const next = { ...prev, ...patch };
    await medplum.updateResource({
      ...existing,
      status: next.status === 'completed' ? 'completed' : 'in-progress',
      payload: [{ contentString: JSON.stringify(next) }],
    });
    log.info('calllog.updated', { callSid, status: next.status });
  } catch (err) {
    log.warn('calllog.update_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
