import type { ReviewQueueState } from '../useReviewQueue';
import type { CallsState } from '../useCalls';
import type { PatientListState } from '../usePatientList';
import type { Page } from '../components/Sidebar';
import { usePatientNames } from '../usePatientNames';
import {
  ArrowRightIcon,
  BeakerIcon,
  InboxIcon,
  PhoneIcon,
  UsersIcon,
} from '../components/icons';
import {
  Avatar,
  Button,
  Card,
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

const CALL_TONE: Record<string, Tone> = {
  completed: 'green',
  'in-progress': 'blue',
  initiated: 'blue',
  failed: 'red',
  'no-answer': 'gray',
};

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
  const treatments = new Set(queue.rows.map((r) => r.treatment).filter((t) => t && t !== '—')).size;

  const stats = [
    {
      label: 'Draft plans to review',
      value: queue.rows.length,
      hint: 'across all patients',
      page: 'review-queue' as Page,
      icon: <InboxIcon size={19} />,
      tone: 'accent' as Tone,
    },
    {
      label: 'Calls today',
      value: callsToday,
      hint: `${calls.rows.length} total`,
      page: 'calls' as Page,
      icon: <PhoneIcon size={19} />,
      tone: 'blue' as Tone,
    },
    {
      label: 'Patients',
      value: patients.patients.length,
      hint: 'in your workspace',
      page: 'patients' as Page,
      icon: <UsersIcon size={19} />,
      tone: 'green' as Tone,
    },
    {
      label: 'Treatments',
      value: treatments,
      hint: 'in active plans',
      page: 'review-queue' as Page,
      icon: <BeakerIcon size={19} />,
      tone: 'amber' as Tone,
    },
  ];

  const recentPlans = queue.rows.slice(0, 5);
  const recentCalls = calls.rows.slice(0, 5);
  const planNames = usePatientNames(recentPlans.map((r) => r.patientId));
  const callNames = usePatientNames(recentCalls.map((r) => r.patientId));

  return (
    <div className="page">
      <PageHeader
        title={greeting()}
        subtitle={
          <>
            {queue.rows.length} draft plan{queue.rows.length === 1 ? '' : 's'} awaiting review.
          </>
        }
        action={
          <Button variant="primary" onClick={() => onNavigate('intake')}>
            New intake
          </Button>
        }
      />

      <section className="stat-row">
        {stats.map((s) => (
          <StatCard
            key={s.label}
            icon={s.icon}
            tone={s.tone}
            value={s.value}
            label={s.label}
            hint={s.hint}
            onClick={() => onNavigate(s.page)}
          />
        ))}
      </section>

      <div className="two-col">
        <Card
          title="Recent draft plans"
          right={
            <button className="btn-link" onClick={() => onNavigate('review-queue')}>
              View all
            </button>
          }
        >
          {recentPlans.length === 0 ? (
            <p className="hint">{queue.loading ? 'Loading…' : 'No draft plans to review.'}</p>
          ) : (
            <div className="activity-list">
              {recentPlans.map((r) => {
                const name = (r.patientId && planNames[r.patientId]) || 'Resolving…';
                return (
                  <button
                    key={r.carePlanId}
                    className="activity-row"
                    onClick={() => onOpenReview(r.carePlanId)}
                  >
                    <Avatar name={name} size={34} />
                    <div className="activity-main">
                      <span className="activity-title">{name}</span>
                      <span className="activity-sub">
                        {r.treatment} · {r.medication}
                      </span>
                    </div>
                    <div className="activity-meta">
                      <span>{formatRelative(r.created)}</span>
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
  );
}
