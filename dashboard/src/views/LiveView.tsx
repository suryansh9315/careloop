/**
 * Live view — LIVE only. Watches the call log for an in-progress call and shows
 * that patient's clinical documentation being written in real time: the
 * human-readable charting feed and the coded preliminary Observations, both
 * streaming in via Medplum subscriptions as the bridge charts the call.
 *
 * The centerpiece is the instrument tracker: as ACT / PHQ-9 item Observations
 * arrive one at a time, the clinician watches the score take shape against the
 * instrument's real clinical bands, rather than reading a flat text log.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CallsState, CallRow } from '../useCalls';
import { useLiveData, type LiveObservation } from '../useLiveData';
import { usePatientNames } from '../usePatientNames';
import { MEDPLUM_APP_URL } from '../links';
import {
  ClockIcon,
  ExternalIcon,
  LiveIcon,
  BeakerIcon,
  RefreshIcon,
  ShieldIcon,
  PulseIcon,
} from '../components/icons';
import { Avatar, Button, Card, EmptyState, PageHeader, Pill, type Tone } from '../components/ui';
import { BandMeter, scaleForModule } from '../components/charts';
import { instrumentMeta, itemSeverityLevel, type InstrumentItemMeta, type InstrumentMeta } from '../instrumentItems';
import { formatTime, formatRelative } from './format';

/**
 * The call to focus the Live view on: an in-progress call if there is one, else
 * the most recent call within the last 30 min — so its charting stays visible
 * right after it ends instead of the page going blank.
 */
function findActiveCall(rows: CallRow[]): CallRow | null {
  const inProgress = rows.find((r) => r.status === 'in-progress');
  if (inProgress) return inProgress;
  const recent = rows[0]; // rows are newest-first
  if (recent?.started && Date.now() - new Date(recent.started).getTime() < 30 * 60 * 1000) {
    return recent;
  }
  return null;
}

