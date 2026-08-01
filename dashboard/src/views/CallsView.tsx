import { useMemo } from 'react';
import { formatDuration, type CallRow, type CallsState, type CallStatus } from '../useCalls';
import type { ReviewQueueState } from '../useReviewQueue';
import { usePatientNames } from '../usePatientNames';
import { MEDPLUM_APP_URL } from '../links';
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  ClockIcon,
  ExternalIcon,
  PhoneIcon,
  PulseIcon,
  RefreshIcon,
  ShieldIcon,
} from '../components/icons';
import { Button, Card, EmptyState, PageHeader, Pill, PersonCell, StatCard, Table, type Tone } from '../components/ui';
import { formatRelative } from './format';

// Exported so CallDetailView's header can render the same status treatment.
export const STATUS_TONE: Record<CallStatus, Tone> = {
  completed: 'green',
  'in-progress': 'blue',
  initiated: 'blue',
  failed: 'red',
  'no-answer': 'gray',
};

export const STATUS_ICON: Record<CallStatus, (p: { size?: number }) => JSX.Element> = {
  completed: CheckCircleIcon,
  'in-progress': PulseIcon,
  initiated: ClockIcon,
  failed: ShieldIcon,
  'no-answer': ClockIcon,
};

export const STATUS_LABEL: Record<CallStatus, string> = {
  completed: 'Completed',
  'in-progress': 'In progress',
  initiated: 'Dialing',
  failed: 'Failed',
  'no-answer': 'No answer',
};

/**
 * Calls page — the outbound/inbound call log. Newest first. A row opens the
 * patient's draft plan in Review if one exists, else links out to Medplum.
 */
export function CallsView({
  calls,
  queue,
  onOpenReview,
  onOpenCall,
}: {
  calls: CallsState;
  queue: ReviewQueueState;
  onOpenReview: (carePlanId: string) => void;
  onOpenCall: (call: CallRow) => void;
}) {
  const { rows, loading, error, refresh } = calls;
  const names = usePatientNames(rows.map((r) => r.patientId));

  // Map patient → their newest draft CarePlan, so a call row can jump to review.
  const planByPatient = new Map<string, string>();
  for (const q of queue.rows) {
    if (q.patientId && !planByPatient.has(q.patientId)) planByPatient.set(q.patientId, q.carePlanId);
  }

  const stats = useMemo(() => {
    const completed = rows.filter((r) => r.status === 'completed').length;
    const totalDuration = rows.reduce((s, r) => s + (r.durationSeconds ?? 0), 0);
    const withDuration = rows.filter((r) => typeof r.durationSeconds === 'number').length;
    const avgDuration = withDuration > 0 ? Math.round(totalDuration / withDuration) : undefined;
    return { total: rows.length, completed, avgDuration };
  }, [rows]);

  return (
    <div className="page">
      <PageHeader
        title="Calls"
        subtitle={
          loading && rows.length === 0
            ? 'Loading call log…'
            : `${rows.length} call${rows.length === 1 ? '' : 's'} logged.`
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
          <section className="stat-row ov-calls-stat-row">
            <StatCard icon={<PhoneIcon size={18} />} tone="accent" value={stats.total} label="Total calls" />
            <StatCard
              icon={<CheckCircleIcon size={18} />}
              tone="green"
              value={stats.completed}
              label="Completed"
              hint={`${Math.round((stats.completed / (stats.total || 1)) * 100)}% of log`}
            />
            <StatCard
              icon={<ClockIcon size={18} />}
              tone="blue"
              value={stats.avgDuration != null ? formatDuration(stats.avgDuration) : '—'}
              label="Avg. duration"
            />
          </section>
        )}

        <Card flush>
          {rows.length === 0 ? (
            <EmptyState
              icon={<PhoneIcon size={22} />}
              title={loading ? 'Loading…' : 'No calls yet'}
              message={
                !loading && !error
                  ? 'Outbound check-in calls will appear here as they are placed.'
                  : undefined
              }
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Treatment</th>
                  <th>Direction</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th className="right" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const planId = r.patientId ? planByPatient.get(r.patientId) : undefined;
                  const name = (r.patientId && names[r.patientId]) || 'Unknown';
                  const StatusIcon = r.status ? STATUS_ICON[r.status] : null;
                  return (
                    // The row itself carries no interactive role — it only adds an
                    // onClick as a mouse convenience. The actual keyboard/AT-reachable
                    // affordance is the patient button below; trailing-cell controls
                    // stop propagation so they don't also fire the row's onOpenCall.
                    <tr key={r.id} className="calls-row" onClick={() => onOpenCall(r)}>
                      <td>
                        <button type="button" className="calls-row-open" aria-label={`Open call with ${name}`}>
                          <PersonCell name={name} fallback="Unknown" />
                        </button>
                      </td>
                      <td>
                        {r.treatment && r.treatment !== '—' ? (
                          <Pill tone="gray">{r.treatment}</Pill>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {r.direction ? (
                          <span className="dir-cell">
                            {r.direction === 'inbound' ? (
                              <ArrowDownLeftIcon size={14} />
                            ) : (
                              <ArrowUpRightIcon size={14} />
                            )}
                            {r.direction}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {r.status ? (
                          <Pill tone={STATUS_TONE[r.status] ?? 'gray'}>
                            {StatusIcon && <StatusIcon size={12} />}
                            {STATUS_LABEL[r.status] ?? r.status.replace(/-/g, ' ')}
                          </Pill>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="muted">{formatRelative(r.started)}</td>
                      <td className="mono">{formatDuration(r.durationSeconds)}</td>
                      <td className="right">
                        {planId ? (
                          <button
                            className="btn-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenReview(planId);
                            }}
                          >
                            Open review
                          </button>
                        ) : r.patientId ? (
                          <a
                            className="btn-link icon"
                            href={`${MEDPLUM_APP_URL}/Patient/${r.patientId}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalIcon size={14} />
                            Medplum
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
