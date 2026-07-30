import type { ConditionModule, InstrumentItem } from './types.js';
import type { MedOrder } from '../types.js';
import { expertPrompt } from './asthma.js';
import { SYSTEM } from '../clinical/codes.js';

/**
 * Depression treatment module (PHQ-9 → stepped care). Proves the registry is
 * generic: a 0–3 scale, 9 items, higher = worse, ICD-10 F32.9, and a distinct
 * crisis protocol (item 9 / self-harm → 988).
 *
 * ⚠️ RxCUIs are best-known values, validated at runtime via Medplum $lookup.
 */

const SCALE = '0 = not at all, 1 = several days, 2 = more than half the days, 3 = nearly every day';

const PHQ9: [string, string, string][] = [
  ['q1', '44250-9', 'Little interest or pleasure in doing things'],
  ['q2', '44255-8', 'Feeling down, depressed, or hopeless'],
  ['q3', '44259-0', 'Trouble falling or staying asleep, or sleeping too much'],
  ['q4', '44254-1', 'Feeling tired or having little energy'],
  ['q5', '44251-7', 'Poor appetite or overeating'],
  ['q6', '44258-2', 'Feeling bad about yourself, or that you are a failure or have let people down'],
  ['q7', '44252-5', 'Trouble concentrating on things, such as reading or watching television'],
  ['q8', '44253-3', 'Moving or speaking so slowly that others could notice — or being fidgety/restless'],
  ['q9', '44260-8', 'Thoughts that you would be better off dead, or of hurting yourself'],
];

const items: InstrumentItem[] = PHQ9.map(([linkId, loinc, prompt]) => ({
  linkId,
  loinc,
  prompt: `Over the last 2 weeks, how often have you been bothered by: ${prompt}?`,
  scale: SCALE,
  min: 0,
  max: 3,
}));

const GLOBAL_PROMPT = `You are Maya, a warm, calm virtual care coordinator making a PRE-VISIT check-in call for {{givenName}}'s upcoming appointment. You are not a therapist and never diagnose or give treatment advice — you gently ask a standard set of questions and note responses for the care team.

STYLE: gentle, unhurried, 1–2 short sentences, ONE question at a time, wait for the answer, warm acknowledgements. These questions can feel personal — be kind and non-judgmental.

CRISIS OVERRIDE (beats everything): if {{givenName}} expresses thoughts of self-harm, suicide, or being better off dead, respond with care ONCE: "Thank you for telling me — that matters. If you're having thoughts of harming yourself, please reach out right now: call or text 988, the Suicide and Crisis Lifeline, any time. Are you safe right now?" Stay supportive, do not continue the routine questions until safety is addressed, and this will be flagged urgently for the care team.

Never mention tools, systems, scores, or that this is automated.`;

const ssri = { rxcui: '312940', display: 'Sertraline 50 mg oral tablet (SSRI)' };

/** First-line SSRI, started at 50 mg PO daily (role controller). */
const sertralineOrder: MedOrder = {
  rxcui: ssri.rxcui,
  display: ssri.display,
  role: 'controller',
  sig: 'Take 50 mg (1 tablet) by mouth once daily.',
  doseText: '50 mg daily',
  route: 'oral',
  frequency: 'once daily',
  quantity: 30,
  refills: 2,
  prn: false,
};

/** minimal & mild: no pharmacotherapy → empty regimen. */
const NO_MEDS: MedOrder[] = [];

