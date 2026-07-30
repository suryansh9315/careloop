/**
 * Post-call orchestration handler (the "Bot"). A Medplum Subscription on
 * QuestionnaireResponse fires `handler`, which resolves the ConditionModule for
 * the QR, scores the instrument, runs the deterministic protocol step, decides
 * revise-vs-new CarePlan, optionally enriches with research / peer-review /
 * coverage (injected, so it's testable and the workers stay optional), and
 * persists coded FHIR via the pure builders in careplan.js.
 *
 * This file is CONDITION-AGNOSTIC — everything condition-specific comes from the
 * resolved ConditionModule (Condition Registry).
 */

import { type MedplumClient } from '@medplum/core';
import type {
  Condition,
  MedicationRequest,
  Patient,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
} from '@medplum/fhirtypes';
import type {
  ActAnswer,
  ConcernNote,
  CoverageResult,
  DraftPlan,
  MedOrder,
  PatientContext,
  PeerReviewSummary,
  ProtocolStep,
  ResearchFinding,
  RiskFinding,
} from '../types.js';
import type { ConditionModule, ProtocolStepDef } from '../conditions/types.js';
import { scoreInstrument, stepForBand } from '../conditions/types.js';
import { conditionFromQR } from '../conditions/registry.js';
import { checkRegimenSafety } from '../clinical/safety.js';
import { deriveRiskFindings, extractRiskAnswers, riskWarrantsEscalation } from '../clinical/risk.js';
import { log } from '../logger.js';
import {
  buildActObservations,
  buildDraftCarePlan,
  buildEscalationTask,
  buildMedicationRequests,
  buildReviewCommunications,
} from './careplan.js';

/**
 * Optional post-call workers. Injected so the handler is testable and the
 * heavier Anthropic/Stedi modules are not a hard dependency of this file.
 */
export type PostCallDeps = {
  research?: (d: DraftPlan) => Promise<ResearchFinding[]>;
  peerReview?: (d: DraftPlan) => Promise<PeerReviewSummary>;
  coverage?: (rxcui: string, display: string, patientId: string) => Promise<CoverageResult>;
};

/**
 * Map a module's ProtocolStepDef into the src/types ProtocolStep shape,
 * including the structured `medications` regimen. When `medications` is absent
 * on the def, fall back to the legacy single-med fields (empty when there is no
 * primary med). The legacy medRxcui/medDisplay are forced to the primary
 * (first) med for coverage + back-compat.
 */
function toProtocolStep(def: ProtocolStepDef): ProtocolStep {
  const medications: MedOrder[] =
    def.medications ??
    (def.medRxcui ? [{ rxcui: def.medRxcui, display: def.medDisplay }] : []);
  const primary = medications[0];

  return {
    band: def.bandId,
    summary: def.summary,
    medications,
    medRxcui: primary?.rxcui ?? def.medRxcui,
    medDisplay: primary?.display ?? def.medDisplay,
    addOralSteroid: def.addOralSteroid ?? false,
    specialistReferral: def.specialistReferral ?? false,
    followUpWeeks: def.followUpWeeks,
    escalate: def.escalate,
    goal: def.goal,
  };
}

/**
 * A short, warm, plain-language recap for the patient — so the call ends with
 * visible value. Deterministic (no LLM/latency): reflects control, their top
 * concern, and one risk-aware nudge, then what happens next. Kept non-clinical
 * (no doses/scores) since the patient hears/reads this, not the clinician.
 */
