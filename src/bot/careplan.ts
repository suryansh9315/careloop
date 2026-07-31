/**
 * Pure FHIR builders for the post-call Bot. No I/O — every function takes plain
 * inputs and returns a fully-typed FHIR resource (@medplum/fhirtypes). The
 * orchestration handler (questionnaire-response.ts) does the reads/writes and
 * wires these together.
 *
 * These builders are CONDITION-AGNOSTIC: they are driven by the ConditionModule
 * passed in (instrument LOINC codes, labels), never by hardcoded asthma
 * constants. Codings come from the module / src/clinical/codes.ts; the pipeline
 * validates them via Medplum's terminology service elsewhere and degrades
 * gracefully.
 */

import type {
  CarePlan,
  Communication,
  MedicationRequest,
  Observation,
  Task,
} from '@medplum/fhirtypes';
import type {
  ActResult,
  CoverageResult,
  MedOrder,
  PeerReviewSummary,
  ProtocolStep,
  ResearchFinding,
} from '../types.js';
import type { ConditionModule } from '../conditions/types.js';
import { SYSTEM } from '../clinical/codes.js';

/**
 * One Observation per answered instrument item (LOINC from
 * `module.instrument.items[].loinc`) plus a total-score Observation
 * (`module.instrument.totalLoinc`). status 'final', subject Patient/id,
 * valueInteger.
 */
export function buildActObservations(
  patientId: string,
  module: ConditionModule,
  actResult: ActResult,
): Observation[] {
  const subject = { reference: `Patient/${patientId}` };
  const effectiveDateTime = new Date().toISOString(); // finalized-at — dates the score for future trends
  const byId = new Map(actResult.answers.map((a) => [a.linkId, a.value]));

  const items: Observation[] = module.instrument.items
    .filter((item) => byId.has(item.linkId))
    .map((item) => ({
      resourceType: 'Observation',
      status: 'final',
      code: {
        coding: [{ system: SYSTEM.LOINC, code: item.loinc, display: item.prompt }],
        text: item.prompt,
      },
      subject,
      effectiveDateTime,
      valueInteger: byId.get(item.linkId) ?? 0,
    } satisfies Observation));

  const total: Observation = {
    resourceType: 'Observation',
    status: 'final',
    code: {
      coding: [
        { system: SYSTEM.LOINC, code: module.instrument.totalLoinc, display: `${module.instrument.name} total score` },
      ],
      text: `${module.instrument.name} total score`,
    },
    subject,
    effectiveDateTime,
    valueInteger: actResult.total,
  };

  return [...items, total];
}

/**
 * Build ONE draft MedicationRequest (intent 'proposal') per structured
 * `MedOrder` in the step, coded with RxNorm and carrying a `dosageInstruction`
 * (sig text, route, timing / asNeeded from frequency+prn) plus a
 * `dispenseRequest` (quantity + repeats) when the order specifies them.
 *
 * Falls back to a single request from the legacy `medRxcui`/`medDisplay` when
 * `step.medications` is empty but a primary med is present; returns `[]` when
 * the band has no medication at all (e.g. depression minimal/mild).
 */
export function buildMedicationRequests(
  patientId: string,
  step: ProtocolStep,
): MedicationRequest[] {
  const subject = { reference: `Patient/${patientId}` };

  const orders: MedOrder[] =
    step.medications.length > 0
      ? step.medications
      : step.medRxcui
        ? [{ rxcui: step.medRxcui, display: step.medDisplay }]
        : [];

  return orders.map((med) => {
    const request: MedicationRequest = {
      resourceType: 'MedicationRequest',
      status: 'draft',
      intent: 'proposal',
      subject,
      medicationCodeableConcept: {
        coding: [{ system: SYSTEM.RXNORM, code: med.rxcui, display: med.display }],
        text: med.display,
      },
      dosageInstruction: [buildDosageInstruction(med)],
    };

    const dispenseRequest = buildDispenseRequest(med);
    if (dispenseRequest) request.dispenseRequest = dispenseRequest;

    return request;
  });
}

/** Build a FHIR Dosage from a MedOrder (sig text, route, timing / asNeeded). */
function buildDosageInstruction(med: MedOrder): NonNullable<MedicationRequest['dosageInstruction']>[number] {
  const dosage: NonNullable<MedicationRequest['dosageInstruction']>[number] = {};

  if (med.sig) dosage.text = med.sig;
  if (med.route) dosage.route = { text: med.route };

  if (med.prn) {
    dosage.asNeededBoolean = true;
    if (med.frequency) dosage.timing = { code: { text: med.frequency } };
  } else if (med.frequency) {
    dosage.timing = { code: { text: med.frequency } };
  }

  return dosage;
}

/** Build a dispenseRequest (quantity + numberOfRepeatsAllowed) when specified. */
function buildDispenseRequest(med: MedOrder): NonNullable<MedicationRequest['dispenseRequest']> | undefined {
  const dispense: NonNullable<MedicationRequest['dispenseRequest']> = {};
  let any = false;

  if (typeof med.quantity === 'number') {
    dispense.quantity = { value: med.quantity };
    any = true;
  }
  if (typeof med.refills === 'number') {
    dispense.numberOfRepeatsAllowed = med.refills;
    any = true;
  }

  return any ? dispense : undefined;
}

/**
 * A draft CarePlan that addresses the anchor Condition, references ALL drafted
 * MedicationRequests (one activity each), and schedules a follow-up
 * ServiceRequest per step. `category` text carries the condition module id/label.
 * When `replacesCarePlanId` is set, the plan supersedes the prior active plan.
 */
