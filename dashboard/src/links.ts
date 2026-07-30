/** Base URL for deep-linking to the Medplum admin app. */
export const MEDPLUM_APP_URL = 'https://app.medplum.com';

/** Build a link to a Patient in the Medplum admin app. */
export function medplumPatientUrl(patientId: string): string {
  return `${MEDPLUM_APP_URL}/Patient/${patientId}`;
}
