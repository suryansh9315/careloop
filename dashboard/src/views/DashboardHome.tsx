import type { ReviewQueueState } from '../useReviewQueue';
import type { CallsState, CallRow } from '../useCalls';
import type { PatientListState } from '../usePatientList';
import type { Page } from '../components/Sidebar';
import { usePatientNames } from '../usePatientNames';
import { triageQueueRow, queueRowTrendPoints, type TriageLevel } from '../reviewQueueEnrich';
import { BandMeter, DeltaBadge, SeverityBar, scaleForModule } from '../components/charts';
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

function triageTone(level: TriageLevel): Tone {
  return level === 'critical' ? 'red' : level === 'urgent' ? 'amber' : 'gray';
}

/**
 * A completed call either produced a draft plan still sitting in the queue,
 * or it didn't (already actioned, or intake never finished). We can't know
 * "already reviewed" for certain — the queue only lists drafts — so the
 * label stays honest about what we can observe.
 */
function callOutcome(row: CallRow, queueByPatient: Map<string, TriageLevel>): string | null {
  if (row.status && row.status !== 'completed') return null;
  if (!row.patientId) return null;
  const level = queueByPatient.get(row.patientId);
  if (!level) return 'no draft pending';
  return level === 'routine' ? 'plan awaiting review' : `plan awaiting review — ${level}`;
}

/**
 * Morning briefing — the clinician's landing page. Leads with a single,
 * directly actionable "do this first" case rather than a bare count, so the
 * page answers "what do I do first?" and not just "how many are waiting?".
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

  const worklist = [...triaged].sort((a, b) => a.triage.rank - b.triage.rank).slice(0, 5);
  const top = worklist[0];
  const recentCalls = calls.rows.slice(0, 5);
  const worklistNames = usePatientNames(worklist.map((t) => t.row.patientId));
  const callNames = usePatientNames(recentCalls.map((r) => r.patientId));

  // Worst (most urgent) triage level per patient, for the "recent calls"
  // outcome line — a patient can have more than one draft plan.
  const worstLevelByPatient = new Map<string, TriageLevel>();
  for (const { row, triage } of triaged) {
    if (!row.patientId) continue;
    const current = worstLevelByPatient.get(row.patientId);
    if (!current || LEVEL_WEIGHT[triage.level] < LEVEL_WEIGHT[current]) {
      worstLevelByPatient.set(row.patientId, triage.level);
    }
  }

  const topName = top ? (top.row.patientId && worklistNames[top.row.patientId]) || 'Resolving…' : null;
  const topScale = top?.row.conditionModuleId ? scaleForModule(top.row.conditionModuleId) : null;
  const topPoints = top ? queueRowTrendPoints(top.row) : [];
  const topTone: Tone = !top ? 'green' : triageTone(top.triage.level);

  const rest = worklist.slice(1);

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
          <section className={`ov-top-pick ov-tone-${topTone}`} aria-label="Do this first">
            <div className="ov-top-pick-head">
              <span className="ov-top-pick-eyebrow">
                <ShieldIcon size={14} />
                Do this first
              </span>
              {top && <Pill tone={triageTone(top.triage.level)}>{top.triage.level}</Pill>}
            </div>

            {!top ? (
              <EmptyState
                icon={<CheckCircleIcon size={22} />}
                title={queue.loading ? 'Loading…' : 'All caught up'}
                message={!queue.loading && !queue.error ? 'No draft plans need attention right now.' : undefined}
              />
            ) : (
              <>
                <div className="ov-top-pick-patient">
                  <Avatar name={topName ?? undefined} size={44} />
                  <div className="ov-top-pick-patient-text">
                    <span className="ov-top-pick-name">{topName}</span>
                    <span className="ov-top-pick-sub">{top.row.conditionDisplay ?? top.row.treatment}</span>
                  </div>
                </div>

                {top.triage.reasons.length > 0 && (
                  <ul className="ov-top-pick-reasons">
                    {top.triage.reasons.slice(0, 3).map((r) => (
                      <li key={r.code}>{r.label}</li>
                    ))}
                  </ul>
                )}

                {topScale && top.row.scoreTotal != null && (
                  <div className="ov-top-pick-evidence">
                    <BandMeter scale={topScale} total={top.row.scoreTotal} />
                    {topPoints.length > 1 && <DeltaBadge points={topPoints} scale={topScale} />}
                  </div>
                )}

                <div className="ov-top-pick-actions">
                  <Button variant="primary" onClick={() => onOpenReview(top.row.carePlanId)}>
                    Review now
                  </Button>
                  <button className="btn-link" onClick={() => onNavigate('review-queue')}>
                    See full queue ({queue.rows.length})
                  </button>
                </div>
              </>
            )}
          </section>

          <div className="ov-side-col">
            <Card
              title="Queue mix"
              subtitle="by urgency"
              right={
                <button className="btn-link" onClick={() => onNavigate('review-queue')}>
                  View all
                </button>
              }
            >
              {queue.rows.length === 0 ? (
                <p className="hint">{queue.loading ? 'Loading…' : 'Nothing in the queue.'}</p>
              ) : (
                <SeverityBar
                  segments={[
                    { key: 'critical', label: 'Critical', count: counts.critical, tone: 'red' },
                    { key: 'urgent', label: 'Urgent', count: counts.urgent, tone: 'amber' },
                    { key: 'routine', label: 'Routine', count: counts.routine, tone: 'gray' },
                  ]}
                />
              )}
            </Card>
            <div className="ov-side-stats">
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
          </div>
        </section>

        <div className="two-col">
          <Card
            title="Also waiting"
            subtitle="Next most urgent"
            right={
              <button className="btn-link" onClick={() => onNavigate('review-queue')}>
                View all
              </button>
            }
          >
            {rest.length === 0 ? (
              <EmptyState
                icon={<InboxIcon size={20} />}
                title={queue.loading ? 'Loading…' : top ? 'Nothing else pending' : 'Nothing to review'}
                message={!queue.loading && !queue.error && !top ? 'No draft plans need attention right now.' : undefined}
              />
            ) : (
              <div className="activity-list">
                {rest.map(({ row, triage }) => {
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
                        <Pill tone={triageTone(triage.level)}>{triage.level}</Pill>
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
                  const outcome = callOutcome(r, worstLevelByPatient);
                  return (
                    <div key={r.id} className="activity-row static">
                      <Avatar name={name} size={34} />
                      <div className="activity-main">
                        <span className="activity-title">{name}</span>
                        <span className="activity-sub cap">
                          {r.direction ?? 'call'}
                          {outcome ? ` · ${outcome}` : ''}
                        </span>
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

const LEVEL_WEIGHT: Record<TriageLevel, number> = { critical: 0, urgent: 1, routine: 2 };
