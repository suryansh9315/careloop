/**
 * Medplum client wiring for the dashboard.
 *
 * The dashboard is LIVE-ONLY: it always requires an interactive Medplum
 * sign-in and always reads real data. Provide VITE_MEDPLUM_BASE_URL +
 * VITE_MEDPLUM_CLIENT_ID (and VITE_PATIENT_ID for the patient to load). The
 * user signs in with their Medplum email + password; the client persists the
 * session in local storage, so a refresh keeps them signed in.
 */
import { MedplumClient } from '@medplum/core';
import type { ProfileResource } from '@medplum/core';

const env = import.meta.env;

export const MEDPLUM_BASE_URL = env.VITE_MEDPLUM_BASE_URL ?? 'https://api.medplum.com/';
export const MEDPLUM_CLIENT_ID = env.VITE_MEDPLUM_CLIENT_ID ?? '';
export const MEDPLUM_PROJECT_ID = env.VITE_MEDPLUM_PROJECT_ID ?? '';
/** Patient to load (empty until VITE_PATIENT_ID is configured). */
export const LIVE_PATIENT_ID = env.VITE_PATIENT_ID ?? '';

/** Category token identifying the backend-published dashboard plan artifact. */
export const ARTIFACT_CATEGORY = 'https://careloop.demo|careloop-dashboard';

/** Category token identifying a call-log Communication. */
export const CALL_CATEGORY = 'https://careloop.demo|careloop-call';

export const medplum = new MedplumClient({
  baseUrl: MEDPLUM_BASE_URL,
  clientId: MEDPLUM_CLIENT_ID || undefined,
  cacheTime: 60_000,
});

/**
 * Interactive email + password login.
 *
 * Runs the standard Medplum login handshake (startLogin → processCode) and, on
 * success, establishes the session on the shared `medplum` client. The client
 * persists the session, so a refresh keeps the user signed in until they sign
 * out. Throws on bad credentials so the login card can surface the message.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<ProfileResource> {
  const result = await medplum.startLogin({
    email,
    password,
    clientId: MEDPLUM_CLIENT_ID || undefined,
    projectId: MEDPLUM_PROJECT_ID || undefined,
    scope: 'openid',
  });
  if (!result.code) {
    throw new Error('Login did not return an authorization code.');
  }
  return medplum.processCode(result.code);
}
