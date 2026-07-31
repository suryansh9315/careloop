import type { ReviewQueueState } from '../useReviewQueue';
import type { CallsState } from '../useCalls';
import type { PatientListState } from '../usePatientList';
import type { Page } from '../components/Sidebar';
import { usePatientNames } from '../usePatientNames';
import { triageQueueRow, type TriageLevel } from '../reviewQueueEnrich';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  InboxIcon,
  PhoneIcon,
  PulseIcon,
  ShieldIcon,
  UsersIcon,
} from '../components/icons';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Pill,
  StatCard,
  type Tone,
} from '../components/ui';
import { formatRelative } from './format';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function isToday(iso: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

const CALL_STATUS_ICON: Record<string, (p: { size?: number }) => JSX.Element> = {
  completed: CheckCircleIcon,
  'in-progress': PulseIcon,
  initiated: ClockIcon,
  failed: ShieldIcon,
  'no-answer': ClockIcon,
};

const CALL_TONE: Record<string, Tone> = {
  completed: 'green',
  'in-progress': 'blue',
  initiated: 'blue',
  failed: 'red',
  'no-answer': 'gray',
};

/**
 * Morning briefing — the clinician's landing page. Leads with triage (who
 * needs attention right now, and why), not a wall of equal-weight counters.
 * A single hero figure anchors the page per the design brief; everything
 * else is secondary context.
 */
export function DashboardHome({
  queue,
  calls,
  patients,
  onNavigate,
  onOpenReview,
}: {
  queue: ReviewQueueState;
  calls: CallsState;
  patients: PatientListState;
  onNavigate: (p: Page) => void;
  onOpenReview: (carePlanId: string) => void;
}) {
  const callsToday = calls.rows.filter((c) => isToday(c.started)).length;

  const triaged = queue.rows.map((r) => ({ row: r, triage: triageQueueRow(r) }));
  const counts: Record<TriageLevel, number> = { critical: 0, urgent: 0, routine: 0 };
  for (const { triage } of triaged) counts[triage.level]++;
  const needsAttention = counts.critical + counts.urgent;

  const worklist = [...triaged].sort((a, b) => a.triage.rank - b.triage.rank).slice(0, 5);
  const recentCalls = calls.rows.slice(0, 5);
  const worklistNames = usePatientNames(worklist.map((t) => t.row.patientId));
  const callNames = usePatientNames(recentCalls.map((r) => r.patientId));

  const heroTone: Tone = counts.critical > 0 ? 'red' : counts.urgent > 0 ? 'amber' : 'green';
  const heroLoading = queue.loading && queue.rows.length === 0;

  return (
    <div className="page">
      <PageHeader
        title={greeting()}
        subtitle={
          queue.loading && queue.rows.length === 0
            ? 'Loading your worklist…'
            : `${queue.rows.length} draft plan${queue.rows.length === 1 ? '' : 's'} awaiting review.`
        }
        action={
          <Button variant="primary" onClick={() => onNavigate('intake')}>
            New intake
          </Button>
        }
      />

      {queue.error && <div className="alert error">{queue.error}</div>}

      <div className={queue.loading && queue.rows.length > 0 ? 'queue-loading-frame' : ''}>
        <section className="ov-hero-row">
          <button
            type="button"
            className={`ov-hero ov-tone-${heroTone}`}
            onClick={() => onNavigate('review-queue')}
          >
            <span className="ov-hero-icon">
              <ShieldIcon size={22} />
            </span>
            <span className="ov-hero-value">{heroLoading ? '—' : needsAttention}</span>
            <span className="ov-hero-label">
              {needsAttention === 1 ? 'patient needs' : 'patients need'} your attention now
            </span>
            {/*
             * Proportional triage mix. The chips below already carry the exact
             * counts as text, so this is aria-hidden — it exists to show the
             * *share* of the queue that is urgent at a glance, which the counts
             * alone don't convey. Presentational spans only: the hero is a
             * <button>, so nothing in here may be interactive.
             */}
            {queue.rows.length > 0 && (
              <span className="ov-hero-mix" aria-hidden="true">
                {counts.critical > 0 && (
                  <span className="ov-hero-mix-seg seg-critical" style={{ flex: counts.critical }} />
                )}
                {counts.urgent > 0 && (
                  <span className="ov-hero-mix-seg seg-urgent" style={{ flex: counts.urgent }} />
                )}
                {counts.routine > 0 && (
                  <span className="ov-hero-mix-seg seg-routine" style={{ flex: counts.routine }} />
                )}
              </span>
            )}
            <span className="ov-hero-breakdown">
              <span className="ov-hero-chip ov-tone-red">{counts.critical} critical</span>
              <span className="ov-hero-chip ov-tone-amber">{counts.urgent} urgent</span>
              <span className="ov-hero-chip ov-tone-gray">{counts.routine} routine</span>
            </span>
          </button>

          <div className="ov-side-stats">
            <StatCard
              icon={<InboxIcon size={18} />}
              tone="accent"
              value={queue.rows.length}
              label="Draft plans"
              hint="in the queue"
              onClick={() => onNavigate('review-queue')}
            />
            <StatCard
              icon={<PhoneIcon size={18} />}
              tone="blue"
              value={callsToday}
              label="Calls today"
              hint={`${calls.rows.length} total`}
              onClick={() => onNavigate('calls')}
            />
            <StatCard
              icon={<UsersIcon size={18} />}
              tone="green"
              value={patients.patients.length}
              label="Patients"
              hint="in your workspace"
              onClick={() => onNavigate('patients')}
            />
          </div>
        </section>

        <div className="two-col">
          <Card
            title="Needs your attention"
            subtitle="Most urgent first"
            right={
              <button className="btn-link" onClick={() => onNavigate('review-queue')}>
                View all
              </button>
            }
          >
            {worklist.length === 0 ? (
              <EmptyState
                icon={<InboxIcon size={20} />}
                title={queue.loading ? 'Loading…' : 'Nothing to review'}
                message={!queue.loading && !queue.error ? 'No draft plans need attention right now.' : undefined}
              />
            ) : (
              <div className="activity-list">
                {worklist.map(({ row, triage }) => {
                  const name = (row.patientId && worklistNames[row.patientId]) || 'Resolving…';
                  const topReason = triage.reasons[0]?.label;
                  return (
                    <button
                      key={row.carePlanId}
                      className="activity-row"
                      onClick={() => onOpenReview(row.carePlanId)}
                    >
                      <Avatar name={name} size={34} />
                      <div className="activity-main">
                        <span className="activity-title">{name}</span>
                        <span className="activity-sub">
                          {topReason ?? `${row.conditionDisplay ?? row.treatment}`}
                        </span>
                      </div>
                      <div className="activity-meta">
                        <Pill tone={triage.level === 'critical' ? 'red' : triage.level === 'urgent' ? 'amber' : 'gray'}>
                          {triage.level}
                        </Pill>
                        <ArrowRightIcon size={15} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card
            title="Recent calls"
            right={
              <button className="btn-link" onClick={() => onNavigate('calls')}>
                View all
              </button>
            }
          >
            {recentCalls.length === 0 ? (
              <p className="hint">{calls.loading ? 'Loading…' : 'No calls yet.'}</p>
            ) : (
              <div className="activity-list">
                {recentCalls.map((r) => {
                  const name = (r.patientId && callNames[r.patientId]) || 'Unknown';
                  const Icon = (r.status && CALL_STATUS_ICON[r.status]) || ClockIcon;
                  return (
                    <div key={r.id} className="activity-row static">
                      <Avatar name={name} size={34} />
                      <div className="activity-main">
                        <span className="activity-title">{name}</span>
                        <span className="activity-sub cap">{r.direction ?? 'call'}</span>
                      </div>
                      <div className="activity-meta">
                        {r.status && (
                          <Pill tone={CALL_TONE[r.status] ?? 'gray'}>
                            <Icon size={12} />
                            {r.status.replace(/-/g, ' ')}
                          </Pill>
                        )}
                        <span>{formatRelative(r.started)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
