/**
 * Review queue hook — LIVE only. Lists ALL draft CarePlans across patients
 * (the clinician worklist), resolving each plan's patient name, treatment,
 * medication, and creation date.
 */
import { useCallback, useEffect, useState } from 'react';
import { useMedplum } from '@medplum/react-hooks';
import type { CarePlan } from '@medplum/fhirtypes';
import { patientRefId } from './usePatientNames';

export type ReviewQueueRow = {
  carePlanId: string;
  patientId: string | null;
  /** treatment label from CarePlan.category */
  treatment: string;
  /** medication display, if the plan references one */
  medication: string;
  /** ISO timestamp (created or lastUpdated), empty if unknown */
  created: string;
};

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

function toRow(cp: CarePlan): ReviewQueueRow {
  return {
    carePlanId: cp.id ?? '',
    patientId: patientRefId(cp.subject?.reference),
    treatment: carePlanTreatment(cp),
    medication: carePlanMedication(cp),
    created: cp.created ?? cp.meta?.lastUpdated ?? '',
  };
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
    const load = () =>
      medplum
        .searchResources('CarePlan', { status: 'draft', _sort: '-_lastUpdated', _count: 50 }, { cache: 'reload' })
        .then((results) => {
          if (cancelled) return;
          setRows(results.filter((cp) => cp.id).map(toRow));
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    void load();
    // Poll so a plan drafted right after a call shows up without a manual refresh.
    const timer = window.setInterval(load, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [medplum, nonce]);

  return { rows, loading, error, refresh };
}
