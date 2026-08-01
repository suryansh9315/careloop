import { useMemo, useState } from 'react';
import type { PatientListState } from '../usePatientList';
import { useReviewQueue } from '../useReviewQueue';
import type { ReviewQueueRow } from '../types';
import { triageQueueRow, queueRowTrendPoints } from '../reviewQueueEnrich';
import { MEDPLUM_APP_URL } from '../links';
import { CallButton } from '../components/CallButton';
import { ExternalIcon, RefreshIcon, SearchIcon, UsersIcon } from '../components/icons';
import { DeltaBadge, ScoreSparkline, bandForScore, scaleForModule } from '../components/charts';
import { Button, Card, EmptyState, PageHeader, PersonCell, Pill, Table, type Tone } from '../components/ui';
import { formatDate, formatRelative } from './format';

const TONE_FOR: Record<string, Tone> = { green: 'green', amber: 'amber', red: 'red', gray: 'gray' };

type SortMode = 'attention' | 'lastSeen' | 'name';

/** Newest check-in date we have on file for this patient's active draft, if any. */
function lastCheckIn(row?: ReviewQueueRow): string | null {
  if (!row) return null;
  if (row.scoreTotal != null && row.created) return row.created;
  if (row.priorScores && row.priorScores.length > 0) {
    return row.priorScores[row.priorScores.length - 1].date;
  }
  return null;
}

const STALE_AFTER_DAYS = 60;

function daysAgo(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return -1;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/**
 * Patients directory — live sync of the signed-in user's patients (respecting
 * their AccessPolicy). Answers the two questions a clinician actually arrives
 * with: who is trending the wrong way, and who hasn't been seen in a while —
 * not just an alphabetical name/DOB list.
 */
export function PatientsView({ patients }: { patients: PatientListState }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('attention');
  const { patients: rows, loading, error, refresh } = patients;

  // Best-effort join to the review queue so the roster can show each
  // patient's most recent score, trend and triage state, not just their
  // name/DOB. If this fetch fails (e.g. no queue data available) the roster
  // still renders — control state is a bonus, not a blocker.
  const queue = useReviewQueue();
  const controlByPatient = useMemo(() => {
    const map = new Map<string, ReviewQueueRow>();
    for (const r of queue.rows) {
      if (!r.patientId || r.scoreTotal == null || !r.conditionModuleId) continue;
      if (!map.has(r.patientId)) map.set(r.patientId, r);
    }
    return map;
  }, [queue.rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.dob.includes(q) ||
        r.id.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sort === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'lastSeen') {
      list.sort((a, b) => {
        const da = lastCheckIn(controlByPatient.get(a.id));
        const db = lastCheckIn(controlByPatient.get(b.id));
        const ta = da ? Date.parse(da) : -Infinity; // never checked in sorts first
        const tb = db ? Date.parse(db) : -Infinity;
        return ta - tb;
      });
    } else {
      list.sort((a, b) => {
        const ra = controlByPatient.get(a.id);
        const rb = controlByPatient.get(b.id);
        const rankA = ra ? triageQueueRow(ra).rank : Number.POSITIVE_INFINITY;
        const rankB = rb ? triageQueueRow(rb).rank : Number.POSITIVE_INFINITY;
        if (rankA !== rankB) return rankA - rankB;
        return a.name.localeCompare(b.name);
      });
    }
    return list;
  }, [filtered, sort, controlByPatient]);

  return (
    <div className="page">
      <PageHeader
        title="Patients"
        subtitle={loading ? 'Syncing patients…' : `${rows.length} patients synced from Medplum.`}
        action={
          <Button variant="secondary" onClick={refresh} disabled={loading}>
            <RefreshIcon size={15} />
            Refresh
          </Button>
        }
      />

      {error && <div className="alert error">{error}</div>}

      <div className={loading && rows.length > 0 ? 'queue-loading-frame' : ''}>
        <Card
          title="Directory"
          flush
          right={
            <div className="ov-patients-toolbar">
              <div className="search-field">
                <SearchIcon size={16} />
                <input
                  className="field-input"
                  placeholder="Search name, DOB, or id…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="ov-sort-group" role="group" aria-label="Sort patients">
                <button
                  type="button"
                  className={`ov-sort-btn ${sort === 'attention' ? 'active' : ''}`}
                  onClick={() => setSort('attention')}
                >
                  Needs attention
                </button>
                <button
                  type="button"
                  className={`ov-sort-btn ${sort === 'lastSeen' ? 'active' : ''}`}
                  onClick={() => setSort('lastSeen')}
                >
                  Last seen
                </button>
                <button
                  type="button"
                  className={`ov-sort-btn ${sort === 'name' ? 'active' : ''}`}
                  onClick={() => setSort('name')}
                >
                  Name
                </button>
              </div>
            </div>
          }
        >
          {sorted.length === 0 ? (
            <EmptyState
              icon={<UsersIcon size={22} />}
              title={loading ? 'Loading patients…' : 'No patients found'}
              message={
                !loading && !error
                  ? query
                    ? 'Try a different search.'
                    : 'Create one from New intake.'
                  : undefined
              }
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Trend</th>
                  <th>Control state</th>
                  <th>Last check-in</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const phone = r.resource.telecom?.find((t) => t.system === 'phone')?.value;
                  const row = controlByPatient.get(r.id);
                  const scale = row?.conditionModuleId ? scaleForModule(row.conditionModuleId) : null;
                  const points = row ? queueRowTrendPoints(row) : [];
                  const checkIn = lastCheckIn(row);
                  const stale = checkIn ? daysAgo(checkIn) >= STALE_AFTER_DAYS : false;

                  return (
                    <tr key={r.id}>
                      <td>
                        <PersonCell name={r.name} subtext={r.dob ? `DOB ${formatDate(r.dob)}` : undefined} />
                      </td>
                      <td>
                        {scale && points.length > 0 ? (
                          <ScoreSparkline points={points} scale={scale} width={100} height={32} />
                        ) : (
                          <span className="hint">No score on file</span>
                        )}
                      </td>
                      <td>
                        {row && scale && row.scoreTotal != null ? (
                          <div className="ov-control-cell">
                            <ControlChip moduleId={row.conditionModuleId!} total={row.scoreTotal} />
                            {points.length > 1 && <DeltaBadge points={points} scale={scale} />}
                          </div>
                        ) : (
                          <span className="hint">No score on file</span>
                        )}
                      </td>
                      <td>
                        {checkIn ? (
                          <span className={stale ? 'ov-stale' : 'muted'}>
                            {stale ? `Not seen · ${formatRelative(checkIn)}` : formatRelative(checkIn)}
                          </span>
                        ) : (
                          <span className="hint">No check-in on file</span>
                        )}
                      </td>
                      <td className="right">
                        <div className="row-actions">
                          <CallButton patientId={r.id} conditionId="" phone={phone} />
                          <a
                            className="btn-link icon"
                            href={`${MEDPLUM_APP_URL}/Patient/${r.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalIcon size={14} />
                            Medplum
                          </a>
                        </div>
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

function ControlChip({ moduleId, total }: { moduleId: string; total: number }) {
  const scale = scaleForModule(moduleId);
  const band = bandForScore(scale, total);
  return (
    <Pill tone={TONE_FOR[band.tone] ?? 'gray'}>
      {scale.instrument} {total} · {band.label}
    </Pill>
  );
}