export function buildDraftCarePlan(input: {
  patientId: string;
  conditionId: string;
  step: ProtocolStep;
  /** condition module id (e.g. 'asthma') — used for the CarePlan category text */
  categoryText: string;
  /** condition module label (e.g. 'Asthma (Asthma Control Test)') — used in copy */
  conditionLabel: string;
  /** references for every MedicationRequest created for this step (may be empty) */
  medicationRequestRefs: string[];
  replacesCarePlanId: string | null;
  goalText: string;
}): CarePlan {
  const {
    patientId,
    conditionId,
    step,
    categoryText,
    conditionLabel,
    medicationRequestRefs,
    replacesCarePlanId,
    goalText,
  } = input;

  // Follow-up date: now + followUpWeeks (supports fractional weeks like 1.5).
  const followUp = new Date(Date.now() + step.followUpWeeks * 7 * 24 * 60 * 60 * 1000);
  const followUpIso = followUp.toISOString();

  const activity: NonNullable<CarePlan['activity']> = [];
  for (const ref of medicationRequestRefs) {
    activity.push({ reference: { reference: ref } });
  }
  activity.push({
    detail: {
      kind: 'ServiceRequest',
      status: 'scheduled',
      description: `Follow-up ${conditionLabel} review in ${step.followUpWeeks} week(s). Goal: ${goalText}`,
      scheduledTiming: {
        event: [followUpIso],
      },
    },
  });

  // Description = step summary + a human-readable listing of the regimen.
  const regimenLines = step.medications.map((m) => {
    const role = m.role ? ` [${m.role}]` : '';
    return `- ${m.display}${role}${m.sig ? `: ${m.sig}` : ''}`;
  });
  const description = regimenLines.length
    ? `${step.summary}\n\nRegimen:\n${regimenLines.join('\n')}`
    : step.summary;

  const carePlan: CarePlan = {
    resourceType: 'CarePlan',
    status: 'draft',
    intent: 'plan',
    subject: { reference: `Patient/${patientId}` },
    addresses: [{ reference: `Condition/${conditionId}` }],
    category: [{ text: categoryText }],
    description,
    activity,
  };

  if (replacesCarePlanId) {
    carePlan.replaces = [{ reference: `CarePlan/${replacesCarePlanId}` }];
  }

  return carePlan;
}

/**
 * An urgent Task for the care team, created when the score band warrants
 * escalation. Mentions the instrument by name and the total in its description.
 */
export function buildEscalationTask(
  patientId: string,
  module: ConditionModule,
  actResult: ActResult,
): Task {
  const bandText = actResult.bandLabel ?? actResult.band;
  return {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    priority: 'urgent',
    for: { reference: `Patient/${patientId}` },
    description: `Urgent care-team review: ${module.label} — ${bandText} (${module.instrument.name} total ${actResult.total}). Confirm the drafted plan and reach out to the patient.`,
  };
}

/**
 * Human-readable Communications attaching the research rationale (with
 * citations), the peer-review consensus/flags, and the coverage/cost summary to
 * the patient record. status 'completed', subject Patient/id.
 */
export function buildReviewCommunications(
  patientId: string,
  research: ResearchFinding[],
  peerReview?: PeerReviewSummary,
  coverage?: CoverageResult,
): Communication[] {
  const subject = { reference: `Patient/${patientId}` };
  const comms: Communication[] = [];

  for (const finding of research) {
    const citations = finding.citations
      .map((c) => `- ${c.title} (${c.url})${c.note ? ` — ${c.note}` : ''}`)
      .join('\n');
    const body =
      `Research rationale — ${finding.topic}\n\n${finding.rationale}` +
      (citations ? `\n\nCitations:\n${citations}` : '');
    comms.push({
      resourceType: 'Communication',
      status: 'completed',
      subject,
      category: [{ text: 'research-rationale' }],
      payload: [{ contentString: body }],
    });
  }

  if (peerReview) {
    const reviewLines = peerReview.reviews
      .map(
        (r) =>
          `- ${r.label ?? r.expert}: ${r.verdict} — ${r.rationale}` +
          (r.suggestedEdit ? ` (suggested edit: ${r.suggestedEdit})` : ''),
      )
      .join('\n');
    const flagged = peerReview.flagged.length
      ? `\n\nFlagged:\n${peerReview.flagged.map((f) => `- ${f}`).join('\n')}`
      : '';
    const body = `Expert peer review — consensus: ${peerReview.consensus}\n\n${reviewLines}${flagged}`;
    comms.push({
      resourceType: 'Communication',
      status: 'completed',
      subject,
      category: [{ text: 'peer-review' }],
      payload: [{ contentString: body }],
    });
  }

  if (coverage) {
    const body =
      `Coverage & cost summary — ${coverage.planName}\n\n` +
      `Covered: ${coverage.covered ? 'yes' : 'no'}\n` +
      `Prior authorization required: ${coverage.priorAuthRequired ? 'yes' : 'no'}\n` +
      `Estimated out-of-pocket: $${coverage.copayUsd.toFixed(2)}\n\n` +
      coverage.notes;
    comms.push({
      resourceType: 'Communication',
      status: 'completed',
      subject,
      category: [{ text: 'coverage-cost' }],
      payload: [{ contentString: body }],
    });
  }

  return comms;
}
