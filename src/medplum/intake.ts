import type {
  Bundle,
  BundleEntry,
  Condition,
  Coverage,
  Patient,
  Questionnaire,
} from '@medplum/fhirtypes';
import { requireCondition } from '../conditions/registry.js';
import { SYSTEM } from '../clinical/codes.js';
import { log } from '../logger.js';
import type { CoverageInfo } from '../types.js';
import { getMedplum } from './client.js';

/**
 * Custom-patient intake — create a brand-new patient for a chosen treatment
 * (condition module), optionally with insurance for the Stedi eligibility check.
 *
 * Writes a single transaction Bundle:
 *   Patient (always new) → Condition (module ICD-10 + SNOMED, keyed to the
 *   patient so re-runs don't duplicate) → Coverage (when provided) → the module's
 *   Questionnaire (conditional-create by module identifier, shared across patients).
 */

const INTAKE_SYS = 'https://careloop.demo/intake';

/**
 * Create a custom patient for the given treatment. Returns the created ids plus
 * the resolved condition module id.
 */
export async function createIntakePatient(input: {
  givenName: string;
  familyName: string;
  /** YYYY-MM-DD */
  dob: string;
  phone?: string;
  conditionId: string;
  coverage?: CoverageInfo;
}): Promise<{ patientId: string; conditionId: string; moduleId: string }> {
  const medplum = await getMedplum();
  const module = requireCondition(input.conditionId);

  const patientUrn = 'urn:uuid:00000000-0000-0000-0000-00000000pat1';
  // Stable-ish slug for the patient's Condition so re-running intake for the same
  // person + treatment doesn't create duplicate Conditions.
  const conditionSlug = `${input.givenName}-${input.familyName}-${input.dob}-${module.id}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

  const patient: Patient = {
    resourceType: 'Patient',
    name: [{ given: [input.givenName], family: input.familyName }],
    birthDate: input.dob,
    ...(input.phone ? { telecom: [{ system: 'phone', value: input.phone, use: 'mobile' }] } : {}),
  };

  const icd10 = module.conditionCodes.icd10;
  const snomed = module.conditionCodes.snomed;
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
        { system: icd10.system, code: icd10.code, display: icd10.display },
        ...(snomed ? [{ system: snomed.system, code: snomed.code, display: snomed.display }] : []),
      ],
      text: icd10.display,
    },
    subject: { reference: patientUrn },
    identifier: [{ system: INTAKE_SYS, value: conditionSlug }],
  };

  // The module's intake Questionnaire — shared across patients, conditional-create
  // keyed on the module id so we only ever have one per treatment.
  const questionnaire: Questionnaire = {
    resourceType: 'Questionnaire',
    status: 'active',
    name: module.instrument.name.replace(/[^A-Za-z0-9]/g, ''),
    title: module.instrument.name,
    code: [
      { system: SYSTEM.LOINC, code: module.instrument.panelLoinc, display: `${module.instrument.name} panel` },
    ],
    identifier: [{ system: INTAKE_SYS, value: `questionnaire-${module.id}` }],
    item: module.instrument.items.map((it) => ({
      linkId: it.linkId,
      text: it.prompt,
      type: 'integer' as const,
      code: [{ system: SYSTEM.LOINC, code: it.loinc, display: it.prompt }],
    })),
  };

  const entries: BundleEntry[] = [
    {
      fullUrl: patientUrn,
      resource: patient,
      // Patients are created fresh each intake — no ifNoneExist.
      request: { method: 'POST', url: 'Patient' },
    },
    {
      resource: condition,
      request: {
        method: 'POST',
        url: 'Condition',
        ifNoneExist: `identifier=${INTAKE_SYS}|${conditionSlug}`,
      },
    },
    {
      resource: questionnaire,
      request: {
        method: 'POST',
        url: 'Questionnaire',
        ifNoneExist: `identifier=${INTAKE_SYS}|questionnaire-${module.id}`,
      },
    },
  ];

  if (input.coverage) {
    const c = input.coverage;
    const coverage: Coverage = {
      resourceType: 'Coverage',
      status: 'active',
      beneficiary: { reference: patientUrn },
      subscriber: { reference: patientUrn },
      subscriberId: c.memberId,
      relationship: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship',
            code: 'self',
            display: 'Self',
          },
        ],
      },
      payor: [{ display: c.payerName || c.payerId }],
    };
    entries.push({ resource: coverage, request: { method: 'POST', url: 'Coverage' } });
  }

  const bundle: Bundle = { resourceType: 'Bundle', type: 'transaction', entry: entries };
  const response = await medplum.executeBatch(bundle);
  const responseEntries = response.entry ?? [];

  const patientId = responseEntries[0]?.resource?.id;
  const conditionId = responseEntries[1]?.resource?.id;
  if (!patientId) throw new Error('Intake: missing Patient id in transaction response');
  if (!conditionId) throw new Error('Intake: missing Condition id in transaction response');

  const result = { patientId, conditionId, moduleId: module.id };
  log.info('intake.created', result);
  return result;
}
