import type { Communication, Observation } from '@medplum/fhirtypes';
import { ACT_LOINC, SYSTEM } from '../clinical/codes.js';
import { log } from '../logger.js';
import { getMedplum, medplumEnabled } from './client.js';

/**
 * Live charting writes issued during the call as each answer lands. These are
 * best-effort: every write is wrapped so a Medplum hiccup can never throw into
 * the call path. When Medplum is disabled we log a `chart.mock` line (so the
 * dashboard demo still shows the intent) and return null.
 */

/**
 * Chart a free-text line as a provisional Communication (e.g. an ACT recap line
 * or a captured open concern). Returns the created id, or null when mocked.
 */
export async function chartCommunication(
  patientId: string,
  text: string,
): Promise<string | null> {
  if (!medplumEnabled()) {
    log.info('chart.mock', { kind: 'Communication', patientId, text });
    return null;
  }
  try {
    const medplum = await getMedplum();
    const resource: Communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      subject: { reference: `Patient/${patientId}` },
      sent: new Date().toISOString(),
      payload: [{ contentString: text }],
    };
    const created = await medplum.createResource(resource);
    log.info('chart.communication', { patientId, id: created.id });
    return created.id ?? null;
  } catch (err) {
    log.error('chart.communication.error', { patientId, error: String(err) });
    return null;
  }
}

/**
 * Chart a single ACT answer as a preliminary Observation coded with the item's
 * LOINC. `value` is the 1–5 score. Returns the created id, or null when mocked.
 */
export async function chartActObservation(
  patientId: string,
  linkId: string,
  value: number,
  note?: string,
): Promise<string | null> {
  if (!medplumEnabled()) {
    log.info('chart.mock', { kind: 'Observation', patientId, linkId, value, note });
    return null;
  }
  const item = ACT_LOINC.items[linkId as keyof typeof ACT_LOINC.items];
  if (!item) {
    log.warn('chart.observation.unknownLinkId', { patientId, linkId });
    return null;
  }
  try {
    const medplum = await getMedplum();
    const resource: Observation = {
      resourceType: 'Observation',
      status: 'preliminary',
      code: {
        coding: [{ system: SYSTEM.LOINC, code: item.code, display: item.text }],
        text: item.text,
      },
      subject: { reference: `Patient/${patientId}` },
      effectiveDateTime: new Date().toISOString(),
      valueInteger: value,
      ...(note ? { note: [{ text: note }] } : {}),
    };
    const created = await medplum.createResource(resource);
    log.info('chart.observation', { patientId, linkId, id: created.id });
    return created.id ?? null;
  } catch (err) {
    log.error('chart.observation.error', { patientId, linkId, error: String(err) });
    return null;
  }
}
