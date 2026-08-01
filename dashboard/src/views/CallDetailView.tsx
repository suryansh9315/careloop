/**
 * Call detail — a read-only replay of one past call's clinical documentation:
 * the same charting feed and instrument-tracking picture the Live view gives
 * for an in-progress call, frozen for a call that has already ended.
 *
 * The window is bounded to just this call: `since` is its start, `until` is
 * the next call for the same patient (if any) — or, failing that, a generous
 * buffer past its own end — so a completed call never shows a later call's
 * transcript. See `useLiveData`'s `until` param.
 */
import { useMemo } from 'react';
import type { CallRow } from '../useCalls';
import { formatDuration } from '../useCalls';
import { useLiveData, type LiveObservation } from '../useLiveData';
import { MEDPLUM_APP_URL } from '../links';
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BeakerIcon,
  ClockIcon,
  ExternalIcon,
  PhoneIcon,
  PulseIcon,
  ShieldIcon,
  UsersIcon,
} from '../components/icons';
import { Avatar, Button, Card, EmptyState, Pill } from '../components/ui';
import { BandMeter, scaleForModule } from '../components/charts';
import { instrumentMeta, type InstrumentItemMeta, type InstrumentMeta } from '../instrumentItems';
import { STATUS_ICON, STATUS_LABEL, STATUS_TONE } from './CallsView';
import { formatDateTime, formatRelative, formatTime } from './format';

const KIND_LABEL: Record<string, string> = {
  act: 'charted',
  concern: 'concern',
  qa: 'q&a',
  system: 'system',
};

/**
 * Bound this call's charting window: `since` is when it started, `until` is
 * the next call for the same patient (whichever call started right after
 * this one) — that is the only fully reliable upper bound, since `CallRow`
 * doesn't carry an authoritative end timestamp. Falls back to `started +
 * durationSeconds` plus a buffer (post-call charting can land a little late)
 * when there is no later call to bound against; leaves `until` open when
 * neither is available (e.g. a call still `in-progress`).
 */
function callWindow(call: CallRow, calls: CallRow[]): { since: string; until: string | undefined } {
  const since = call.started;
  if (call.status === 'in-progress' || !since) {
    return { since, until: undefined };
  }
  const startMs = new Date(since).getTime();
  let nextStartMs: number | null = null;
  if (!Number.isNaN(startMs)) {
    for (const other of calls) {
      if (other.id === call.id || other.patientId !== call.patientId || !other.started) continue;
      const otherMs = new Date(other.started).getTime();
      if (Number.isNaN(otherMs) || otherMs <= startMs) continue;
      if (nextStartMs === null || otherMs < nextStartMs) nextStartMs = otherMs;
    }
  }
  /*
   * Take the TIGHTEST of the two bounds rather than preferring one.
   *
   * The next call's start is a hard ceiling — never cross into another call —
   * but on real data it is far too loose on its own: check-ins run seconds to a
   * couple of minutes, while the gap to the next call is often tens of minutes,
   * so anything charted in between would be swept into this call's transcript.
   * The call's own duration is the precise bound whenever it is recorded, and
   * the buffer only has to absorb clock skew plus the closing summary write —
   * a couple of minutes, not fifteen.
   */
  const BUFFER_MS = 2 * 60 * 1000;
  const bounds: number[] = [];
  if (nextStartMs !== null) bounds.push(nextStartMs);
  if (!Number.isNaN(startMs) && typeof call.durationSeconds === 'number') {
    bounds.push(startMs + call.durationSeconds * 1000 + BUFFER_MS);
  }
  if (bounds.length === 0) return { since, until: undefined };
  return { since, until: new Date(Math.min(...bounds)).toISOString() };
}

/** Best-effort match of a coded Observation's LOINC label back to an item. */
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

/** Was a complete instrument charted during this call, and if so, what score? */
function useCallScore(moduleId: string, observations: LiveObservation[]) {
  const meta = instrumentMeta(moduleId);
  return useMemo(() => {
    if (!meta) return { meta, total: null as number | null, answeredCount: 0, sentinelEndorsed: false };
    const byItem = new Map<string, LiveObservation>();
    let total: LiveObservation | null = null;
    // Observations arrive newest-first from useLiveData; keep the first match per item.
    for (const o of observations) {
      if (o.value === null) continue;
      if (!total && isTotalLabel(meta, o.label)) {
        total = o;
        continue;
      }
      const item = matchItem(meta, o.label);
      if (item && !byItem.has(item.linkId)) byItem.set(item.linkId, o);
    }
    let sentinelEndorsed = false;
    for (const item of meta.items) {
      const obs = byItem.get(item.linkId);
      if (obs && Boolean(item.sentinel) && obs.value !== null && obs.value > item.min) sentinelEndorsed = true;
    }
    const answeredCount = byItem.size;
    const allAnswered = answeredCount === meta.items.length;
    const derivedTotal = allAnswered
      ? meta.items.reduce((sum, item) => sum + (byItem.get(item.linkId)?.value ?? 0), 0)
      : null;
    return { meta, total: total?.value ?? derivedTotal, answeredCount, sentinelEndorsed };
  }, [meta, observations]);
}