function buildPatientSummary(
  patient: PatientContext,
  actResult: { total: number; bandLabel?: string; band: string },
  concerns: ConcernNote[],
  riskFindings: RiskFinding[],
  module: ConditionModule,
): string {
  const name = patient.givenName || 'there';
  const control = actResult.bandLabel ?? actResult.band;
  const parts: string[] = [
    `Thanks for the check-in, ${name}.`,
    `From what you shared, your ${(module.label.split(' (')[0] ?? module.label).toLowerCase()} has been ${control} lately.`,
  ];
  if (concerns[0]) parts.push(`You also mentioned ${concerns[0].text.replace(/\.$/, '')}.`);

  const topRisk = riskFindings.find((f) => f.severity === 'critical') ?? riskFindings.find((f) => f.severity === 'warning');
  if (topRisk) {
    if (/reliever|rescue/i.test(topRisk.label)) parts.push('It looks like you are relying on your rescue inhaler quite a bit — that is worth your care team looking at the preventer side.');
    else if (/exacerbation|hospital/i.test(topRisk.label)) parts.push('Because you have had a flare-up recently, your team will want to look closely at preventing the next one.');
    else if (/adherence/i.test(topRisk.label)) parts.push('Keeping the daily controller going, even on good days, is one of the biggest things that will help.');
  }

  parts.push('Your care team will review everything before your visit and follow up. If your breathing suddenly gets much worse, please seek urgent care right away.');
  return parts.join(' ');
}

/**
 * Pull instrument answers (one per `module.instrument.items[].linkId`,
 * valueInteger) and any concern notes (linkId starting 'concern', valueString)
 * out of a QuestionnaireResponse. Handles repeated concern items and repeated
 * answers within an item.
 */
export function extractAnswers(
  qr: QuestionnaireResponse,
  module: ConditionModule,
): {
  answers: ActAnswer[];
  concerns: ConcernNote[];
} {
  const answers: ActAnswer[] = [];
  const concerns: ConcernNote[] = [];
  const now = new Date().toISOString();

  // Flatten every answer keyed by linkId (walk the whole tree, concerns repeat).
  const byLinkId = new Map<string, QuestionnaireResponseItem>();
  let concernSeq = 0;
  const walk = (items: QuestionnaireResponseItem[] | undefined): void => {
    if (!items) return;
    for (const item of items) {
      const linkId = item.linkId;
      if (linkId) {
        if (linkId.startsWith('concern')) {
          for (const ans of item.answer ?? []) {
            const text = ans.valueString?.trim();
            if (text) {
              concerns.push({ id: `${linkId}-${concernSeq++}`, text, at: now });
            }
          }
        } else if (!byLinkId.has(linkId)) {
          byLinkId.set(linkId, item);
        }
      }
      walk(item.item);
    }
  };
  walk(qr.item);

  // One answer per instrument item, in module order.
  for (const it of module.instrument.items) {
    const item = byLinkId.get(it.linkId);
    const ans = item?.answer?.[0];
    const v = ans?.valueInteger ?? ans?.valueDecimal;
    if (typeof v === 'number') {
      answers.push({ linkId: it.linkId, value: v });
    }
  }

  return { answers, concerns };
}

/**
 * Assemble a fully-populated DraftPlan: score the instrument → pick protocol
 * step → decide revise-vs-new → optionally run research / peer-review / coverage
 * workers. `module` drives all condition-specific behavior.
 */
