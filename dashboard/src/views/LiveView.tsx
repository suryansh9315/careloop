/**
 * Live view — LIVE only. Watches the call log for an in-progress call and shows
 * that patient's clinical documentation being written in real time: the
 * human-readable charting feed and the coded preliminary Observations, both
 * streaming in via Medplum subscriptions as the bridge charts the call.
 */
import { useEffect, useState } from 'react';
import type { CallsState, CallRow } from '../useCalls';
import { useLiveData } from '../useLiveData';
import { usePatientNames } from '../usePatientNames';
import { MEDPLUM_APP_URL } from '../links';
import {
  ClockIcon,
  ExternalIcon,
  LiveIcon,
  BeakerIcon,
  RefreshIcon,
} from '../components/icons';
import { Avatar, Button, Card, EmptyState, PageHeader, Pill } from '../components/ui';
import { formatTime, formatRelative } from './format';

/** The most recent call row that is currently in progress, if any. */
function findActiveCall(rows: CallRow[]): CallRow | null {
  for (const r of rows) {
    if (r.status === 'in-progress') return r;
  }
  return null;
}

/** A ticking mm:ss elapsed clock counting up from an ISO start time. */
function useElapsed(startedAt: string | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!startedAt) return '0:00';
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '0:00';
  const sec = Math.max(0, Math.floor((now - start) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LiveView({ calls }: { calls: CallsState }) {
  const { rows, loading, error, refresh } = calls;
  const active = findActiveCall(rows);
  const patientId = active?.patientId ?? null;

  // Rules of Hooks: resolve the id first, then ALWAYS call the hooks. A null id
  // yields empty feeds and a harmless (empty-criteria) subscription.
  const names = usePatientNames([patientId, ...rows.map((r) => r.patientId)]);
  const { chartLines, observations } = useLiveData(patientId);
  const elapsed = useElapsed(active?.started);

  const patientName = (patientId && names[patientId]) || 'Patient';
  const condition = active?.treatment && active.treatment !== '—' ? active.treatment : null;

  if (!active) {
    const recent = rows.filter((r) => r.status === 'completed').slice(0, 5);
    return (
      <div className="page">
        <PageHeader
          title="Live"
          subtitle="Watch clinical documentation stream in as a call is charted."
          action={
            <Button variant="secondary" onClick={refresh} disabled={loading}>
              <RefreshIcon size={15} />
              Refresh
            </Button>
          }
        />
        {error && <div className="alert error">{error}</div>}
        <Card>
          <EmptyState
            icon={<LiveIcon size={22} />}
            title="No live call in progress"
            message="Start a call from New intake and watch it chart here in real time."
          />
          {recent.length > 0 && (
            <div className="live-recent">
              <div className="ui-section-label">Recently completed</div>
              {recent.map((r) => {
                const name = (r.patientId && names[r.patientId]) || 'Patient';
                return (
                  <div key={r.id} className="live-recent-row">
                    <Avatar name={name} size={30} />
                    <div className="live-recent-text">
                      <span className="live-recent-name">{name}</span>
                      <span className="live-recent-sub">{formatRelative(r.started)}</span>
                    </div>
                    {r.patientId ? (
                      <a
                        className="btn-link icon"
                        href={`${MEDPLUM_APP_URL}/Patient/${r.patientId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalIcon size={14} />
                        Medplum
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      {error && <div className="alert error">{error}</div>}

      <div className="live-hero">
        <Avatar name={patientName} size={52} />
        <div className="live-hero-text">
          <div className="live-hero-title">
            <h1>{patientName}</h1>
            <span className="live-badge">
              <span className="live-dot" />
              LIVE
            </span>
          </div>
          <p className="live-hero-sub">
            {condition ? <span className="cap">{condition}</span> : 'Check-in call'} · charting in
            real time
          </p>
        </div>
        <div className="live-hero-timer">
          <ClockIcon size={16} />
          <span className="mono">{elapsed}</span>
        </div>
      </div>

      <div className="two-col">
        <Card
          title={
            <>
              <span className="live-dot" />
              Charting
            </>
          }
          subtitle="Human-readable notes as the call progresses."
          right={<span className="count-chip">{chartLines.length}</span>}
        >
          <div className="feed">
            {chartLines.map((l) => (
              <div key={l.id} className={`feed-line ${l.kind}`}>
                <span className="feed-dot" />
                <div className="time">{formatTime(l.at)}</div>
                <div className="body">
                  <span className={`kind-chip ${l.kind}`}>{l.kind}</span>
                  {l.text}
                </div>
              </div>
            ))}
            {chartLines.length === 0 && <p className="hint">Waiting for charting activity…</p>}
          </div>
        </Card>

        <Card
          icon={<BeakerIcon size={18} />}
          title="Coded observations"
          subtitle="LOINC-coded values charted live."
          right={<span className="count-chip">{observations.length}</span>}
        >
          <div className="obs-list">
            {observations.map((o) => (
              <div key={o.id} className="obs-row">
                <span className="obs-label">{o.label}</span>
                {o.value !== null ? (
                  <Pill tone="blue">{o.value}</Pill>
                ) : (
                  <span className="muted">—</span>
                )}
                <span className="obs-time mono">{formatTime(o.at)}</span>
              </div>
            ))}
            {observations.length === 0 && <p className="hint">Waiting for coded values…</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
