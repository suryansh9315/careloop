/**
 * Patient sync hook — LIVE only. Loads the signed-in user's patients from
 * Medplum (respecting their AccessPolicy) and exposes a manual refresh so a
 * newly created intake shows up on demand.
 */
import { useCallback, useEffect, useState } from 'react';
import { useMedplum } from '@medplum/react-hooks';
import type { Patient } from '@medplum/fhirtypes';

export type PatientRow = {
  id: string;
  name: string;
  /** YYYY-MM-DD (empty if unknown) */
  dob: string;
  /** raw FHIR resource, kept for downstream needs */
  resource: Patient;
};

export type PatientListState = {
  patients: PatientRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function patientDisplayName(p: Patient): string {
  const n = p.name?.[0];
  if (n) {
    const label = [n.given?.join(' '), n.family].filter(Boolean).join(' ');
    if (label) return label;
    if (n.text) return n.text;
  }
  return `Patient ${p.id ?? '—'}`;
}

function toRow(p: Patient): PatientRow {
  return {
    id: p.id ?? '',
    name: patientDisplayName(p),
    dob: p.birthDate ?? '',
    resource: p,
  };
}

export function usePatientList(): PatientListState {
  const medplum = useMedplum();
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    medplum
      .searchResources('Patient', { _count: 50, _sort: '-_lastUpdated' })
      .then((results) => {
        if (cancelled) return;
        setPatients(results.filter((p) => p.id).map(toRow));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [medplum, nonce]);

  return { patients, loading, error, refresh };
}