export async function buildDraftPlan(
  qr: QuestionnaireResponse,
  patient: PatientContext,
  module: ConditionModule,
  findPriorActiveCarePlanId: (patientId: string, conditionId: string) => Promise<string | null>,
  deps: PostCallDeps = {},
): Promise<DraftPlan> {
  const { answers, concerns } = extractAnswers(qr, module);
  const { total, band } = scoreInstrument(module, answers);
  const step = toProtocolStep(stepForBand(module, band.id));

  const actResult = {
    answers,
    total,
    band: band.id,
    bandLabel: band.label,
  };

  const replacesCarePlanId = await findPriorActiveCarePlanId(
    patient.patientId,
    patient.conditionId,
  );

  // Medication safety checks over the drafted regimen (deterministic, no I/O).
  const safetyFlags = checkRegimenSafety({
    medications: step.medications,
    allergies: patient.allergies,
    currentMedications: patient.currentMedications,
  });

  // GINA future-risk findings from the supplemental risk questions (not scored).
  const riskFindings = deriveRiskFindings(module.id, extractRiskAnswers(qr));
  // A critical risk finding expedites care-team review even if the control-band
  // protocol didn't already escalate.
  if (riskWarrantsEscalation(riskFindings)) step.escalate = true;

  const patientSummary = buildPatientSummary(patient, actResult, concerns, riskFindings, module);

  const draft: DraftPlan = {
    patientId: patient.patientId,
    conditionId: patient.conditionId,
    conditionModuleId: module.id,
    actResult,
    step,
    replacesCarePlanId,
    concerns,
    research: [],
    safetyFlags,
    riskFindings,
    patientSummary,
  };

  log.info('bot.draft.assembled', {
    patientId: patient.patientId,
    conditionModuleId: module.id,
    total,
    band: band.id,
    revising: Boolean(replacesCarePlanId),
    concerns: concerns.length,
    medications: step.medications.length,
    safetyFlags: safetyFlags.length,
    criticalFlags: safetyFlags.filter((f) => f.severity === 'critical').length,
    riskFindings: riskFindings.length,
  });

  if (deps.research) {
    try {
      draft.research = await deps.research(draft);
    } catch (err) {
      log.warn('bot.research.failed', { error: String(err) });
    }
  }
  if (deps.peerReview) {
    try {
      draft.peerReview = await deps.peerReview(draft);
    } catch (err) {
      log.warn('bot.peerReview.failed', { error: String(err) });
    }
  }
  if (deps.coverage && step.medRxcui) {
    try {
      draft.coverage = await deps.coverage(step.medRxcui, step.medDisplay, patient.patientId);
    } catch (err) {
      log.warn('bot.coverage.failed', { error: String(err) });
    }
  }

  return draft;
}

/**
 * Write the coded resources: instrument Observations, the RxNorm
 * MedicationRequest (only when the step has a medication), the draft CarePlan
 * (revising the prior active plan when present), an urgent Task (only when the
 * step escalates), and the review Communications. `module` drives the coded
 * builders.
 */
export async function persistDraftPlan(
  medplum: MedplumClient,
  draft: DraftPlan,
  module: ConditionModule,
): Promise<{ carePlanId: string; medicationRequestIds: string[]; taskId?: string }> {
  // Observations (fire in parallel; ids not needed downstream).
  const observations = buildActObservations(draft.patientId, module, draft.actResult);
  await Promise.all(observations.map((o) => medplum.createResource(o)));

  // One MedicationRequest per structured MedOrder (empty for bands with no
  // pharmacotherapy, e.g. depression minimal/mild). The CarePlan references all
  // of them.
  const medRequests = buildMedicationRequests(draft.patientId, draft.step);
  const created = await Promise.all(medRequests.map((m) => medplum.createResource(m)));
  const medicationRequestIds = created.map((m) => m.id as string);
  const medicationRequestRefs = medicationRequestIds.map((id) => `MedicationRequest/${id}`);

  // Draft CarePlan (revise-vs-new).
  const carePlan = await medplum.createResource(
    buildDraftCarePlan({
      patientId: draft.patientId,
      conditionId: draft.conditionId,
      step: draft.step,
      categoryText: module.id,
      conditionLabel: module.label,
      medicationRequestRefs,
      replacesCarePlanId: draft.replacesCarePlanId,
      goalText: draft.step.goal,
    }),
  );
  const carePlanId = carePlan.id as string;

  // Urgent Task only when the protocol step escalates.
  let taskId: string | undefined;
  if (draft.step.escalate) {
    const task = await medplum.createResource(
      buildEscalationTask(draft.patientId, module, draft.actResult),
    );
    taskId = task.id;
  }

  // Review notes attached to the record.
  const comms = buildReviewCommunications(
    draft.patientId,
    draft.research,
    draft.peerReview,
    draft.coverage,
  );
  await Promise.all(comms.map((c) => medplum.createResource(c)));

  // Patient-facing recap (a distinct, patient-directed Communication that a
  // portal / SMS could later surface).
  if (draft.patientSummary) {
    await medplum.createResource({
      resourceType: 'Communication',
      status: 'completed',
      category: [{ coding: [{ system: 'https://careloop.demo', code: 'careloop-patient-summary' }], text: 'Patient summary' }],
      subject: { reference: `Patient/${draft.patientId}` },
      recipient: [{ reference: `Patient/${draft.patientId}` }],
      sent: new Date().toISOString(),
      payload: [{ contentString: draft.patientSummary }],
    });
  }

  log.info('bot.persisted', { carePlanId, medicationRequestIds, taskId });

  return { carePlanId, medicationRequestIds, taskId };
}

