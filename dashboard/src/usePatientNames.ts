/**
 * Batch/cached patient-name resolver. Given a set of `Patient/<id>` references
 * (or bare ids), resolves each to a display name via readResource, caching
 * results across renders so lists don't re-fetch the same patient repeatedly.
 */
import { useEffect, useRef, useState } from 'react';
import { useMedplum } from '@medplum/react-hooks';
import { patientDisplayName } from './usePatientList';

/** Normalize a `Patient/<id>` reference or bare id to the bare id. */
export function patientRefId(ref: string | undefined | null): string | null {
  if (!ref) return null;
  return ref.startsWith('Patient/') ? ref.slice('Patient/'.length) : ref;
}

/**
 * Resolves the given patient ids to display names. Returns a lookup keyed by
 * bare id. Unknown/loading ids simply won't be present in the map yet.
 */
export function usePatientNames(ids: (string | null | undefined)[]): Record<string, string> {
  const medplum = useMedplum();
  const cache = useRef<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});

  const key = Array.from(new Set(ids.filter(Boolean) as string[])).sort().join(',');

  useEffect(() => {
    const wanted = Array.from(new Set(ids.filter(Boolean) as string[]));
    const missing = wanted.filter((id) => !(id in cache.current));
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missing.map(async (id) => {
        try {
          const p = await medplum.readResource('Patient', id);
          cache.current[id] = patientDisplayName(p);
        } catch {
          cache.current[id] = `Patient ${id}`;
        }
      }),
    ).then(() => {
      if (!cancelled) setNames({ ...cache.current });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medplum, key]);

  return names;
}
