import { MedplumClient } from '@medplum/core';
import { config } from '../config.js';
import { log } from '../logger.js';

/**
 * Medplum client bootstrap for the live-call hot path and seed scripts.
 *
 * Auth uses the client-credentials flow (`startClientLogin`) so the same
 * singleton serves live charting, the final QuestionnaireResponse write, and the
 * seed batch. When credentials are absent the whole Medplum path is disabled and
 * callers fall back to deterministic mocks (see `medplumEnabled`).
 */

let singleton: MedplumClient | undefined;
let loginInFlight: Promise<MedplumClient> | undefined;

/** True when both a client id and secret are configured. */
export function medplumEnabled(): boolean {
  return config.medplum.enabled;
}

/**
 * Return the authenticated, cached MedplumClient. Throws a clear error when
 * Medplum is not configured — callers that support a mock path should gate on
 * `medplumEnabled()` first.
 */
export async function getMedplum(): Promise<MedplumClient> {
  if (!medplumEnabled()) {
    throw new Error(
      'Medplum is not enabled — set MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET (or gate on medplumEnabled()).',
    );
  }
  if (singleton) return singleton;
  if (loginInFlight) return loginInFlight;

  loginInFlight = (async () => {
    const medplum = new MedplumClient({ baseUrl: config.medplum.baseUrl });
    await medplum.startClientLogin(config.medplum.clientId, config.medplum.clientSecret);
    singleton = medplum;
    log.info('medplum.login', { baseUrl: config.medplum.baseUrl });
    return medplum;
  })();

  try {
    return await loginInFlight;
  } finally {
    loginInFlight = undefined;
  }
}
