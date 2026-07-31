import { useMemo, useState, type ReactNode } from 'react';
import type { ReviewQueueRow, ReviewQueueState } from '../useReviewQueue';
import { usePatientNames } from '../usePatientNames';
import { CONSENSUS_LABEL, CONSENSUS_TONE } from '../clinicalDisplay';
import { QueueInsightsPanel } from '../components/QueueInsightsPanel';
import { PlanPreviewModal } from '../components/PlanPreviewModal';
import { BandMeter, ScoreSparkline, scaleForModule } from '../components/charts';
import {
  ArrowRightIcon,
  BeakerIcon,
  InboxIcon,
  PulseIcon,
  RefreshIcon,
  ShieldIcon,
} from '../components/icons';
import { Avatar, Button, Card, EmptyState, PageHeader, Pill, StatCard, type Tone } from '../components/ui';
import { formatRelative } from './format';

import { triageQueueRow, type Triage, type TriageLevel } from '../reviewQueueEnrich';

type QueueFilter = 'all' | 'critical' | 'urgent' | 'routine';
type QueueSort = 'triage' | 'newest' | 'oldest';

const LEVEL_TONE: Record<TriageLevel, Tone> = {
  critical: 'red',
  urgent: 'amber',
  routine: 'gray',
};

const LEVEL_LABEL: Record<TriageLevel, string> = {
  critical: 'Critical',
  urgent: 'Urgent',
  routine: 'Routine',
};

/**
 * Review queue — a triage worklist. It leads with who needs the clinician
 * most, shows why in plain text, and opens a quick-look preview per plan
 * (rather than a full navigation) so the clinician can decide fast.
 */