/**
 * Load the patient context needed by the Bot straight from Medplum. Kept inline
 * here so this file has no hard dependency on the seed/worker modules.
 */
async function loadPatientContext(
  medplum: MedplumClient,
  patientId: string,
  module: ConditionModule,
): Promise<PatientContext> {
  const patient = (await medplum.readResource('Patient', patientId)) as Patient;

  // Anchor Condition (module ICD-10), falling back to any condition on record.
  const anchorCode = module.conditionCodes.icd10.code;
  const conditions = await medplum.searchResources('Condition', {
    subject: `Patient/${patientId}`,
  });
  const anchor =
    conditions.find((c) => c.code?.coding?.some((cd) => cd.code === anchorCode)) ??
    conditions[0];

  const meds = await medplum.searchResources('MedicationRequest', {
    subject: `Patient/${patientId}`,
    status: 'active',
  });

  const name = patient.name?.[0];
  const conditionCoding = (anchor as Condition | undefined)?.code?.coding?.[0];

  return {
    patientId,
    conditionId: (anchor as Condition | undefined)?.id ?? '',
    conditionModuleId: module.id,
    givenName: name?.given?.join(' ') ?? '',
    familyName: name?.family ?? '',
    dob: patient.birthDate ?? '',
    conditionCode: conditionCoding?.code ?? anchorCode,
    conditionDisplay: conditionCoding?.display ?? module.conditionCodes.icd10.display,
    currentMedications: meds
      .map(
        (m: MedicationRequest) =>
          m.medicationCodeableConcept?.text ??
          m.medicationCodeableConcept?.coding?.[0]?.display ??
          '',
      )
      .filter((s): s is string => Boolean(s)),
    allergies: [],
    triggers: [],
    priorActScores: [],
  };
}

/** Find an active CarePlan for this condition module to revise (revise-vs-new). */
async function findPriorActiveCarePlanId(
  medplum: MedplumClient,
  patientId: string,
  module: ConditionModule,
): Promise<string | null> {
  const plans = await medplum.searchResources('CarePlan', {
    subject: `Patient/${patientId}`,
    status: 'active',
    category: module.id,
    _count: '1',
  });
  return plans[0]?.id ?? null;
}

/**
 * Medplum-Bot-compatible entry point. Resolves the ConditionModule from the QR,
 * wires reads + builders together and keeps the post-call workers optional
 * (passed as undefined here) so this file has no hard dependency on the workers.
 */
export async function handler(
  medplum: MedplumClient,
  event: { input: QuestionnaireResponse },
): Promise<{ carePlanId: string; medicationRequestIds: string[]; taskId?: string }> {
  const qr = event.input;

  const module = conditionFromQR(qr);

  const patientId = referenceId(qr.subject?.reference);
  if (!patientId) {
    throw new Error('QuestionnaireResponse.subject must reference a Patient');
  }

  const patient = await loadPatientContext(medplum, patientId, module);

  const deps: PostCallDeps = {
    research: undefined,
    peerReview: undefined,
    coverage: undefined,
  };

  const draft = await buildDraftPlan(
    qr,
    patient,
    module,
    (pid) => findPriorActiveCarePlanId(medplum, pid, module),
    deps,
  );

  return persistDraftPlan(medplum, draft, module);
}

/** Extract the bare id from a `ResourceType/id` reference string. */
function referenceId(reference: string | undefined): string | undefined {
  if (!reference) return undefined;
  const parts = reference.split('/');
  return parts[parts.length - 1] || undefined;
}
