import type { ReviewQueueState } from '../useReviewQueue';
import { usePatientNames } from '../usePatientNames';
import { ArrowRightIcon, InboxIcon, RefreshIcon } from '../components/icons';
import { Button, Card, EmptyState, PageHeader, Pill, PersonCell, Table } from '../components/ui';
import { formatRelative } from './format';

/**
 * Review queue — the primary worklist. Lists ALL draft CarePlans across
 * patients. Opening a row loads that CarePlan into the Review panel.
 */
export function ReviewQueueView({
  queue,
  onOpenReview,
}: {
  queue: ReviewQueueState;
  onOpenReview: (carePlanId: string) => void;
}) {
  const { rows, loading, error, refresh } = queue;
  const names = usePatientNames(rows.map((r) => r.patientId));

  return (
    <div className="page">
      <PageHeader
        title="Review queue"
        subtitle={
          loading
            ? 'Loading draft care plans…'
            : `${rows.length} draft plan${rows.length === 1 ? '' : 's'} awaiting review.`
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
            icon={<InboxIcon size={22} />}
            title={loading ? 'Loading…' : 'Queue is clear'}
            message={
              !loading && !error ? 'No draft care plans need review right now.' : undefined
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Treatment</th>
                <th>Medication</th>
                <th>Created</th>
                <th className="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const name = (r.patientId && names[r.patientId]) || 'Resolving…';
                return (
                  <tr
                    key={r.carePlanId}
                    className="row-clickable"
                    onClick={() => onOpenReview(r.carePlanId)}
                  >
                    <td>
                      <PersonCell name={name} subtext={r.patientId ?? undefined} />
                    </td>
                    <td>
                      <Pill tone="accent">{r.treatment}</Pill>
                    </td>
                    <td className="muted">{r.medication}</td>
                    <td className="muted">{formatRelative(r.created)}</td>
                    <td className="right">
                      <span className="row-open-btn">
                        Open <ArrowRightIcon size={13} />
                      </span>
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
