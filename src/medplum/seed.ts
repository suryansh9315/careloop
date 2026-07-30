import type {
  AllergyIntolerance,
  Appointment,
  Bundle,
  BundleEntry,
  CarePlan,
  Condition,
  Coverage,
  MedicationRequest,
  Observation,
  Patient,
  Questionnaire,
} from '@medplum/fhirtypes';
import { ACT_ITEMS } from '../clinical/act.js';
import { ACT_LOINC, CONDITION, MED, SYSTEM } from '../clinical/codes.js';
import { getCondition, DEFAULT_CONDITION_ID } from '../conditions/registry.js';
import { log } from '../logger.js';
import type { CoverageInfo, PatientContext } from '../types.js';
import { getMedplum } from './client.js';

/**
 * Map an anchor Condition's ICD-10 code to a registered ConditionModule id by
 * comparing against each known module's `conditionCodes.icd10.code`. Falls back
 * to the default condition (asthma) when nothing matches.
 */
function moduleIdForConditionCode(icd10?: string): string {
  if (icd10) {
    for (const id of ['asthma', 'depression']) {
      if (getCondition(id)?.conditionCodes.icd10.code === icd10) return id;
    }
  }
  return DEFAULT_CONDITION_ID;
}

/** Stedi UHC synthetic test member seeded for Maria so the live 271 succeeds. */
export const SEED_COVERAGE: CoverageInfo = {
  payerId: '87726',
  payerName: 'UnitedHealthcare',
  memberId: 'UHC123456',
  subscriberFirstName: 'Jane',
  subscriberLastName: 'Doe',
  subscriberDob: '19710101',
} as const;

/**
 * We stash the Stedi CoverageInfo fields that don't have a natural FHIR home on
 * the Coverage as extensions (payerId + subscriber name/dob), so
 * loadPatientContext can reconstruct the exact `CoverageInfo` the 270 needs.
 */
const COVERAGE_EXT = {
  payerId: 'https://careloop.demo/coverage/payerId',
  subFirstName: 'https://careloop.demo/coverage/subscriberFirstName',
  subLastName: 'https://careloop.demo/coverage/subscriberLastName',
  subDob: 'https://careloop.demo/coverage/subscriberDob',
} as const;

/** Build the extension array that carries the Stedi CoverageInfo on a Coverage. */
export function coverageExtensions(c: CoverageInfo): { url: string; valueString: string }[] {
  return [
    { url: COVERAGE_EXT.payerId, valueString: c.payerId },
    { url: COVERAGE_EXT.subFirstName, valueString: c.subscriberFirstName },
    { url: COVERAGE_EXT.subLastName, valueString: c.subscriberLastName },
    { url: COVERAGE_EXT.subDob, valueString: c.subscriberDob },
  ];
}

/** Read a Coverage FHIR resource back into the Stedi CoverageInfo (or undefined). */
function coverageInfoFrom(cov: Coverage | undefined): CoverageInfo | undefined {
  if (!cov) return undefined;
  const ext = (url: string): string | undefined =>
    cov.extension?.find((e) => e.url === url)?.valueString;
  const payerId = ext(COVERAGE_EXT.payerId);
  const memberId = cov.subscriberId;
  if (!payerId || !memberId) return undefined;
  return {
    payerId,
    payerName: cov.payor?.[0]?.display,
    memberId,
    subscriberFirstName: ext(COVERAGE_EXT.subFirstName) ?? '',
    subscriberLastName: ext(COVERAGE_EXT.subLastName) ?? '',
    subscriberDob: ext(COVERAGE_EXT.subDob) ?? '',
  };
}

/**
 * Demo data for "Maria Reyes" — the seeded asthma patient. `seedDemoData` writes
 * everything in a single transaction Bundle (urn:uuid cross-references), and
 * `loadPatientContext` reads it back into the PatientContext the agent is primed
 * with at call start.
 */

const SEED = {
  givenName: 'Maria',
  familyName: 'Reyes',
  dob: '1979-05-14',
  phone: '+15555550123',
  /** hardcoded fallback triggers (also seeded as an AllergyIntolerance) */
  triggers: ['cat dander', 'nighttime symptoms'],
} as const;

