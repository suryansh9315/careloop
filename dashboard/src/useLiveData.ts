/**
 * Live-call data hook — LIVE only, driven by a patient id (the patient whose
 * in-progress call is currently being charted).
 *
 * Given the active patient, it loads the patient's human-readable charting
 * Communications (excluding the call-log + artifact categories) and the coded
 * preliminary Observations, then subscribes to both so new rows stream in as
 * the bridge writes them during the call. Mirrors useReviewData's
 * searchResources + useSubscription pattern, keyed on the patient id and
 * guarding the Rules of Hooks (hooks always run; a null id yields empty state).
 */
import { useEffect, useRef, useState } from 'react';
import { useMedplum, useSubscription } from '@medplum/react-hooks';
import type { Communication, Observation } from '@medplum/fhirtypes';
import type { ChartLine } from './types';

/** A coded, preliminary Observation charted live during the call. */
export type LiveObservation = {
  id: string;
  /** ISO timestamp */
  at: string;
  /** LOINC display, e.g. "Total score [ACT]" */
  label: string;
  /** valueInteger, if present */
  value: number | null;
};

export type LiveData = {
  chartLines: ChartLine[];
  observations: LiveObservation[];
};

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

function observationToRow(o: Observation): LiveObservation {
  return {
    id: o.id ?? Math.random().toString(36).slice(2),
    at: o.effectiveDateTime ?? o.issued ?? o.meta?.lastUpdated ?? new Date().toISOString(),
    label: o.code?.coding?.[0]?.display ?? o.code?.text ?? 'Observation',
    value: typeof o.valueInteger === 'number' ? o.valueInteger : null,
  };
}

export function useLiveData(patientId: string | null): LiveData {
  const medplum = useMedplum();
  const [lines, setLines] = useState<ChartLine[]>([]);
  const [observations, setObservations] = useState<LiveObservation[]>([]);
  const seenComm = useRef(new Set<string>());
  const seenObs = useRef(new Set<string>());

  const commCriteria = patientId ? `Communication?subject=Patient/${patientId}` : '';
  const obsCriteria = patientId ? `Observation?subject=Patient/${patientId}` : '';

  useEffect(() => {
    // Reset per-patient state whenever the active call's patient changes.
    seenComm.current = new Set<string>();
    seenObs.current = new Set<string>();
    setLines([]);
    setObservations([]);

    if (!patientId) return;

    let cancelled = false;

    // 1. Human-readable charting feed (excluding artifact + call-log noise).
    medplum
      .searchResources('Communication', {
        subject: `Patient/${patientId}`,
        _sort: '-sent',
        _count: 50,
      })
      .then((results) => {
        if (cancelled) return;
        const mapped = results.filter((c) => !isFeedNoise(c)).map(communicationToChartLine);
        mapped.forEach((m) => seenComm.current.add(m.id));
        setLines(mapped);
      })
      .catch(() => {
        /* ignore — no feed yet */
      });

    // 2. Coded preliminary Observations.
    medplum
      .searchResources('Observation', {
        subject: `Patient/${patientId}`,
        _sort: '-date',
        _count: 50,
      })
      .then((results) => {
        if (cancelled) return;
        const mapped = results.map(observationToRow);
        mapped.forEach((m) => seenObs.current.add(m.id));
        setObservations(mapped);
      })
      .catch(() => {
        /* ignore — no observations yet */
      });

    return () => {
      cancelled = true;
    };
  }, [medplum, patientId]);

  // Live subscriptions — prepend new resources as they arrive (dedupe by id).
  useSubscription(commCriteria, (bundle) => {
    const entry = bundle.entry?.find((e) => e.resource?.resourceType === 'Communication');
    const resource = entry?.resource as Communication | undefined;
    if (!resource?.id || seenComm.current.has(resource.id) || isFeedNoise(resource)) return;
    seenComm.current.add(resource.id);
    setLines((prev) => [communicationToChartLine(resource), ...prev]);
  });

  useSubscription(obsCriteria, (bundle) => {
    const entry = bundle.entry?.find((e) => e.resource?.resourceType === 'Observation');
    const resource = entry?.resource as Observation | undefined;
    if (!resource?.id || seenObs.current.has(resource.id)) return;
    seenObs.current.add(resource.id);
    setObservations((prev) => [observationToRow(resource), ...prev]);
  });

  return { chartLines: lines, observations };
}
