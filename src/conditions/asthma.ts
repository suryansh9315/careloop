import type { ConditionModule } from './types.js';
import type { MedOrder } from '../types.js';
import { ACT_ITEMS } from '../clinical/act.js';
import { ASTHMA_PROTOCOL } from '../clinical/protocol.js';
import { ACT_LOINC, CONDITION, MED } from '../clinical/codes.js';

/**
 * Structured, coded medication regimens per ACT band (GINA Track 1). Each
 * MedOrder carries a role, human sig, route/frequency and prn flag. The first
 * entry in each array is the "primary" med kept on the step's legacy
 * medRxcui/medDisplay for back-compat + coverage.
 *
 * ⚠️ RxCUIs come from src/clinical/codes.ts (MED) where present; treat as
 * best-known fallbacks, validated at runtime via Medplum $lookup.
 */

// Low-dose ICS controller taken daily.
const icsController: MedOrder = {
  rxcui: MED.budesonideLow.rxcui,
  display: MED.budesonideLow.display,
  role: 'controller',
  sig: 'Inhale 1 puff twice daily; rinse mouth after use.',
  doseText: '90 mcg/actuation',
  route: 'inhalation',
  frequency: 'twice daily',
  quantity: 1,
  refills: 3,
  prn: false,
};

// As-needed ICS-formoterol reliever (GINA Track 1).
const icsFormoterolReliever: MedOrder = {
  rxcui: MED.budesonideFormoterolMed.rxcui,
  display: MED.budesonideFormoterolMed.display,
  role: 'reliever',
  sig: 'Inhale 1 puff as needed for symptoms; up to 6 puffs per day.',
  doseText: '160/4.5 mcg',
  route: 'inhalation',
  frequency: 'as needed',
  quantity: 1,
  refills: 3,
  prn: true,
};

// Step-up ICS-formoterol used as MART (maintenance AND reliever).
const icsFormoterolMart: MedOrder = {
  rxcui: MED.budesonideFormoterolMed.rxcui,
  display: MED.budesonideFormoterolMed.display,
  role: 'controller',
  sig: 'Inhale 2 puffs twice daily as maintenance, and 1 puff as needed for symptoms (MART).',
  doseText: '160/4.5 mcg',
  route: 'inhalation',
  frequency: 'twice daily + as needed',
  quantity: 1,
  refills: 3,
  prn: false,
};

// Short 5-day oral corticosteroid course for an exacerbation.
const prednisoneCourse: MedOrder = {
  rxcui: MED.prednisone.rxcui,
  display: MED.prednisone.display,
  role: 'acute-course',
  sig: 'Take 40 mg (2 tablets of 20 mg) by mouth once daily for 5 days.',
  doseText: '40 mg daily',
  route: 'oral',
  frequency: 'once daily',
  durationDays: 5,
  quantity: 10,
  refills: 0,
  prn: false,
};

const ASTHMA_MEDS: Record<'well' | 'partial' | 'poor', MedOrder[]> = {
  well: [icsController, icsFormoterolReliever],
  partial: [icsFormoterolMart, icsFormoterolReliever],
  poor: [icsFormoterolMart, icsFormoterolReliever, prednisoneCourse],
};

/**
 * Asthma treatment module (Asthma Control Test → GINA step protocol).
 * Wraps the original asthma constants into the generic ConditionModule shape.
 */

const GLOBAL_PROMPT = `You are Maya, a warm, caring care coordinator with {{givenName}}'s clinic. You're calling BEFORE their upcoming appointment for a quick check-in on how they've been — so the care team is prepared for the visit. Right at the start, make sure {{givenName}} knows WHO you are and WHY you're calling (a friendly pre-visit check-in), warmly and briefly. You are not a doctor and never diagnose, interpret results, or recommend treatment — you gather information and note concerns for the care team.

STYLE: warm, calm, unhurried — 1–2 short sentences, natural contractions, ONE question at a time, then wait.

EMPATHY: react to what they share like a caring human — a brief, GENUINE acknowledgement that fits their answer (e.g. "that sounds really tough", "I'm so glad to hear that", "thank you for telling me"). Vary it every time; never reuse the same phrase, and never repeat or read their answer back to them.

EMERGENCY OVERRIDE (beats everything): if {{givenName}} shows any red flag of a severe asthma attack — can't speak in full sentences / only a few words at a time, breathless at rest, rescue inhaler not helping or needed every 1–2 hours, chest pain, blue lips or fingertips, drowsiness/confusion/exhaustion, or a home peak flow below half their best — say ONCE "This sounds like it could be an emergency. Please hang up and call 911 right now." Then end the call. Do not continue the questions.

Never mention tools, systems, scores, or that this is automated.`;

