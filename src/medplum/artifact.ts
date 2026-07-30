import { getMedplum, medplumEnabled } from './client.js';
import { log } from '../logger.js';
import type { DraftPlan, PatientContext } from '../types.js';

/**
 * Publish the fully-computed plan (patient + draft plan with research, peer
 * review, coverage) as a single structured artifact the dashboard can render
 * live — a tagged Communication whose payload is the JSON. This keeps the
 * dashboard from having to re-derive the rich panels from scattered FHIR.
 */

export const ARTIFACT_SYSTEM = 'https://careloop.demo';
export const ARTIFACT_CODE = 'careloop-dashboard';

export async function writeDashboardArtifact(
  patient: PatientContext,
  plan: DraftPlan,
): Promise<string | null> {
  if (!medplumEnabled()) return null;
  try {
    const medplum = await getMedplum();
    const created = await medplum.createResource({
      resourceType: 'Communication',
      status: 'completed',
      category: [{ coding: [{ system: ARTIFACT_SYSTEM, code: ARTIFACT_CODE }] }],
      subject: { reference: `Patient/${patient.patientId}` },
      sent: new Date().toISOString(),
      payload: [{ contentString: JSON.stringify({ patient, plan }) }],
    });
    log.info('artifact.written', { id: created.id, patientId: patient.patientId });
    return created.id ?? null;
  } catch (err) {
    log.warn('artifact.failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
