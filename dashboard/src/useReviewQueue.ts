/**
 * Review queue hook — LIVE only. Lists ALL draft CarePlans across patients
 * and enriches each row with the latest plan artifact (scores, peer review,
 * safety, coverage) for decision-support visuals on the queue page.
 */
import { useCallback, useEffect, useState } from 'react';
import { useMedplum } from '@medplum/react-hooks';
import type { CarePlan, Communication } from '@medplum/fhirtypes';
import { ARTIFACT_CATEGORY } from './medplum';
import { patientRefId } from './usePatientNames';
import type { DraftPlan, PatientContext, ReviewQueueRow } from './types';
import { enrichQueueRow } from './reviewQueueEnrich';

export type { ReviewQueueRow } from './types';

export type ReviewQueueState = {
  rows: ReviewQueueRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function carePlanTreatment(cp: CarePlan): string {
  return (
    cp.category?.map((c) => c.text ?? c.coding?.[0]?.display).find(Boolean) ??
    cp.title ??
    'Care plan'
  );
}

export function carePlanMedication(cp: CarePlan): string {
  return (
    cp.activity
      ?.map((a) => a.detail?.code?.text ?? a.detail?.code?.coding?.[0]?.display)
      .find(Boolean) ?? '—'
  );
}

function toBaseRow(cp: CarePlan): Omit<ReviewQueueRow, 'hasArtifact'> {
  return {
    carePlanId: cp.id ?? '',
    patientId: patientRefId(cp.subject?.reference),
    treatment: carePlanTreatment(cp),
    medication: carePlanMedication(cp),
    created: cp.created ?? cp.meta?.lastUpdated ?? '',
  };
}

function parseArtifactPayload(c: Communication): { patient: PatientContext; plan: DraftPlan } | null {
  const raw = c.payload?.find((p) => p.contentString)?.contentString;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { patient: PatientContext; plan: DraftPlan };
  } catch {
    return null;
  }
}

export function useReviewQueue(): ReviewQueueState {
  const medplum = useMedplum();
  const [rows, setRows] = useState<ReviewQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Polling + `cache: 'reload'` come from main: a plan drafted right after a
    // call has to appear without a manual refresh. The artifact fetch and
    // enrichment are what give each row its scores, peer review, safety flags
    // and coverage — both are needed, so the poll re-runs the enriched load.
    const load = async () => {
      try {
        const [carePlans, artifacts] = await Promise.all([
          medplum.searchResources(
            'CarePlan',
            { status: 'draft', _sort: '-_lastUpdated', _count: 50 },
            { cache: 'reload' },
          ),
          medplum
            .searchResources(
              'Communication',
              {
                category: ARTIFACT_CATEGORY,
                _sort: '-sent',
                _count: 100,
              },
              { cache: 'reload' },
            )
            .catch(() => [] as Communication[]),
        ]);
        if (cancelled) return;

        const artifactByPatient = new Map<string, { patient: PatientContext; plan: DraftPlan }>();
        for (const comm of artifacts) {
          const pid = patientRefId(comm.subject?.reference);
          if (!pid || artifactByPatient.has(pid)) continue;
          const parsed = parseArtifactPayload(comm);
          if (parsed) artifactByPatient.set(pid, parsed);
        }

        const next = carePlans
          .filter((cp) => cp.id)
          .map((cp) => {
            const base = toBaseRow(cp);
            const artifact = base.patientId ? artifactByPatient.get(base.patientId) ?? null : null;
            return enrichQueueRow(base, artifact);
          });

        setRows(next);
        setError(null);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 6000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [medplum, nonce]);

  return { rows, loading, error, refresh };
}
