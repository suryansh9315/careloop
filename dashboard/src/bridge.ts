/**
 * Thin client for the CareLoop bridge backend (intake + outbound calling).
 * BRIDGE defaults to http://localhost:8080 and can be overridden with
 * VITE_BRIDGE_URL.
 */
import type { ConditionModule } from './types';

export const BRIDGE =
  (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? 'http://localhost:8080';

export type Condition = { id: string; label: string; builtIn?: boolean };

export type IntakeResult = {
  patientId: string;
  /** the module id used for the call (e.g. 'asthma', 'depression') */
  conditionId: string;
  /** present when Twilio placed the outbound call */
  callSid?: string;
  /** present when the patient was created but calling was unavailable */
  error?: string;
};

export type CallResult = {
  callSid?: string;
  error?: string;
};

/** Load the treatment catalog. */
export async function fetchConditions(): Promise<Condition[]> {
  const res = await fetch(`${BRIDGE}/conditions`);
  if (!res.ok) throw new Error(`Could not load treatments (${res.status})`);
  return (await res.json()) as Condition[];
}

/** The full treatment definition plus a builtIn flag (GET /conditions/:id). */
export type ConditionModuleDetail = ConditionModule & { builtIn?: boolean };

/** Load a single full treatment definition for editing. */
export async function fetchConditionModule(id: string): Promise<ConditionModuleDetail> {
  const res = await fetch(`${BRIDGE}/conditions/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Could not load treatment "${id}" (${res.status})`);
  return (await res.json()) as ConditionModuleDetail;
}

/**
 * Create (POST) or update (PUT) a treatment definition. The whole module is
 * sent back; on validation failure the bridge returns `{ error }` with a 400.
 */
export async function saveConditionModule(
  module: ConditionModule,
  opts: { create: boolean },
): Promise<{ id: string; planDefinitionId: string }> {
  const url = opts.create
    ? `${BRIDGE}/conditions`
    : `${BRIDGE}/conditions/${encodeURIComponent(module.id)}`;
  const res = await fetch(url, {
    method: opts.create ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(module),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    planDefinitionId?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
  return { id: json.id ?? module.id, planDefinitionId: json.planDefinitionId ?? '' };
}

/** Place an outbound call for an existing patient. */
export async function startCall(args: {
  patientId: string;
  conditionId: string;
  phone: string;
}): Promise<CallResult> {
  const res = await fetch(`${BRIDGE}/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const json = (await res.json().catch(() => ({}))) as CallResult;
  if (!res.ok) throw new Error(json.error ?? `Call failed (${res.status})`);
  return json;
}
