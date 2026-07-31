/**
 * Call-log hook — LIVE only. Lists call-log Communications (category
 * `careloop-call`), whose payload[0].contentString is a JSON call record.
 */
import { useCallback, useEffect, useState } from 'react';
import { useMedplum } from '@medplum/react-hooks';
import type { Communication } from '@medplum/fhirtypes';
import { CALL_CATEGORY } from './medplum';
import { patientRefId } from './usePatientNames';

export type CallDirection = 'outbound' | 'inbound';
export type CallStatus =
  | 'initiated'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'no-answer';

export type CallRecord = {
  callSid?: string;
  patientId?: string;
  conditionId?: string;
  direction?: CallDirection;
  status?: CallStatus;
  to?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
};

export type CallRow = {
  id: string;
  /** resolved from subject reference, else from the record body */
  patientId: string | null;
  treatment: string;
  direction?: CallDirection;
  status?: CallStatus;
  /** ISO — startedAt or the Communication's sent time */
  started: string;
  durationSeconds?: number;
};

export type CallsState = {
  rows: CallRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

function toRow(c: Communication): CallRow {
  let rec: CallRecord = {};
  const raw = c.payload?.find((p) => p.contentString)?.contentString;
  if (raw) {
    try {
      rec = JSON.parse(raw) as CallRecord;
    } catch {
      /* malformed record — leave empty */
    }
  }
  const patientId = patientRefId(c.subject?.reference) ?? rec.patientId ?? null;
  return {
    id: c.id ?? Math.random().toString(36).slice(2),
    patientId,
    treatment: rec.conditionId ?? '—',
    direction: rec.direction,
    status: rec.status,
    started: rec.startedAt ?? c.sent ?? c.meta?.lastUpdated ?? '',
    durationSeconds: rec.durationSeconds,
  };
}

export function useCalls(): CallsState {
  const medplum = useMedplum();
  const [rows, setRows] = useState<CallRow[]>([]);
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
        .searchResources(
          'Communication',
          { category: CALL_CATEGORY, _sort: '-sent', _count: 50 },
          { cache: 'reload' }, // fresh each poll so in-progress status changes show live
        )
        .then((results) => {
          if (cancelled) return;
          setRows(results.map(toRow));
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
    // Poll fast so an in-progress call (and its status changes) is picked up
    // quickly — the call log is written by the bridge, which we can't see push.
    const timer = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [medplum, nonce]);

  return { rows, loading, error, refresh };
}

/** Format a duration in seconds as "Xm Ys" / "Ys", or "—". */
export function formatDuration(sec: number | undefined): string {
  if (typeof sec !== 'number' || Number.isNaN(sec) || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