export function CallDetailView({
  call,
  patientName,
  calls,
  carePlanId,
  onBack,
  onOpenReview,
}: {
  /** null when the call could not be found (e.g. the log refreshed underneath us). */
  call: CallRow | null;
  patientName: string | undefined;
  /** the full call log, used only to find the next call for this patient (the window's upper bound). */
  calls: CallRow[];
  /** the patient's newest draft CarePlan id, if one exists. */
  carePlanId?: string;
  onBack: () => void;
  onOpenReview: (carePlanId: string) => void;
}) {
  if (!call) {
    return (
      <div className="page">
        <div className="call-detail-back">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Back to calls
          </Button>
        </div>
        <Card flush>
          <EmptyState icon={<PhoneIcon size={22} />} title="Call not found" message="This call is no longer in the log." />
        </Card>
      </div>
    );
  }

  const { since, until } = callWindow(call, calls);
  const patientId = call.patientId;
  const name = patientName || (patientId ? 'Patient' : 'Unknown patient');
  // Rules of Hooks: patientId may be null, but the hook always runs — a null
  // id yields an empty, harmless (empty-criteria) feed.
  const { chartLines, observations } = useLiveData(patientId, since, until);
  const { meta, total, answeredCount, sentinelEndorsed } = useCallScore(call.treatment, observations);
  const scale = scaleForModule(call.treatment);
  const StatusIcon = call.status ? STATUS_ICON[call.status] : null;

  return (
    <div className="page">
      <div className="call-detail-back">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to calls
        </Button>
      </div>

      <div className="live-hero call-detail-hero">
        <Avatar name={name} size={52} />
        <div className="live-hero-text">
          <div className="live-hero-title">
            <h1>{name}</h1>
            <Pill tone="gray">Past call</Pill>
            {call.status && (
              <Pill tone={STATUS_TONE[call.status] ?? 'gray'}>
                {StatusIcon && <StatusIcon size={12} />}
                {STATUS_LABEL[call.status] ?? call.status}
              </Pill>
            )}
          </div>
          <p className="live-hero-sub">
            {call.direction && (
              <span className="dir-cell">
                {call.direction === 'inbound' ? <ArrowDownLeftIcon size={13} /> : <ArrowUpRightIcon size={13} />}
                {call.direction}
              </span>
            )}
            {call.direction && ' · '}
            {call.treatment && call.treatment !== '—' ? (
              <span className="cap">{meta?.longLabel ?? call.treatment}</span>
            ) : (
              'Check-in call'
            )}
            {' · '}
            {formatDateTime(call.started)} ({formatRelative(call.started)})
          </p>
        </div>
        <div className="live-hero-timer">
          <ClockIcon size={16} />
          <span className="mono">{formatDuration(call.durationSeconds)}</span>
        </div>
      </div>

      {patientId && carePlanId && (
        <div className="call-detail-plan-link">
          <Button variant="secondary" size="sm" onClick={() => onOpenReview(carePlanId)}>
            Open draft plan / review
          </Button>
        </div>
      )}
      {patientId && !carePlanId && (
        <div className="call-detail-plan-link">
          <a className="btn-link icon" href={`${MEDPLUM_APP_URL}/Patient/${patientId}`} target="_blank" rel="noreferrer">
            <ExternalIcon size={14} />
            View patient in Medplum
          </a>
        </div>
      )}

      {!patientId ? (
        <Card flush>
          <EmptyState
            icon={<UsersIcon size={22} />}
            title="Unknown patient"
            message="This call record isn't linked to a patient, so its clinical documentation can't be shown."
          />
        </Card>
      ) : (
        <div className="wf-live-grid">
          <Card
            title="Charting"
            subtitle="Human-readable notes from this call, oldest first."
            right={<span className="count-chip">{chartLines.length}</span>}
            className="wf-live-feed-card"
          >
            <div className="feed call-detail-feed" aria-label="Call charting feed">
              {[...chartLines].reverse().map((l) => (
                <div key={l.id} className={`feed-line ${l.kind}`}>
                  <span className="feed-dot" />
                  <div className="time">{formatTime(l.at)}</div>
                  <div className="body">
                    <span className={`kind-chip ${l.kind}`}>{KIND_LABEL[l.kind] ?? l.kind}</span>
                    {l.text}
                  </div>
                </div>
              ))}
              {chartLines.length === 0 && (
                <EmptyState
                  icon={<PhoneIcon size={20} />}
                  title="Nothing charted"
                  message="No charting notes were recorded for this call."
                />
              )}
            </div>
          </Card>

          <div className="wf-live-side">
            <Card
              icon={<PulseIcon size={18} />}
              title={meta ? `${meta.label} score` : 'Score'}
              subtitle={
                meta
                  ? total !== null
                    ? 'Instrument charted during this call.'
                    : `Incomplete — ${answeredCount} of ${meta.items.length} responses charted.`
                  : 'This condition module has no structured instrument.'
              }
            >
              {sentinelEndorsed && (
                <div className="wf-sentinel-banner">
                  <ShieldIcon size={14} />
                  Self-harm thoughts endorsed during this call
                </div>
              )}
              {meta && total !== null ? (
                <BandMeter scale={scale} total={total} />
              ) : (
                <p className="hint">
                  {meta
                    ? 'The instrument was not completed during this call, so no score is available.'
                    : 'No scored instrument applies to this call.'}
                </p>
              )}
            </Card>

            <Card
              icon={<BeakerIcon size={18} />}
              title="Coded observations"
              subtitle="Every LOINC-coded value charted during this call, in arrival order."
              right={<span className="count-chip">{observations.length}</span>}
            >
              <div className="obs-list" aria-label="Coded observations for this call">
                {[...observations].reverse().map((o) => (
                  <div key={o.id} className="obs-row">
                    <span className="obs-label">{o.label}</span>
                    {o.value !== null ? <Pill tone="blue">{o.value}</Pill> : <span className="muted">—</span>}
                    <span className="obs-time mono">{formatTime(o.at)}</span>
                  </div>
                ))}
                {observations.length === 0 && (
                  <EmptyState
                    icon={<BeakerIcon size={20} />}
                    title="Nothing charted"
                    message="No coded observations were recorded for this call."
                  />
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