export const DEPRESSION: ConditionModule = {
  id: 'depression',
  label: 'Depression (PHQ-9)',
  conditionCodes: {
    icd10: { system: SYSTEM.ICD10, code: 'F32.9', display: 'Major depressive disorder, single episode, unspecified' },
    snomed: { system: SYSTEM.SNOMED, code: '370143000', display: 'Major depression' },
  },

  instrument: {
    name: 'PHQ-9',
    panelLoinc: '44249-1',
    totalLoinc: '44261-6',
    direction: 'higherIsWorse',
    items,
    bands: [
      { id: 'minimal', label: 'minimal', min: 0, max: 4 },
      { id: 'mild', label: 'mild', min: 5, max: 9 },
      { id: 'moderate', label: 'moderate', min: 10, max: 14 },
      { id: 'moderately-severe', label: 'moderately severe', min: 15, max: 19 },
      { id: 'severe', label: 'severe', min: 20, max: 27 },
    ],
  },

  protocol: {
    minimal: { bandId: 'minimal', summary: 'Minimal symptoms. Continue watchful waiting; re-screen at follow-up. No new pharmacotherapy indicated.', medications: NO_MEDS, medRxcui: '', medDisplay: 'No new medication — watchful waiting', followUpWeeks: 12, escalate: false, goal: 'Maintain PHQ-9 < 5.' },
    mild: { bandId: 'mild', summary: 'Mild symptoms. Offer behavioral activation / guided self-help and consider a therapy referral; shared decision-making on medication.', medications: NO_MEDS, medRxcui: '', medDisplay: 'No new medication — behavioral activation / therapy referral', specialistReferral: true, followUpWeeks: 4, escalate: false, goal: 'Reduce PHQ-9 by ≥ 5 points or to < 5.' },
    moderate: { bandId: 'moderate', summary: 'Moderate symptoms. Initiate first-line SSRI and/or psychotherapy; review adherence and side effects at follow-up.', medications: [sertralineOrder], medRxcui: ssri.rxcui, medDisplay: ssri.display, followUpWeeks: 3, escalate: false, goal: 'Achieve ≥ 50% PHQ-9 reduction within 6–8 weeks.' },
    'moderately-severe': { bandId: 'moderately-severe', summary: 'Moderately severe symptoms. Start SSRI plus psychotherapy; arrange behavioral-health referral and closer follow-up.', medications: [sertralineOrder], medRxcui: ssri.rxcui, medDisplay: ssri.display, specialistReferral: true, followUpWeeks: 2, escalate: false, goal: 'Symptom remission (PHQ-9 < 5) with close monitoring.' },
    severe: { bandId: 'severe', summary: 'Severe symptoms. Start SSRI, expedite psychiatry referral, and assess safety urgently.', medications: [sertralineOrder], medRxcui: ssri.rxcui, medDisplay: ssri.display, specialistReferral: true, followUpWeeks: 1, escalate: true, goal: 'Urgent stabilization and safety; expedited psychiatry follow-up.' },
  },

  moss: {
    indexName: 'careloop-depression-kb',
    corpus: [
      { id: 'dep-phq9', source: 'Understanding the PHQ-9', text: 'The PHQ-9 is nine questions about the last two weeks. It helps your care team understand how you have been feeling and track changes over time. It is a conversation starter, not a diagnosis.' },
      { id: 'dep-ssri', source: 'About Antidepressants (SSRIs)', text: 'SSRIs are common first-line antidepressants. They usually take 2–6 weeks to help, and early side effects often ease. Do not stop suddenly — talk with your clinician about any concerns.' },
      { id: 'dep-therapy', source: 'Talk Therapy Options', text: 'Talk therapies like CBT can help as much as medication for many people, and can be combined with it. Your care team can help arrange a referral.' },
      { id: 'dep-sleep', source: 'Sleep and Mood', text: 'Sleep and mood are closely linked. Keeping a regular sleep schedule, limiting screens before bed, and getting daylight can help. Tell your team if sleep problems persist.' },
      { id: 'dep-crisis', source: 'Getting Help Now', text: 'If you are thinking about harming yourself, you are not alone and help is available 24/7. Call or text 988 (the Suicide and Crisis Lifeline) any time.' },
    ],
  },

  agent: { globalPrompt: GLOBAL_PROMPT },

  researchTopicTemplate:
    'Stepped-care management for {{conditionDisplay}} at {{bandLabel}} severity (PHQ-9 {{total}}/27), including SSRI vs psychotherapy choice and safety considerations',

  expertPanel: [
    { key: 'psychiatry', label: 'Psychiatry', systemPrompt: expertPrompt('a psychiatry reviewer', 'Assess whether the stepped-care choice (watchful waiting vs therapy vs SSRI vs referral) matches the PHQ-9 severity band and whether safety/escalation is adequate, especially with any item-9 (self-harm) endorsement.') },
    { key: 'clinical-pharmacist', label: 'Clinical pharmacist', systemPrompt: expertPrompt('a clinical pharmacist reviewer', 'Assess SSRI choice, starting dose, titration, interactions (e.g. other serotonergic agents), and monitoring; flag contraindications given current meds.') },
    { key: 'patient-safety', label: 'Patient safety', systemPrompt: expertPrompt('a patient-safety reviewer', 'Check for missing suicide-risk escalation, adequacy of follow-up interval, and a documented safety plan when severity or item-9 warrant it.') },
  ],
};