export function ReviewQueueView({
  queue,
  onOpenReview,
}: {
  queue: ReviewQueueState;
  onOpenReview: (carePlanId: string) => void;
}) {
  const { rows, loading, error, refresh } = queue;
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [sort, setSort] = useState<QueueSort>('triage');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const names = usePatientNames(rows.map((r) => r.patientId));

  const triaged = useMemo(
    () => rows.map((r) => ({ row: r, triage: triageQueueRow(r) })),
    [rows],
  );

  const counts = useMemo(() => {
    const c: Record<TriageLevel, number> = { critical: 0, urgent: 0, routine: 0 };
    for (const { triage } of triaged) c[triage.level]++;
    return c;
  }, [triaged]);

  const filtered = useMemo(() => {
    const base = filter === 'all' ? triaged : triaged.filter((t) => t.triage.level === filter);
    const sorted = [...base];
    if (sort === 'triage') {
      sorted.sort((a, b) => a.triage.rank - b.triage.rank);
    } else if (sort === 'newest') {
      sorted.sort((a, b) => (Date.parse(b.row.created) || 0) - (Date.parse(a.row.created) || 0));
    } else {
      sorted.sort((a, b) => (Date.parse(a.row.created) || 0) - (Date.parse(b.row.created) || 0));
    }
    return sorted;
  }, [triaged, filter, sort]);

  const previewEntry = previewId ? triaged.find((t) => t.row.carePlanId === previewId) ?? null : null;
  const previewName =
    (previewEntry?.row.patientId && names[previewEntry.row.patientId]) || 'Resolving…';

  return (
    <div className="page review-queue-page">
      <PageHeader
        title="Review queue"
        subtitle={
          loading && rows.length === 0
            ? 'Loading draft care plans and intake visuals…'
            : `${rows.length} voice-charted draft plan${rows.length === 1 ? '' : 's'} ready for clinician sign-off — sorted by who needs you most.`
        }
        action={
          <Button variant="secondary" onClick={refresh} disabled={loading}>
            <RefreshIcon size={15} />
            Refresh
          </Button>
        }
      />

      {error && <div className="alert error">{error}</div>}

      <div className={loading && rows.length > 0 ? 'queue-loading-frame' : ''}>
        {rows.length > 0 && (
          <section className="stat-row queue-stat-row">
            <StatCard
              icon={<InboxIcon size={19} />}
              tone="accent"
              value={rows.length}
              label="Awaiting review"
              hint="draft care plans"
              onClick={() => setFilter('all')}
            />
            <StatCard
              icon={<ShieldIcon size={19} />}
              tone={counts.critical > 0 ? 'red' : 'green'}
              value={counts.critical}
              label="Critical"
              hint="safety or risk flags"
              onClick={() => setFilter('critical')}
            />
            <StatCard
              icon={<PulseIcon size={19} />}
              tone={counts.urgent > 0 ? 'amber' : 'green'}
              value={counts.urgent}
              label="Urgent"
              hint="off-target score or revise"
              onClick={() => setFilter('urgent')}
            />
            <StatCard
              icon={<BeakerIcon size={19} />}
              tone="blue"
              value={counts.routine}
              label="Routine"
              hint="coverage or intake pending"
              onClick={() => setFilter('routine')}
            />
          </section>
        )}

        {rows.length > 0 && <QueueInsightsPanel rows={rows} names={names} />}

        {rows.length > 0 && (
          <div className="queue-toolbar">
            <div className="queue-toolbar-group">
              <span className="queue-toolbar-label">Show</span>
              {(
                [
                  ['all', `All (${rows.length})`],
                  ['critical', `Critical (${counts.critical})`],
                  ['urgent', `Urgent (${counts.urgent})`],
                  ['routine', `Routine (${counts.routine})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`queue-filter-chip ${filter === key ? 'active' : ''}`}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="queue-toolbar-group">
              <label className="queue-toolbar-label" htmlFor="queue-sort">
                Sort
              </label>
              <select
                id="queue-sort"
                className="queue-sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as QueueSort)}
              >
                <option value="triage">Most urgent first</option>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <Card flush>
            <EmptyState
              icon={<InboxIcon size={22} />}
              title={loading ? 'Loading…' : 'Queue is clear'}
              message={
                !loading && !error ? 'No draft care plans need review right now.' : undefined
              }
            />
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ShieldIcon size={22} />}
              title="No plans in this filter"
              message="Try “All” to see every draft plan in the queue."
            />
          </Card>
        ) : (
          <div className="queue-card-grid">
            {filtered.map(({ row, triage }) => (
              <QueuePlanCard
                key={row.carePlanId}
                row={row}
                triage={triage}
                name={(row.patientId && names[row.patientId]) || 'Resolving…'}
                onOpen={() => setPreviewId(row.carePlanId)}
              />
            ))}
          </div>
        )}
      </div>

      <PlanPreviewModal
        row={previewEntry?.row ?? null}
        triage={previewEntry?.triage ?? null}
        name={previewName}
        onClose={() => setPreviewId(null)}
        onOpenReview={(carePlanId) => {
          setPreviewId(null);
          onOpenReview(carePlanId);
        }}
      />
    </div>
  );
}

function QueuePlanCard({
  row,
  triage,
  name,
  onOpen,
}: {
  row: ReviewQueueRow;
  triage: Triage;
  name: string;
  onOpen: () => void;
}) {
  const moduleId = row.conditionModuleId ?? '';
  const scale = scaleForModule(moduleId);
  const points =
    row.priorScores && row.scoreTotal != null
      ? [...row.priorScores.map((s) => ({ date: s.date, total: s.total })), { date: 'today', total: row.scoreTotal }]
      : row.scoreTotal != null
        ? [{ date: 'today', total: row.scoreTotal }]
        : [];

  return (
    <article
      className={`queue-plan-card level-${triage.level}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="queue-plan-head">
        <Avatar name={name} size={40} />
        <div className="queue-plan-ident">
          <h3 className="queue-plan-name">{name}</h3>
          <p className="queue-plan-meta">
            {row.conditionDisplay ?? row.treatment}
            {row.conditionCode && (
              <>
                {' '}
                <code>ICD-10 {row.conditionCode}</code>
              </>
            )}
          </p>
        </div>
        <Pill tone={LEVEL_TONE[triage.level]} className="queue-level-pill">
          {LEVEL_LABEL[triage.level]}
        </Pill>
      </div>

      {triage.reasons.length > 0 && (
        <ul className="queue-triage-reasons">
          {triage.reasons.slice(0, 2).map((r) => (
            <li key={r.code}>{r.label}</li>
          ))}
          {triage.reasons.length > 2 && <li className="hint">+{triage.reasons.length - 2} more</li>}
        </ul>
      )}

      <div className="queue-plan-score-area">
        {row.scoreTotal != null ? (
          <>
            <BandMeter scale={scale} total={row.scoreTotal} />
            {points.length > 0 && (
              <div className="queue-plan-chart">
                <div className="queue-chart-caption">
                  <PulseIcon size={13} />
                  {scale.instrument} over time
                </div>
                <ScoreSparkline points={points} scale={scale} width={300} />
              </div>
            )}
          </>
        ) : (
          <p className="hint queue-no-score">No score on file yet.</p>
        )}
      </div>

      <div className="queue-plan-kpis">
        <QueueKpi
          label="Medication"
          value={row.medication !== '—' ? row.medication : `${row.medicationCount ?? 0} in plan`}
        />
        {row.peerTotal != null && row.peerTotal > 0 && (
          <QueueKpi
            label="Experts"
            value={`${row.peerAgree ?? 0}/${row.peerTotal} agree`}
          />
        )}
        {row.copayUsd != null && (
          <QueueKpi
            label="Est. copay"
            value={
              <>
                ${row.copayUsd}
                {row.covered === false && <span className="queue-kpi-warn"> · check coverage</span>}
                {row.priorAuthRequired && <span className="queue-kpi-warn"> · PA</span>}
              </>
            }
          />
        )}
        {row.peerConsensus && (
          <QueueKpi
            label="Consensus"
            value={
              <Pill tone={CONSENSUS_TONE[row.peerConsensus] ?? 'gray'} className="queue-kpi-pill">
                {CONSENSUS_LABEL[row.peerConsensus] ?? row.peerConsensus}
              </Pill>
            }
          />
        )}
      </div>

      {row.patientSummary && (
        <p className="queue-plan-recap">
          <span className="recap-quote">“</span>
          {row.patientSummary.length > 140 ? `${row.patientSummary.slice(0, 137)}…` : row.patientSummary}
        </p>
      )}

      <div className="queue-plan-foot">
        <span className="muted">{formatRelative(row.created)}</span>
        <span className="row-open-btn">
          Preview <ArrowRightIcon size={13} />
        </span>
      </div>

      {!row.hasArtifact && (
        <p className="queue-plan-hint hint">No intake artifact yet — open after the voice check-in completes.</p>
      )}
    </article>
  );
}

function QueueKpi({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="queue-kpi">
      <span className="queue-kpi-label">{label}</span>
      <span className="queue-kpi-value">{value}</span>
    </div>
  );
}
