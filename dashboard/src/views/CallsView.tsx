import { formatDuration, type CallsState, type CallStatus } from '../useCalls';
import type { ReviewQueueState } from '../useReviewQueue';
import { usePatientNames } from '../usePatientNames';
import { MEDPLUM_APP_URL } from '../links';
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  ExternalIcon,
  PhoneIcon,
  RefreshIcon,
} from '../components/icons';
import { Button, Card, EmptyState, PageHeader, Pill, PersonCell, Table, type Tone } from '../components/ui';
import { formatRelative } from './format';

const STATUS_TONE: Record<CallStatus, Tone> = {
  completed: 'green',
  'in-progress': 'blue',
  initiated: 'blue',
  failed: 'red',
  'no-answer': 'gray',
};

/**
 * Calls page — the outbound/inbound call log. Newest first. A row opens the
 * patient's draft plan in Review if one exists, else links out to Medplum.
 */
export function CallsView({
  calls,
  queue,
  onOpenReview,
}: {
  calls: CallsState;
  queue: ReviewQueueState;
  onOpenReview: (carePlanId: string) => void;
}) {
  const { rows, loading, error, refresh } = calls;
  const names = usePatientNames(rows.map((r) => r.patientId));

  // Map patient → their newest draft CarePlan, so a call row can jump to review.
  const planByPatient = new Map<string, string>();
  for (const q of queue.rows) {
    if (q.patientId && !planByPatient.has(q.patientId)) planByPatient.set(q.patientId, q.carePlanId);
  }

  return (
    <div className="page">
      <PageHeader
        title="Calls"
        subtitle={
          loading ? 'Loading call log…' : `${rows.length} call${rows.length === 1 ? '' : 's'} logged.`
        }
        action={
          <Button variant="secondary" onClick={refresh} disabled={loading}>
            <RefreshIcon size={15} />
            Refresh
          </Button>
        }
      />

      {error && <div className="alert error">{error}</div>}

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
                return (
                  <tr key={r.id}>
                    <td>
                      <PersonCell name={name} fallback="Unknown" />
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
                          {r.status.replace(/-/g, ' ')}
                        </Pill>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted">{formatRelative(r.started)}</td>
                    <td className="mono">{formatDuration(r.durationSeconds)}</td>
                    <td className="right">
                      {planId ? (
                        <button className="btn-link" onClick={() => onOpenReview(planId)}>
                          Open review
                        </button>
                      ) : r.patientId ? (
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
