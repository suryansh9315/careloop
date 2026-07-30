/**
 * Reset the demo patient (SEED_PATIENT_ID) to a clean, richly-populated state.
 *
 * The all-in-one seed transaction can leave the demo patient's satellite records
 * (allergies, coverage, prior scores) unreliable once a project has been used for
 * many simulations, and every simulate run appends draft plans + undated score
 * Observations. This script deterministically:
 *   1. deletes pollution (draft plans/meds/tasks + all ACT-total Observations),
 *   2. patches the Patient (sex, address),
 *   3. re-creates a clean clinical history via DIRECT Patient/<id> references:
 *      two allergies (env + drug), a controller + reliever, 5 dated prior ACT
 *      scores telling a decline story, and Coverage for Stedi.
 *
 * Run: npm run reset   (safe to re-run — it cleans first)
 */
import { config } from '../src/config.js';
import { getMedplum } from '../src/medplum/client.js';
import { ACT_LOINC, SYSTEM, MED } from '../src/clinical/codes.js';
import { SEED_COVERAGE, coverageExtensions } from '../src/medplum/seed.js';
import type {
  AllergyIntolerance,
  Coverage,
  MedicationRequest,
  Observation,
} from '@medplum/fhirtypes';

const pid = config.seed.patientId;
if (!pid) throw new Error('SEED_PATIENT_ID is not set — run `npm run seed` first.');
const ref = `Patient/${pid}`;

function dateAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const medplum = await getMedplum();

  // ── 1. Patch the Patient demographics ─────────────────────────────────────
  const patient = await medplum.readResource('Patient', pid);
  await medplum.updateResource({
    ...patient,
    gender: 'female',
    address: [{ city: 'Oakland', state: 'CA', country: 'US' }],
  });
  console.log('✓ patched Patient (sex, address)');

  // ── 2. Delete pollution ───────────────────────────────────────────────────
  const [obs, meds, plans, allergies, coverages] = await Promise.all([
    medplum.searchResources('Observation', { subject: ref, code: `${SYSTEM.LOINC}|${ACT_LOINC.total}`, _count: '200' }),
    medplum.searchResources('MedicationRequest', { subject: ref, _count: '200' }),
    medplum.searchResources('CarePlan', { subject: ref, _count: '200' }),
    medplum.searchResources('AllergyIntolerance', { patient: ref, _count: '50' }),
    medplum.searchResources('Coverage', { beneficiary: ref, _count: '50' }),
  ]);
  // Task's patient search param isn't universal; fetch by `for` best-effort.
  const tasks = await medplum.searchResources('Task', { _count: '200' }).then(
    (all) => all.filter((t) => t.for?.reference === ref),
    () => [],
  );

  const del = async (type: string, id?: string) => {
    if (id) await medplum.deleteResource(type as 'Observation', id).catch(() => {});
  };

  // All ACT-total Observations (we recreate the clean priors below).
  await Promise.all(obs.map((o) => del('Observation', o.id)));
  // Draft meds/plans (simulation leftovers); keep nothing — meds recreated below.
  await Promise.all(meds.map((m) => del('MedicationRequest', m.id)));
  await Promise.all(plans.filter((p) => p.status !== 'active').map((p) => del('CarePlan', p.id)));
  await Promise.all(tasks.map((t) => del('Task', t.id)));
  await Promise.all(allergies.map((a) => del('AllergyIntolerance', a.id)));
  console.log(`✓ cleaned ${obs.length} obs · ${meds.length} meds · ${plans.length} plans · ${tasks.length} tasks · ${allergies.length} allergies`);

  // ── 3. Recreate a clean clinical history (direct references) ───────────────
  const allergyCat: AllergyIntolerance = {
    resourceType: 'AllergyIntolerance',
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
    type: 'allergy',
    category: ['environment'],
    code: { coding: [{ system: SYSTEM.SNOMED, code: '39579001', display: 'Cat dander' }], text: 'Cat dander' },
    patient: { reference: ref },
  };
  const allergyPcn: AllergyIntolerance = {
    resourceType: 'AllergyIntolerance',
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
    type: 'allergy',
    category: ['medication'],
    criticality: 'high',
    code: { coding: [{ system: SYSTEM.SNOMED, code: '373270004', display: 'Penicillin' }], text: 'Penicillin' },
    reaction: [{ manifestation: [{ text: 'Hives' }] }],
    patient: { reference: ref },
  };

  const controller: MedicationRequest = {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: { coding: [{ system: SYSTEM.RXNORM, code: MED.budesonideLow.rxcui, display: MED.budesonideLow.display }], text: MED.budesonideLow.display },
    subject: { reference: ref },
    authoredOn: dateAgo(300),
  };
  const reliever: MedicationRequest = {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: { coding: [{ system: SYSTEM.RXNORM, code: '745679', display: 'Albuterol 90 mcg/actuation inhaler (rescue)' }], text: 'Albuterol 90 mcg/actuation inhaler (rescue)' },
    subject: { reference: ref },
    authoredOn: dateAgo(300),
  };

  // A believable 14-month decline into poor control.
  const priorScores: [number, number][] = [
    [24, 450],
    [22, 300],
    [21, 180],
    [19, 90],
    [17, 30],
  ];
  const priorObs = (total: number, days: number): Observation => ({
    resourceType: 'Observation',
    status: 'final',
    code: { coding: [{ system: SYSTEM.LOINC, code: ACT_LOINC.total, display: 'Total score [ACT]' }], text: 'Total score [ACT]' },
    subject: { reference: ref },
    effectiveDateTime: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    valueInteger: total,
  });

  const coverage: Coverage = {
    resourceType: 'Coverage',
    status: 'active',
    beneficiary: { reference: ref },
    subscriber: { reference: ref },
    subscriberId: SEED_COVERAGE.memberId,
    relationship: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship', code: 'self', display: 'Self' }] },
    payor: [{ display: SEED_COVERAGE.payerName }],
    extension: coverageExtensions(SEED_COVERAGE),
  };

  await Promise.all([
    medplum.createResource(allergyCat),
    medplum.createResource(allergyPcn),
    medplum.createResource(controller),
    medplum.createResource(reliever),
    ...priorScores.map(([t, d]) => medplum.createResource(priorObs(t, d))),
    coverages.length ? Promise.resolve(coverages[0]) : medplum.createResource(coverage),
  ]);
  console.log(`✓ created 2 allergies · 2 meds · ${priorScores.length} prior ACT scores · coverage${coverages.length ? ' (kept existing)' : ''}`);
  console.log('\nDone. Reload the patient context to verify.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
