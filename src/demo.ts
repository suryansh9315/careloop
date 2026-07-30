import type { PatientContext } from './types.js';

/**
 * Shared demo fixture (Maria Reyes) used by the offline simulator and as the
 * bridge's fallback when Medplum isn't configured. Kept side-effect-free so it
 * can be imported anywhere.
 */
export function demoPatientContext(patientId = 'demo-maria'): PatientContext {
  return {
    patientId,
    conditionId: 'demo-condition',
    conditionModuleId: 'asthma',
    appointmentId: 'demo-appointment',
    givenName: 'Maria',
    familyName: 'Reyes',
    dob: '1979-05-14',
    conditionCode: 'J45.40',
    conditionDisplay: 'Moderate persistent asthma',
    currentMedications: ['Budesonide low-dose inhaler'],
    allergies: ['cat dander'],
    triggers: ['cat dander', 'nighttime symptoms'],
    priorActScores: [
      { date: '2026-04-30', total: 22 },
      { date: '2026-06-30', total: 19 },
    ],
  };
}

/** Scripted answers producing ACT total 14 → "very poorly controlled" (poor band). */
export const SCRIPTED_ACT_ANSWERS: { linkId: string; value: number; note: string }[] = [
  { linkId: 'act1', value: 3, note: 'missed some work when it flared' },
  { linkId: 'act2', value: 2, note: 'short of breath most days' },
  { linkId: 'act3', value: 2, note: 'waking up coughing ~3 nights a week' },
  { linkId: 'act4', value: 3, note: 'using the blue inhaler a few times a week' },
  { linkId: 'act5', value: 4, note: 'feels mostly okay but not great' },
];

export const SCRIPTED_QUESTION = 'Should I be using my blue inhaler more often?';

export const SCRIPTED_CONCERNS: string[] = ['an itchy rash on my forearm thats been there about a week'];