/** ISO timestamp `days` in the past (negative = future). */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Date-only (YYYY-MM-DD) `days` in the past. */
function dateAgo(days: number): string {
  return daysAgo(days).slice(0, 10);
}

/**
 * Seed the demo project in one transaction Bundle. Returns the created ids read
 * from the batch response entries (matched to request order).
 */
export async function seedDemoData(): Promise<{
  patientId: string;
  conditionId: string;
  appointmentId: string;
  questionnaireId: string;
  carePlanId: string;
}> {
  const medplum = await getMedplum();

  const patientUrn = 'urn:uuid:00000000-0000-0000-0000-0000000000p1';
  const conditionUrn = 'urn:uuid:00000000-0000-0000-0000-0000000000c1';
  const carePlanUrn = 'urn:uuid:00000000-0000-0000-0000-00000000cp01';

  const patient: Patient = {
    resourceType: 'Patient',
    name: [{ given: [SEED.givenName], family: SEED.familyName }],
    birthDate: SEED.dob,
    gender: 'female',
    telecom: [{ system: 'phone', value: SEED.phone, use: 'mobile' }],
    address: [{ city: 'Oakland', state: 'CA', country: 'US' }],
  };

  const condition: Condition = {
    resourceType: 'Condition',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        { system: CONDITION.icd10.system, code: CONDITION.icd10.code, display: CONDITION.icd10.display },
        { system: CONDITION.snomed.system, code: CONDITION.snomed.code, display: CONDITION.snomed.display },
      ],
      text: CONDITION.icd10.display,
    },
    subject: { reference: patientUrn },
  };

  const allergy: AllergyIntolerance = {
    resourceType: 'AllergyIntolerance',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
    },
    type: 'allergy',
    category: ['environment'],
    code: {
      coding: [{ system: SYSTEM.SNOMED, code: '39579001', display: 'Cat dander' }],
      text: 'Cat dander',
    },
    patient: { reference: patientUrn },
  };

  // A documented drug allergy (distinct from environmental triggers) so the
  // clinical snapshot shows a real allergy list and the safety engine has a
  // medication allergy to reason about.
  const drugAllergy: AllergyIntolerance = {
    resourceType: 'AllergyIntolerance',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
    },
    type: 'allergy',
    category: ['medication'],
    criticality: 'high',
    code: {
      coding: [{ system: SYSTEM.SNOMED, code: '373270004', display: 'Penicillin' }],
      text: 'Penicillin',
    },
    reaction: [{ manifestation: [{ text: 'Hives' }] }],
    patient: { reference: patientUrn },
  };

  const medication: MedicationRequest = {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: {
      coding: [{ system: SYSTEM.RXNORM, code: MED.budesonideLow.rxcui, display: MED.budesonideLow.display }],
      text: MED.budesonideLow.display,
    },
    subject: { reference: patientUrn },
    authoredOn: dateAgo(120),
  };

  // A rescue reliever in her current regimen, so "current medications" reads as a
  // real two-drug list (controller + reliever).
  const reliever: MedicationRequest = {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: {
      coding: [{ system: SYSTEM.RXNORM, code: '745679', display: 'Albuterol 90 mcg/actuation inhaler (rescue)' }],
      text: 'Albuterol 90 mcg/actuation inhaler (rescue)',
    },
    subject: { reference: patientUrn },
    authoredOn: dateAgo(300),
  };

  const carePlan: CarePlan = {
    resourceType: 'CarePlan',
    status: 'active',
    intent: 'plan',
    category: [{ text: 'asthma' }],
    subject: { reference: patientUrn },
    addresses: [{ reference: conditionUrn }],
    period: { start: dateAgo(120) },
    title: 'Asthma control plan',
  };

  const appointment: Appointment = {
    resourceType: 'Appointment',
    status: 'booked',
    description: 'Pulmonology follow-up',
    start: daysAgo(-2),
    end: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
    participant: [{ actor: { reference: patientUrn }, status: 'accepted' }],
  };

  const priorAct = (total: number, days: number): Observation => ({
    resourceType: 'Observation',
    status: 'final',
    code: {
      coding: [{ system: SYSTEM.LOINC, code: ACT_LOINC.total, display: 'Total score [ACT]' }],
      text: 'Total score [ACT]',
    },
    subject: { reference: patientUrn },
    effectiveDateTime: daysAgo(days),
    valueInteger: total,
  });

  const questionnaire: Questionnaire = {
    resourceType: 'Questionnaire',
    status: 'active',
    name: 'AsthmaControlTest',
    title: 'Asthma Control Test',
    code: [{ system: SYSTEM.LOINC, code: ACT_LOINC.panel, display: 'Asthma Control Test panel' }],
    item: ACT_ITEMS.map((it) => ({
      linkId: it.linkId,
      text: it.prompt,
      type: 'integer' as const,
      code: [
        {
          system: SYSTEM.LOINC,
          code: ACT_LOINC.items[it.linkId as keyof typeof ACT_LOINC.items].code,
          display: ACT_LOINC.items[it.linkId as keyof typeof ACT_LOINC.items].text,
        },
      ],
    })),
  };

  // Insurance for the live Stedi eligibility check. Uses a UHC synthetic test
  // member so a real 271 comes back in Stedi TEST mode. loadPatientContext reads
  // this back into PatientContext.coverage (payerId '87726', member 'UHC123456').
  const coverage: Coverage = {
    resourceType: 'Coverage',
    status: 'active',
    beneficiary: { reference: patientUrn },
    subscriber: { reference: patientUrn },
    subscriberId: SEED_COVERAGE.memberId,
    relationship: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship',
          code: 'self',
          display: 'Self',
        },
      ],
    },
    payor: [{ display: SEED_COVERAGE.payerName }],
    extension: coverageExtensions(SEED_COVERAGE),
  };

  // Order matters: we read ids back from the response entries by index.
  const resources: { fullUrl?: string; slug: string; resource: BundleEntry['resource'] }[] = [
    { fullUrl: patientUrn, slug: 'maria-reyes', resource: patient }, // 0
    { fullUrl: conditionUrn, slug: 'asthma-j4540', resource: condition }, // 1
    { slug: 'cat-dander', resource: allergy }, // 2
    { slug: 'ics-low', resource: medication }, // 3
    { fullUrl: carePlanUrn, slug: 'asthma-plan', resource: carePlan }, // 4
    { slug: 'pulm-followup', resource: appointment }, // 5
    { slug: 'act-prior-1', resource: priorAct(19, 90) }, // 6
    { slug: 'act-prior-2', resource: priorAct(17, 30) }, // 7
    { slug: 'act-questionnaire', resource: questionnaire }, // 8
    { slug: 'maria-coverage', resource: coverage }, // 9
    // Appended (indices ≥10 don't shift the id reads above): richer history.
    { slug: 'pcn-allergy', resource: drugAllergy }, // 10
    { slug: 'saba-reliever', resource: reliever }, // 11
    { slug: 'act-prior-3', resource: priorAct(24, 450) }, // 12
    { slug: 'act-prior-4', resource: priorAct(22, 300) }, // 13
    { slug: 'act-prior-5', resource: priorAct(21, 180) }, // 14
  ];

  // Conditional create (ifNoneExist) on a stable demo identifier makes re-running
  // the seed idempotent — no duplicate patients/resources on repeat runs.
  const DEMO_SYS = 'https://careloop.demo/identifier';
  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: resources.map(({ fullUrl, slug, resource }): BundleEntry => {
      const r = resource!;
      (r as { identifier?: { system: string; value: string }[] }).identifier = [
        { system: DEMO_SYS, value: slug },
      ];
      return {
        ...(fullUrl ? { fullUrl } : {}),
        resource: r,
        request: {
          method: 'POST',
          url: r.resourceType,
          ifNoneExist: `identifier=${DEMO_SYS}|${slug}`,
        },
      };
    }),
  };

  const response = await medplum.executeBatch(bundle);
  const entries = response.entry ?? [];

  const idAt = (i: number, label: string): string => {
    const id = entries[i]?.resource?.id;
    if (!id) throw new Error(`Seed: missing id for ${label} (entry ${i})`);
    return id;
  };

  const result = {
    patientId: idAt(0, 'Patient'),
    conditionId: idAt(1, 'Condition'),
    carePlanId: idAt(4, 'CarePlan'),
    appointmentId: idAt(5, 'Appointment'),
    questionnaireId: idAt(8, 'Questionnaire'),
  };

  // Publish the code-defined treatments as editable PlanDefinition resources.
  const { seedConditionResources } = await import('../conditions/registry.js');
  await seedConditionResources(medplum);

  log.info('seed.done', result);
  return result;
}