/**
 * A ticking elapsed clock counting up from an ISO start time — m:ss, rolling
 * over to h:mm:ss past an hour. Minutes were previously unbounded, so a call
 * left open (or a stale `in-progress` record that was never closed out, which
 * does happen) rendered as "707:00" rather than "11:47:00".
 */
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
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function LiveView({ calls }: { calls: CallsState }) {
  const { rows, loading, error, refresh } = calls;
  const active = findActiveCall(rows);
  const live = active?.status === 'in-progress';
  const patientId = active?.patientId ?? null;
  // CallRow.treatment carries the raw conditionId — i.e. the ConditionModule
  // id ('asthma', 'depression') — not a display label. Safe to feed straight
  // into scaleForModule / instrumentMeta.
  const moduleId = active?.treatment ?? '';

  // Rules of Hooks: resolve the id first, then ALWAYS call the hooks. A null id
  // yields empty feeds and a harmless (empty-criteria) subscription.
  const names = usePatientNames([patientId, ...rows.map((r) => r.patientId)]);
  // Scope the live feed to THIS call (charting since it started), so it isn't
  // buried under the patient's prior-call history / the 50-row fetch cap.
  const { chartLines, observations } = useLiveData(patientId, active?.started);
  const elapsed = useElapsed(active?.started);

  const patientName = (patientId && names[patientId]) || 'Patient';
  const meta = instrumentMeta(moduleId);
  const conditionLabel = meta?.longLabel ?? (active?.treatment && active.treatment !== '—' ? active.treatment : null);

  if (!active) {
    const recent = rows.filter((r) => r.status === 'completed').slice(0, 6);
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

        <Card className="wf-empty-live" flush>
          <EmptyState
            icon={<LiveIcon size={22} />}
            title="No live call in progress"
            message="Start a call from New intake and this page will chart it in real time — the transcript feed and the instrument score both fill in as the patient answers."
          />
        </Card>

        <Card
          title="Recently completed"
          subtitle={recent.length === 0 ? undefined : "Most recent check-in calls."}
        >
          {recent.length === 0 ? (
            <p className="hint">No completed calls yet.</p>
          ) : (
            <div className="live-recent">
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
            {live ? (
              <span className="live-badge">
                <span className="live-dot" />
                LIVE
              </span>
            ) : (
              <Pill tone="gray">Completed</Pill>
            )}
          </div>
          <p className="live-hero-sub">
            {/* `conditionLabel` resolves the instrument's full name (e.g. "Asthma
                Control Test") and falls back to the raw module id. The live vs
                just-completed distinction comes from main — the view now holds a
                finished call on screen for 30 min instead of going blank. */}
            {conditionLabel ? <span className="cap">{conditionLabel}</span> : 'Check-in call'} ·{' '}
            {live ? 'charting in real time' : `most recent call · ${formatRelative(active.started)}`}
          </p>
        </div>
        {live && (
          <div className="live-hero-timer">
            <ClockIcon size={16} />
            <span className="mono">{elapsed}</span>
          </div>
        )}
      </div>

      <div className="wf-live-grid">
        <Card
          title={
            <>
              <span className="live-dot" />
              Charting
            </>
          }
          subtitle="Human-readable notes as the call progresses. Newest first."
          right={<span className="count-chip">{chartLines.length}</span>}
          className="wf-live-feed-card"
        >
          <div className="feed" aria-live="polite" aria-relevant="additions" aria-label="Live charting feed">
            {chartLines.map((l) => (
              <div key={l.id} className={`feed-line ${l.kind}`}>
                <span className="feed-dot" />
                <div className="time">{formatTime(l.at)}</div>
                <div className="body">
                  <span className={`kind-chip ${l.kind}`}>{KIND_LABEL[l.kind] ?? l.kind}</span>
                  {l.text}
                </div>
              </div>
            ))}
            {chartLines.length === 0 && <p className="hint">Waiting for charting activity…</p>}
          </div>
        </Card>

        <div className="wf-live-side">
          <InstrumentTrackerCard moduleId={moduleId} meta={meta} observations={observations} />

          <Card
            icon={<BeakerIcon size={18} />}
            title="All coded observations"
            subtitle="Every LOINC-coded value charted live, in arrival order."
            right={<span className="count-chip">{observations.length}</span>}
          >
            <div className="obs-list" aria-live="polite" aria-relevant="additions" aria-label="Coded observations">
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
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  act: 'charted',
  concern: 'concern',
  qa: 'q&a',
  system: 'system',
};

// ── Instrument tracker: the score taking shape, live ────────────────────────

type ItemMatch = {
  item: InstrumentItemMeta;
  value: number | null;
  at: string | null;
  level: 'ok' | 'mild' | 'concern' | null;
  sentinelEndorsed: boolean;
};

/**
 * Best-effort match of a coded Observation's LOINC display label back to an
 * instrument item. Labels are free text from the LOINC panel, not linkIds, so
 * this matches defensively (linkId substring, then a fuzzy word match against
 * the item's short label) and simply leaves an item unmatched rather than
 * guessing wrong — an unmatched item just shows as "not yet charted".
 */
function matchItem(meta: InstrumentMeta, label: string): InstrumentItemMeta | null {
  const norm = label.toLowerCase();
  for (const item of meta.items) {
    if (norm.includes(item.linkId.toLowerCase())) return item;
  }
  for (const item of meta.items) {
    const words = item.short.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.length > 0 && words.every((w) => norm.includes(w))) return item;
  }
  return null;
}

function isTotalLabel(meta: InstrumentMeta, label: string): boolean {
  const norm = label.toLowerCase();
  const short = meta.label.toLowerCase();
  return norm.includes('total') || norm === short || norm.includes(`${short} score`);
}

function InstrumentTrackerCard({
  moduleId,
  meta,
  observations,
}: {
  moduleId: string;
  meta: InstrumentMeta | null;
  observations: LiveObservation[];
}) {
  const scale = scaleForModule(moduleId);

  const { itemRows, totalValue, totalAt, answeredCount, sentinelEndorsed } = useMemo(() => {
    if (!meta) {
      return { itemRows: [] as ItemMatch[], totalValue: null as number | null, totalAt: null as string | null, answeredCount: 0, sentinelEndorsed: false };
    }
    // observations arrive newest-first; keep the first (most recent) match per item.
    const byItem = new Map<string, LiveObservation>();
    let total: LiveObservation | null = null;
    for (const o of observations) {
      if (o.value === null) continue;
      if (!total && isTotalLabel(meta, o.label)) {
        total = o;
        continue;
      }
      const item = matchItem(meta, o.label);
      if (item && !byItem.has(item.linkId)) byItem.set(item.linkId, o);
    }
    const rows: ItemMatch[] = meta.items.map((item) => {
      const obs = byItem.get(item.linkId);
      if (!obs || obs.value === null) {
        return { item, value: null, at: null, level: null, sentinelEndorsed: false };
      }
      const sentinel = Boolean(item.sentinel) && obs.value > item.min;
      const level = sentinel ? 'concern' : itemSeverityLevel(item, obs.value, meta.higherIsBetter);
      return { item, value: obs.value, at: obs.at, level, sentinelEndorsed: sentinel };
    });
    const answered = rows.filter((r) => r.value !== null).length;
    const sentinel = rows.some((r) => r.sentinelEndorsed);
    return { itemRows: rows, totalValue: total?.value ?? null, totalAt: total?.at ?? null, answeredCount: answered, sentinelEndorsed: sentinel };
  }, [meta, observations]);

  const allAnswered = meta ? answeredCount === meta.items.length : false;
  const provisionalTotal =
    totalValue ?? (allAnswered ? itemRows.reduce((sum, r) => sum + (r.value ?? 0), 0) : null);
  const isProvisional = totalValue === null && provisionalTotal !== null;

  return (
    <Card
      icon={<PulseIcon size={18} />}
      title={meta ? `${meta.label} — score taking shape` : 'Score tracker'}
      subtitle={meta ? meta.longLabel : 'Waiting to identify the instrument for this call.'}
      right={
        meta && (
          <span className="count-chip">
            {sentinelEndorsed ? 'self-harm flag' : `${answeredCount}/${meta.items.length} answered`}
          </span>
        )
      }
    >
      {!meta ? (
        <p className="hint">This condition module has no structured item breakdown.</p>
      ) : (
        <>
          {sentinelEndorsed && (
            <div className="wf-sentinel-banner">
              <ShieldIcon size={14} />
              Self-harm thoughts endorsed — review immediately
            </div>
          )}

          <div className="wf-tracker-meter">
            {provisionalTotal !== null ? (
              <>
                <BandMeter scale={scale} total={provisionalTotal} />
                {isProvisional && (
                  <p className="wf-tracker-note">
                    Provisional — computed from {answeredCount} of {meta.items.length} charted responses;
                    the coded total hasn't arrived yet.
                  </p>
                )}
                {!isProvisional && totalAt && (
                  <p className="wf-tracker-note">Total charted {formatTime(totalAt)}.</p>
                )}
              </>
            ) : (
              <div className="wf-tracker-empty">
                <div className="wf-tracker-empty-track" aria-hidden="true">
                  <span className="wf-tracker-empty-fill" />
                </div>
                <p className="hint">
                  {answeredCount === 0
                    ? 'Awaiting the first item response…'
                    : `${answeredCount} of ${meta.items.length} items charted so far.`}
                </p>
              </div>
            )}
          </div>

          <ul className="wf-item-list" aria-live="polite" aria-relevant="additions text" aria-label={`${meta.label} item responses`}>
            {itemRows.map((row) => (
              <TrackerItemRow key={row.item.linkId} row={row} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

const LEVEL_TONE: Record<'ok' | 'mild' | 'concern', Tone> = {
  ok: 'green',
  mild: 'amber',
  concern: 'red',
};

const LEVEL_LABEL: Record<'ok' | 'mild' | 'concern', string> = {
  ok: 'Low',
  mild: 'Moderate',
  concern: 'High',
};

function TrackerItemRow({ row }: { row: ItemMatch }) {
  const { item, value, level, sentinelEndorsed } = row;
  const answered = value !== null && level !== null;
  const span = item.max - item.min || 1;
  const pct = answered ? ((Math.max(item.min, Math.min(item.max, value!)) - item.min) / span) * 100 : 0;

  return (
    <li className={`wf-item-row ${answered ? `level-${level}` : 'pending'} ${sentinelEndorsed ? 'sentinel' : ''}`}>
      <div className="wf-item-row-head">
        <span className="wf-item-name">{item.short}</span>
        {answered ? (
          <>
            <Pill tone={LEVEL_TONE[level!]} className="wf-item-value">
              {value} / {item.max}
            </Pill>
            <span className="wf-item-level">{LEVEL_LABEL[level!]}</span>
          </>
        ) : (
          <span className="wf-item-pending">Not yet charted</span>
        )}
      </div>
      <div className="wf-item-track" aria-hidden="true">
        {answered && <div className={`wf-item-fill tone-${level}`} style={{ width: `${pct}%` }} />}
      </div>
    </li>
  );
}