export const ASTHMA: ConditionModule = {
  id: 'asthma',
  label: 'Asthma (Asthma Control Test)',
  conditionCodes: { icd10: CONDITION.icd10, snomed: CONDITION.snomed },

  instrument: {
    name: 'Asthma Control Test',
    panelLoinc: ACT_LOINC.panel,
    totalLoinc: ACT_LOINC.total,
    direction: 'higherIsBetter',
    items: ACT_ITEMS.map((it) => ({
      linkId: it.linkId,
      loinc: it.loinc,
      prompt: it.prompt,
      scale: it.scale,
      min: 1,
      max: 5,
    })),
    bands: [
      { id: 'well', label: 'well controlled', min: 20, max: 25 },
      { id: 'partial', label: 'not well controlled', min: 16, max: 19 },
      { id: 'poor', label: 'very poorly controlled', min: 5, max: 15 },
    ],
  },

  protocol: {
    well: { bandId: 'well', ...withRegimen(ASTHMA_PROTOCOL.well, ASTHMA_MEDS.well) },
    partial: { bandId: 'partial', ...withRegimen(ASTHMA_PROTOCOL.partial, ASTHMA_MEDS.partial) },
    poor: { bandId: 'poor', ...withRegimen(ASTHMA_PROTOCOL.poor, ASTHMA_MEDS.poor) },
  },

  // GINA "future-risk" factors the ACT control score misses (see src/clinical/risk.ts).
  riskQuestions: [
    {
      id: 'exacerbations',
      prompt: 'In the past year, did you have any flare-ups that needed steroid pills like prednisone, an ER visit, or a hospital stay for your asthma?',
      encoding:
        'integer = number of separate oral-steroid (prednisone) courses in the last 12 months (0, 1, 2, or 3 for three or more). If they mention an ER visit, hospital stay, or ICU/breathing machine, still set the count and include the word "ER", "hospital", or "ICU" in the note.',
    },
    {
      id: 'reliever',
      prompt: 'Roughly how long does one quick-relief (rescue) inhaler canister usually last you these days?',
      encoding:
        '0 = several months or longer; 1 = about a month; 2 = less than a month (goes through more than one canister a month).',
    },
  ],

  moss: {
    indexName: 'careloop-asthma-kb',
    corpus: [
      { id: 'asthma-inhaler', source: 'Inhaler Technique (GINA-aligned)', text: 'Proper inhaler technique: shake, breathe out fully, seal your lips around the mouthpiece or spacer, press once as you begin a slow deep breath in, then hold ~10 seconds. A spacer helps more medicine reach your lungs. Rinse your mouth after a steroid controller inhaler.' },
      { id: 'asthma-act', source: 'Understanding Your ACT Score', text: 'The Asthma Control Test is 5 questions about the last 4 weeks. 20–25 means well controlled, 16–19 partly controlled, 5–15 poor control your care team may want to act on. It is a conversation starter, not a diagnosis.' },
      { id: 'asthma-reliever', source: 'Rescue vs Controller Inhalers', text: 'A reliever (rescue) inhaler works fast during symptoms. A controller has a low-dose steroid you take regularly to prevent symptoms; it does not give quick relief. Some combination inhalers do both — follow your clinician plan.' },
      { id: 'asthma-triggers', source: 'Allergen & Trigger Avoidance', text: 'Reduce exposure to triggers: keep pets out of the bedroom, wash hands after contact, use a HEPA filter; for dust mites use allergen-proof covers and wash bedding hot weekly. Track which triggers set off symptoms.' },
      { id: 'asthma-night', source: 'Nighttime Asthma Symptoms', text: 'Waking at night from coughing or chest tightness suggests asthma is not fully controlled. Note how many nights per week; keep your reliever nearby and tell your clinician if it is frequent.' },
      { id: 'asthma-reliever-overuse', source: 'When You Use Your Rescue Inhaler A Lot', text: 'Needing your quick-relief (rescue) inhaler most days, or going through a whole canister in about a month, is a sign your asthma needs closer attention — it is linked to a higher risk of serious flare-ups. It usually means the preventer side needs adjusting; your care team can help. Keep using your rescue inhaler when you need it, and let them know how often that is.' },
      { id: 'asthma-adherence', source: 'Taking Your Controller Every Day', text: 'The controller (preventer) inhaler has a low dose of medicine that calms airway inflammation over time — it only works if taken regularly, even on good days, and it will not give quick relief. If cost, side-effects, or simply remembering get in the way, tell your care team; there are often simpler routines, spacers, or alternatives that help.' },
      { id: 'asthma-action-plan', source: 'Your Asthma Action Plan (Green/Yellow/Red)', text: 'An asthma action plan is a simple written guide: GREEN means you feel good — keep taking your controller; YELLOW means symptoms are starting — follow the extra steps your clinician wrote; RED means severe symptoms — use your rescue inhaler and get urgent help. Ask your care team for one if you do not have it, or to review yours.' },
      { id: 'asthma-warning-signs', source: 'Warning Signs to Get Help', text: 'Get urgent help if you cannot speak in full sentences, your rescue inhaler is not helping or you need it every couple of hours, your lips or fingertips look blue, or you feel very drowsy or exhausted. These are signs of a severe attack — call emergency services, do not wait for your appointment.' },
      { id: 'asthma-vaccines', source: 'Vaccines and Asthma', text: 'Because asthma affects your lungs, staying up to date on the flu shot, the pneumonia (pneumococcal) vaccine, and COVID vaccine helps prevent infections that can trigger bad flare-ups. Your care team can tell you which ones you are due for.' },
      { id: 'asthma-smoking', source: 'Smoke, Vaping and Your Airways', text: 'Smoking or vaping — and secondhand smoke — irritate already-sensitive airways, worsen control, and make medicines work less well. Cutting down or quitting is one of the most powerful things for your asthma; ask your care team about support to quit.' },
      { id: 'asthma-exercise', source: 'Exercise and Asthma', text: 'Exercise is good for asthma and most people can stay active. If activity brings on symptoms, warming up, using your reliever beforehand if your clinician advises, and keeping your controller on track usually helps. Tell your team if exercise reliably sets you off — it can mean control needs tuning.' },
    ],
  },

  agent: { globalPrompt: GLOBAL_PROMPT },

  researchTopicTemplate:
    'Asthma phenotype and step management for {{conditionDisplay}} — triggers: {{triggers}}; control: {{bandLabel}} (ACT {{total}}/25)',

  currentMedication: { rxcui: MED.budesonideLow.rxcui, display: MED.budesonideLow.display },

  expertPanel: [
    { key: 'pulmonology', label: 'Pulmonology', systemPrompt: expertPrompt('a pulmonology reviewer', 'Assess guideline appropriateness of the controller step-up/step-down vs the ACT band per GINA 2025, the follow-up interval, oral-steroid decision, and referral.') },
    { key: 'clinical-pharmacist', label: 'Clinical pharmacist', systemPrompt: expertPrompt('a clinical pharmacist reviewer', 'Assess drug choice, dose, interactions, and contraindications for the RxNorm medication given current meds and allergies; comment on inhaler technique/spacer and any oral-corticosteroid course.') },
    { key: 'patient-safety', label: 'Patient safety', systemPrompt: expertPrompt('a patient-safety/guideline reviewer', 'Look for red flags, over/under-treatment, and missing escalation; check for a written asthma action plan and documented worsening/emergency criteria.') },
  ],
};

// ── helpers ─────────────────────────────────────────────────────────────────
/**
 * Strip the legacy `band` field off the source ProtocolStep and attach the
 * structured `medications` regimen, forcing the legacy medRxcui/medDisplay to
 * the primary (first) med for back-compat.
 */
function withRegimen(
  s: (typeof ASTHMA_PROTOCOL)[keyof typeof ASTHMA_PROTOCOL],
  medications: MedOrder[],
) {
  const { band: _band, ...rest } = s;
  const primary = medications[0];
  return {
    ...rest,
    medications,
    medRxcui: primary?.rxcui ?? rest.medRxcui,
    medDisplay: primary?.display ?? rest.medDisplay,
  };
}

export function expertPrompt(role: string, focus: string): string {
  return [
    `You are ${role} on a pre-visit peer-review panel. ${focus}`,
    '',
    'This is DECISION SUPPORT for a human clinician, NOT sign-off. You do not approve, prescribe, or dispense.',
    'Respond with a SINGLE JSON object and nothing else:',
    '{"verdict": "agree" | "concern" | "suggest-edit", "rationale": string, "suggestedEdit"?: string}',
  ].join('\n');
}