/**
 * Read the seeded (or any) patient back into a PatientContext for the agent:
 * Patient demographics + anchor Condition + current meds + next Appointment +
 * prior ACT totals (oldest→newest) + allergies/triggers.
 */
export async function loadPatientContext(patientId: string): Promise<PatientContext> {
  const medplum = await getMedplum();

  const patient = await medplum.readResource('Patient', patientId);
  const patientRef = `Patient/${patientId}`;

  const [conditions, medications, appointments, actObs, allergies, coverages] = await Promise.all([
    medplum.searchResources('Condition', { subject: patientRef, 'clinical-status': 'active' }),
    medplum.searchResources('MedicationRequest', { subject: patientRef, status: 'active' }),
    medplum.searchResources('Appointment', { actor: patientRef, status: 'booked' }),
    medplum.searchResources('Observation', {
      subject: patientRef,
      code: `${SYSTEM.LOINC}|${ACT_LOINC.total}`,
      _sort: 'date',
    }),
    medplum.searchResources('AllergyIntolerance', { patient: patientRef }),
    medplum.searchResources('Coverage', { beneficiary: patientRef, status: 'active' }),
  ]);

  const name = patient.name?.[0];
  const givenName = name?.given?.[0] ?? SEED.givenName;
  const familyName = name?.family ?? SEED.familyName;
  const dob = patient.birthDate ?? SEED.dob;

  const condition = conditions.find((c) =>
    c.code?.coding?.some((cd) => cd.system === CONDITION.icd10.system),
  );
  const conditionCoding = condition?.code?.coding?.find((cd) => cd.system === CONDITION.icd10.system);
  const conditionCode = conditionCoding?.code ?? CONDITION.icd10.code;
  const conditionDisplay =
    conditionCoding?.display ?? condition?.code?.text ?? CONDITION.icd10.display;

  const currentMedications = medications
    .map((m) => m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display)
    .filter((v): v is string => Boolean(v));

  const appointment = appointments
    .slice()
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
    .find((a) => (a.start ?? '') >= new Date().toISOString()) ?? appointments[0];

  const allergyLabels = allergies
    .map((a) => a.code?.text ?? a.code?.coding?.[0]?.display)
    .filter((v): v is string => Boolean(v));

  // Environmental/food allergens double as asthma triggers; drug allergies do not.
  const environmentalAllergens = allergies
    .filter((a) => (a.category ?? []).some((c) => c === 'environment' || c === 'food'))
    .map((a) => a.code?.text ?? a.code?.coding?.[0]?.display)
    .filter((v): v is string => Boolean(v));

  const priorActScores = actObs
    .filter((o) => typeof o.valueInteger === 'number')
    .map((o) => ({
      date: (o.effectiveDateTime ?? o.issued ?? '').slice(0, 10),
      total: o.valueInteger as number,
    }))
    // Only dated scores count as history — undated finals (e.g. written mid-pipeline)
    // are not prior check-ins and must not pollute the trend.
    .filter((s) => Boolean(s.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const triggers = environmentalAllergens.length
    ? Array.from(new Set([...environmentalAllergens.map((a) => a.toLowerCase()), 'nighttime symptoms']))
    : [...SEED.triggers];

  const conditionModuleId = moduleIdForConditionCode(conditionCode);
  const coverage = coverageInfoFrom(coverages[0]);

  return {
    patientId,
    conditionId: condition?.id ?? '',
    conditionModuleId,
    ...(appointment?.id ? { appointmentId: appointment.id } : {}),
    givenName,
    familyName,
    dob,
    ...(patient.gender ? { sex: patient.gender } : {}),
    ...(patient.address?.[0]?.city ? { city: patient.address[0].city } : {}),
    ...(patient.address?.[0]?.state ? { state: patient.address[0].state } : {}),
    conditionCode,
    conditionDisplay,
    currentMedications: currentMedications.length ? currentMedications : [MED.budesonideLow.display],
    allergies: allergyLabels.length ? allergyLabels : ['cat dander'],
    triggers,
    priorActScores,
    ...(coverage ? { coverage } : {}),
  };
}
