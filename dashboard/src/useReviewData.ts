/**
 * Review data hook — LIVE only, driven by a CarePlan id (NOT a patient).
 *
 * Given an open draft CarePlan, it resolves the plan's patient, loads the
 * backend-published plan artifact (patient context + draft plan) for the rich
 * decision-support panels, and subscribes to the patient's charting
 * Communications for the live feed. Approve acts on THIS CarePlan: draft →
 * active, activate its MedicationRequests, and close the patient's review Tasks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMedplum, useSubscription } from '@medplum/react-hooks';
import type { CarePlan, Communication, MedicationRequest } from '@medplum/fhirtypes';
import { ARTIFACT_CATEGORY } from './medplum';
import { patientRefId } from './usePatientNames';
import type {
  CarePlanStatus,
  ChartLine,
  DraftPlan,
  MedOrder,
  PatientContext,
} from './types';

const RXNORM_SYSTEM = 'http://www.nlm.nih.gov/research/umls/rxnorm';

/** Outcome of a one-click approve, so the UI can report exactly what changed. */
export type ApproveResult = {
  ok: boolean;
  carePlanActivated: boolean;
  medicationsActivated: number;
  tasksCompleted: number;
  errors: string[];
};

/** A medication row in the edit form (stable key so React can track rows). */
export type MedEdit = MedOrder & { key: string };

/** Editable subset of the draft plan a clinician may adjust before approval. */
export type PlanEdits = {
  /** the working list of medication orders. */
  medications: MedEdit[];
  followUpWeeks: number;
  goal: string;
  /** free-form clinician note appended to the CarePlan + captured in the artifact. */
  clinicianNote: string;
};

/** Outcome of saving clinician edits, so the UI can report exactly what changed. */
export type SaveResult = {
  ok: boolean;
  /** count of MedicationRequests created or patched. */
  medicationsWritten: number;
  /** count of MedicationRequests cancelled (removed rows). */
  medicationsRemoved: number;
  carePlanUpdated: boolean;
  artifactUpdated: boolean;
  errors: string[];
};

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `med-${keySeq}-${Math.random().toString(36).slice(2, 7)}`;
}

export type ReviewData = {
  /** the CarePlan currently under review (if resolved). */
  carePlan: CarePlan | null;
  /** the resolved patient id for the open CarePlan. */
  patientId: string | null;
  /** rich patient context from the plan artifact. */
  patient: PatientContext | null;
  /** the AI-drafted plan from the artifact. */
  draftPlan: DraftPlan | null;
  chartLines: ChartLine[];
  carePlanStatus: CarePlanStatus;
  loading: boolean;
  approving: boolean;
  approveResult: ApproveResult | null;
  /** one-click approve of the open CarePlan (+ meds + review tasks). */
  approve: () => void;
  /** whether the plan card is currently in editable form. */
  editing: boolean;
  /** the working editable copy of the plan fields (null until derived). */
  edits: PlanEdits | null;
  /** enter edit mode (no-op after approval). */
  startEditing: () => void;
  /** discard edits and leave edit mode. */
  cancelEditing: () => void;
  /** patch a single editable field on the working copy. */
  updateEdit: <K extends keyof PlanEdits>(key: K, value: PlanEdits[K]) => void;
  /** patch one field on a single medication row (by key). */
  updateMed: <K extends keyof MedOrder>(key: string, field: K, value: MedOrder[K]) => void;
  /** append an empty medication row. */
  addMed: () => void;
  /** remove a medication row (by key). */
  removeMed: (key: string) => void;
  /** append a suggested-edit string to the clinician note (opening edit mode if needed). */
  applySuggestion: (text: string) => void;
  saving: boolean;
  saveResult: SaveResult | null;
  /** persist the working edits to FHIR + the plan artifact. */
  saveEdits: () => void;
};

/** Normalize a draft plan's medications, falling back to the legacy single med. */
function medsFromPlan(plan: DraftPlan): MedOrder[] {
  const list = plan.step.medications ?? [];
  if (list.length > 0) return list;
  if (plan.step.medDisplay || plan.step.medRxcui) {
    return [{ rxcui: plan.step.medRxcui ?? '', display: plan.step.medDisplay ?? '' }];
  }
  return [];
}

/** Derive the editable fields from a draft plan. */
function editsFromPlan(plan: DraftPlan): PlanEdits {
  return {
    medications: medsFromPlan(plan).map((m) => ({ ...m, key: nextKey() })),
    followUpWeeks: plan.step.followUpWeeks ?? 0,
    goal: plan.step.goal ?? '',
    clinicianNote: '',
  };
}

