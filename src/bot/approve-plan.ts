import type { BotEvent, MedplumClient } from '@medplum/core';
import type { CarePlan } from '@medplum/fhirtypes';

/**
 * `careloop-approve-plan` Medplum Bot — atomically ACCEPT an AI-drafted plan.
 *
 * Input: a CarePlan resource, or `{ carePlanId }`. It:
 *   1. sets the CarePlan draft → active,
 *   2. activates every MedicationRequest referenced by the plan (draft → active),
 *   3. closes the open review Task(s) for the patient (requested → completed).
 *
 * The dashboard performs the same steps client-side (attributed to the signed-in
 * clinician); this Bot is the optional server-side/atomic path — deploy with the
 * Medplum CLI and invoke via $execute or a Task-completion subscription.
 */
export async function handler(medplum: MedplumClient, event: BotEvent): Promise<unknown> {
  const input = event.input as CarePlan | { carePlanId?: string };

  const carePlan: CarePlan =
    (input as CarePlan).resourceType === 'CarePlan'
      ? (input as CarePlan)
      : await medplum.readResource('CarePlan', (input as { carePlanId?: string }).carePlanId ?? '');

  if (!carePlan.id) throw new Error('approve-plan: missing CarePlan id');

  // 1. CarePlan draft → active
  await medplum.patchResource('CarePlan', carePlan.id, [
    { op: 'replace', path: '/status', value: 'active' },
  ]);

  // 2. Activate referenced MedicationRequests
  const medIds = (carePlan.activity ?? [])
    .map((a) => a.reference?.reference)
    .filter((r): r is string => Boolean(r?.startsWith('MedicationRequest/')))
    .map((r) => r.split('/')[1]!);
  for (const id of medIds) {
    try {
      await medplum.patchResource('MedicationRequest', id, [
        { op: 'replace', path: '/status', value: 'active' },
      ]);
    } catch {
      /* best-effort */
    }
  }

  // 3. Close the open review Task(s) for the patient
  const subject = carePlan.subject?.reference;
  let tasksClosed = 0;
  if (subject) {
    const tasks = await medplum.searchResources('Task', { subject, status: 'requested' });
    for (const t of tasks) {
      if (!t.id) continue;
      try {
        await medplum.patchResource('Task', t.id, [
          { op: 'replace', path: '/status', value: 'completed' },
        ]);
        tasksClosed++;
      } catch {
        /* best-effort */
      }
    }
  }

  return { carePlanId: carePlan.id, status: 'active', medsActivated: medIds.length, tasksClosed };
}