/** Strip the UI-only `key` before persisting. */
function stripKey(m: MedEdit): MedOrder {
  const { key: _key, ...rest } = m;
  return rest;
}

/** Build a draft MedicationRequest body from a med order for a patient. */
function medRequestBody(patientId: string, m: MedOrder): MedicationRequest {
  const req: MedicationRequest = {
    resourceType: 'MedicationRequest',
    status: 'draft',
    intent: 'order',
    subject: { reference: `Patient/${patientId}` },
    medicationCodeableConcept: {
      text: m.display,
      coding: m.rxcui
        ? [{ system: RXNORM_SYSTEM, code: m.rxcui, display: m.display }]
        : undefined,
    },
  };
  if (m.sig) {
    req.dosageInstruction = [{ text: m.sig }];
  }
  if (typeof m.quantity === 'number' || typeof m.refills === 'number') {
    req.dispenseRequest = {
      ...(typeof m.quantity === 'number' ? { quantity: { value: m.quantity } } : {}),
      ...(typeof m.refills === 'number' ? { numberOfRepeatsAllowed: m.refills } : {}),
    };
  }
  return req;
}

function communicationToChartLine(c: Communication): ChartLine {
  const text =
    c.payload?.map((p) => p.contentString).filter(Boolean).join(' ') ?? '(charted note)';
  const lower = text.toLowerCase();
  const kind: ChartLine['kind'] = lower.startsWith('act')
    ? 'act'
    : lower.includes('concern')
      ? 'concern'
      : lower.includes('asked') || lower.includes('moss')
        ? 'qa'
        : 'system';
  return {
    id: c.id ?? Math.random().toString(36).slice(2),
    at: c.sent ?? c.meta?.lastUpdated ?? new Date().toISOString(),
    text,
    kind,
  };
}

/** Excluded from the charting feed: the artifact and call-log Communications. */
function isFeedNoise(c: Communication): boolean {
  return Boolean(
    c.category?.some((cat) =>
      cat.coding?.some((cd) => cd.code === 'careloop-dashboard' || cd.code === 'careloop-call'),
    ),
  );
}

/** Collect MedicationRequest ids referenced by a CarePlan's activities. */
function medRequestRefs(cp: CarePlan): string[] {
  const ids: string[] = [];
  for (const a of cp.activity ?? []) {
    const ref = a.reference?.reference;
    if (ref?.startsWith('MedicationRequest/')) {
      ids.push(ref.slice('MedicationRequest/'.length));
    }
  }
  return ids;
}

export function useReviewData(carePlanId: string | null): ReviewData {
  const medplum = useMedplum();
  const [carePlan, setCarePlan] = useState<CarePlan | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChartLine[]>([]);
  const [status, setStatus] = useState<CarePlanStatus>('draft');
  const [artifact, setArtifact] = useState<{ patient: PatientContext; plan: DraftPlan } | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(Boolean(carePlanId));
  const [approving, setApproving] = useState(false);
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<PlanEdits | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const seen = useRef(new Set<string>());

  const criteria = patientId ? `Communication?subject=Patient/${patientId}` : '';

  useEffect(() => {
    // Reset per-plan state whenever the open CarePlan changes.
    seen.current = new Set<string>();
    setCarePlan(null);
    setPatientId(null);
    setLines([]);
    setStatus('draft');
    setArtifact(null);
    setApproveResult(null);
    setEditing(false);
    setEdits(null);
    setSaveResult(null);

    if (!carePlanId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      let pid: string | null = null;
      try {
        const cp = await medplum.readResource('CarePlan', carePlanId);
        if (cancelled) return;
        setCarePlan(cp);
        setStatus(cp.status === 'active' ? 'active' : 'draft');
        pid = patientRefId(cp.subject?.reference);
        setPatientId(pid);
      } catch {
        if (!cancelled) setLoading(false);
        return;
      }

      if (!pid) {
        if (!cancelled) setLoading(false);
        return;
      }

      // 1. The backend-published plan artifact drives the rich panels.
      const artifactP = medplum
        .searchOne('Communication', {
          subject: `Patient/${pid}`,
          category: ARTIFACT_CATEGORY,
          _sort: '-sent',
        })
        .then((c) => {
          if (cancelled || !c) return;
          const raw = c.payload?.find((p) => p.contentString)?.contentString;
          if (raw) {
            try {
              setArtifact(JSON.parse(raw) as { patient: PatientContext; plan: DraftPlan });
            } catch {
              /* malformed artifact — leave empty */
            }
          }
        })
        .catch(() => {
          /* no artifact yet — leave empty */
        });

      // 2. The charting feed, excluding the artifact + call-log Communications.
      medplum
        .searchResources('Communication', {
          subject: `Patient/${pid}`,
          _sort: '-sent',
          _count: 50,
        })
        .then((results) => {
          if (cancelled) return;
          const mapped = results.filter((c) => !isFeedNoise(c)).map(communicationToChartLine);
          mapped.forEach((m) => seen.current.add(m.id));
          setLines(mapped);
        })
        .catch(() => {
          /* ignore — no feed yet */
        });

      await artifactP;
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [medplum, carePlanId]);

  // Live subscription — prepend new charting Communications as they arrive.
  useSubscription(criteria, (bundle) => {
    const entry = bundle.entry?.find((e) => e.resource?.resourceType === 'Communication');
    const resource = entry?.resource as Communication | undefined;
    if (!resource?.id || seen.current.has(resource.id) || isFeedNoise(resource)) return;
    seen.current.add(resource.id);
    setLines((prev) => [communicationToChartLine(resource), ...prev]);
  });

  const approve = useCallback(() => {
    if (!carePlanId || !patientId) return;
    setApproving(true);
    setApproveResult(null);

    void (async () => {
      const errors: string[] = [];
      let carePlanActivated = false;
      let medicationsActivated = 0;
      let tasksCompleted = 0;

      // a. Flip THIS CarePlan draft → active.
      try {
        await medplum.patchResource('CarePlan', carePlanId, [
          { op: 'replace', path: '/status', value: 'active' },
        ]);
        carePlanActivated = true;
      } catch (err) {
        errors.push(`CarePlan activation failed: ${msg(err)}`);
      }

      // b. Activate the plan's MedicationRequests (refs, else search drafts).
      let medIds: string[] = carePlan ? medRequestRefs(carePlan) : [];
      if (medIds.length === 0) {
        try {
          const meds = await medplum.searchResources('MedicationRequest', {
            subject: `Patient/${patientId}`,
            status: 'draft',
          });
          medIds = meds.map((m) => m.id).filter((id): id is string => Boolean(id));
        } catch (err) {
          errors.push(`Could not list MedicationRequests: ${msg(err)}`);
        }
      }
      for (const id of medIds) {
        try {
          await medplum.patchResource('MedicationRequest', id, [
            { op: 'replace', path: '/status', value: 'active' },
          ]);
          medicationsActivated += 1;
        } catch (err) {
          errors.push(`MedicationRequest ${id} activation failed: ${msg(err)}`);
        }
      }

      // c. Close the patient's review Task(s).
      try {
        const tasks = await medplum.searchResources('Task', {
          subject: `Patient/${patientId}`,
          status: 'requested',
        });
        for (const t of tasks) {
          if (!t.id) continue;
          try {
            await medplum.patchResource('Task', t.id, [
              { op: 'replace', path: '/status', value: 'completed' },
            ]);
            tasksCompleted += 1;
          } catch (err) {
            errors.push(`Task ${t.id} close failed: ${msg(err)}`);
          }
        }
      } catch (err) {
        errors.push(`Could not list review Tasks: ${msg(err)}`);
      }

      const ok = carePlanActivated && errors.length === 0;
      setApproveResult({ ok, carePlanActivated, medicationsActivated, tasksCompleted, errors });
      if (carePlanActivated) setStatus('active');
      setApproving(false);
    })();
  }, [medplum, carePlanId, patientId, carePlan]);

  const startEditing = useCallback(() => {
    if (status !== 'draft') return;
    const plan = artifact?.plan;
    if (!plan) return;
    setEdits((prev) => prev ?? editsFromPlan(plan));
    setSaveResult(null);
    setEditing(true);
  }, [status, artifact]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEdits(null);
    setSaveResult(null);
  }, []);

  const updateEdit = useCallback(
    <K extends keyof PlanEdits>(key: K, value: PlanEdits[K]) => {
      setEdits((prev) => {
        const base = prev ?? (artifact?.plan ? editsFromPlan(artifact.plan) : null);
        if (!base) return prev;
        return { ...base, [key]: value };
      });
    },
    [artifact],
  );

  const updateMed = useCallback(
    <K extends keyof MedOrder>(key: string, field: K, value: MedOrder[K]) => {
      setEdits((prev) => {
        const base = prev ?? (artifact?.plan ? editsFromPlan(artifact.plan) : null);
        if (!base) return prev;
        return {
          ...base,
          medications: base.medications.map((m) =>
            m.key === key ? { ...m, [field]: value } : m,
          ),
        };
      });
    },
    [artifact],
  );

  const addMed = useCallback(() => {
    setEdits((prev) => {
      const base = prev ?? (artifact?.plan ? editsFromPlan(artifact.plan) : null);
      if (!base) return prev;
      return {
        ...base,
        medications: [...base.medications, { key: nextKey(), rxcui: '', display: '' }],
      };
    });
  }, [artifact]);

  const removeMed = useCallback(
    (key: string) => {
      setEdits((prev) => {
        const base = prev ?? (artifact?.plan ? editsFromPlan(artifact.plan) : null);
        if (!base) return prev;
        return { ...base, medications: base.medications.filter((m) => m.key !== key) };
      });
    },
    [artifact],
  );

  const applySuggestion = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (status !== 'draft') return;
      const plan = artifact?.plan;
      if (!plan) return;
      setEditing(true);
      setSaveResult(null);
      setEdits((prev) => {
        const base = prev ?? editsFromPlan(plan);
        const existing = base.clinicianNote.trim();
        const clinicianNote = existing ? `${existing}\n${trimmed}` : trimmed;
        return { ...base, clinicianNote };
      });
    },
    [status, artifact],
  );

  const saveEdits = useCallback(() => {
    if (!carePlanId || !patientId || !edits) return;
    const plan = artifact?.plan;
    if (!plan) return;
    setSaving(true);
    setSaveResult(null);

    void (async () => {
      const errors: string[] = [];
      let medicationsWritten = 0;
      let medicationsRemoved = 0;
      let carePlanUpdated = false;
      let artifactUpdated = false;

      const followUpWeeks = Number.isFinite(edits.followUpWeeks)
        ? Math.max(0, Math.round(edits.followUpWeeks))
        : plan.step.followUpWeeks;
      const goal = edits.goal.trim();
      const clinicianNote = edits.clinicianNote.trim();

      // Keep only rows with a drug name; trim strings so the artifact stays clean.
      const editedMeds: MedOrder[] = edits.medications
        .map(stripKey)
        .map((m) => ({ ...m, display: m.display.trim(), rxcui: (m.rxcui ?? '').trim() }))
        .filter((m) => m.display.length > 0);

      const followUpChanged = followUpWeeks !== plan.step.followUpWeeks;
      const goalChanged = goal !== (plan.step.goal ?? '');

      // a. Reconcile FHIR MedicationRequests best-effort — each write is independent
      //    so a partial failure is reported but never blocks the rest.
      const existingIds = carePlan ? medRequestRefs(carePlan) : [];
      const activityRefs: string[] = [];

      for (let i = 0; i < editedMeds.length; i++) {
        const m = editedMeds[i];
        const existingId = existingIds[i];
        try {
          if (existingId) {
            const body = medRequestBody(patientId, m);
            await medplum.patchResource('MedicationRequest', existingId, [
              { op: 'replace', path: '/medicationCodeableConcept', value: body.medicationCodeableConcept },
              body.dosageInstruction
                ? { op: 'add', path: '/dosageInstruction', value: body.dosageInstruction }
                : { op: 'add', path: '/dosageInstruction', value: [] },
              body.dispenseRequest
                ? { op: 'add', path: '/dispenseRequest', value: body.dispenseRequest }
                : { op: 'add', path: '/dispenseRequest', value: {} },
            ]);
            activityRefs.push(`MedicationRequest/${existingId}`);
            medicationsWritten += 1;
          } else {
            const created = await medplum.createResource(medRequestBody(patientId, m));
            if (created.id) activityRefs.push(`MedicationRequest/${created.id}`);
            medicationsWritten += 1;
          }
        } catch (err) {
          errors.push(`MedicationRequest for "${m.display}" failed: ${msg(err)}`);
        }
      }

      // Cancel MedicationRequests for removed rows (fewer meds than before).
      for (let i = editedMeds.length; i < existingIds.length; i++) {
        try {
          await medplum.patchResource('MedicationRequest', existingIds[i], [
            { op: 'replace', path: '/status', value: 'cancelled' },
          ]);
          medicationsRemoved += 1;
        } catch (err) {
          errors.push(`MedicationRequest ${existingIds[i]} cancel failed: ${msg(err)}`);
        }
      }

      // b. Update the CarePlan: refresh description, point activity[] at the meds,
      //    and append a note summarizing what changed.
      try {
        const primary = editedMeds[0];
        const medSummary = editedMeds.length
          ? editedMeds.map((m) => m.display).join(', ')
          : '(no medication)';
        const changeParts: string[] = [`medications: ${medSummary}`];
        if (followUpChanged) changeParts.push(`follow-up to ${followUpWeeks} weeks`);
        if (goalChanged) changeParts.push(`goal: ${goal}`);
        const summary = `Clinician adjusted ${changeParts.join('; ')}.`;
        const description = `${primary?.display ?? '(no medication)'}${
          editedMeds.length > 1 ? ` +${editedMeds.length - 1} more` : ''
        }; follow-up in ${followUpWeeks} weeks; goal: ${goal}`;
        const noteText = clinicianNote ? `${summary}\nNote: ${clinicianNote}` : summary;

        const noteEntry = { text: noteText, time: new Date().toISOString() };
        const hasNotes = (carePlan?.note?.length ?? 0) > 0;
        const activityValue = activityRefs.map((reference) => ({ reference: { reference } }));
        const ops: { op: 'add' | 'replace'; path: string; value: unknown }[] = [
          { op: 'replace', path: '/description', value: description },
          hasNotes
            ? { op: 'add', path: '/note/-', value: noteEntry }
            : { op: 'add', path: '/note', value: [noteEntry] },
        ];
        // Only rewrite activity[] if we resolved at least one MedicationRequest ref.
        if (activityValue.length > 0) {
          ops.push({ op: 'add', path: '/activity', value: activityValue });
        }
        await medplum.patchResource('CarePlan', carePlanId, ops);
        carePlanUpdated = true;
        setCarePlan((prev) =>
          prev
            ? {
                ...prev,
                description,
                note: [...(prev.note ?? []), noteEntry],
                ...(activityValue.length > 0 ? { activity: activityValue } : {}),
              }
            : prev,
        );
      } catch (err) {
        errors.push(`CarePlan update failed: ${msg(err)}`);
      }

      // c. Update the plan artifact Communication so the panels persist the edits.
      try {
        const comm = await medplum.searchOne('Communication', {
          subject: `Patient/${patientId}`,
          category: ARTIFACT_CATEGORY,
          _sort: '-sent',
        });
        if (!comm) {
          errors.push('No plan artifact found to update.');
        } else {
          const idx = comm.payload?.findIndex((p) => p.contentString) ?? -1;
          const raw = idx >= 0 ? comm.payload?.[idx]?.contentString : undefined;
          if (raw == null || idx < 0) {
            errors.push('Plan artifact payload was empty.');
          } else {
            const parsed = JSON.parse(raw) as { patient: PatientContext; plan: DraftPlan };
            const primary = editedMeds[0];
            parsed.plan.step = {
              ...parsed.plan.step,
              medications: editedMeds,
              medRxcui: primary?.rxcui ?? '',
              medDisplay: primary?.display ?? '',
              followUpWeeks,
              goal,
            };
            await medplum.patchResource('Communication', comm.id!, [
              {
                op: 'replace',
                path: `/payload/${idx}/contentString`,
                value: JSON.stringify(parsed),
              },
            ]);
            artifactUpdated = true;
            setArtifact(parsed);
          }
        }
      } catch (err) {
        errors.push(`Plan artifact update failed: ${msg(err)}`);
      }

      const ok = errors.length === 0;
      setSaveResult({
        ok,
        medicationsWritten,
        medicationsRemoved,
        carePlanUpdated,
        artifactUpdated,
        errors,
      });
      setSaving(false);
      if (ok) {
        setEditing(false);
        setEdits(null);
      }
    })();
  }, [medplum, carePlanId, patientId, edits, artifact, carePlan]);

  return {
    carePlan,
    patientId,
    patient: artifact?.patient ?? null,
    draftPlan: artifact?.plan ?? null,
    chartLines: lines,
    carePlanStatus: status,
    loading,
    approving,
    approveResult,
    approve,
    editing,
    edits,
    startEditing,
    cancelEditing,
    updateEdit,
    updateMed,
    addMed,
    removeMed,
    applySuggestion,
    saving,
    saveResult,
    saveEdits,
  };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
