import { useMemo, useState } from 'react';
import type { PatientListState } from '../usePatientList';
import { useReviewQueue } from '../useReviewQueue';
import { MEDPLUM_APP_URL } from '../links';
import { CallButton } from '../components/CallButton';
import { ExternalIcon, RefreshIcon, SearchIcon, UsersIcon } from '../components/icons';
import { bandForScore, scaleForModule } from '../components/charts';
import { Button, Card, EmptyState, PageHeader, PersonCell, Pill, Table, type Tone } from '../components/ui';

const TONE_FOR: Record<string, Tone> = { green: 'green', amber: 'amber', red: 'red', gray: 'gray' };

/**
 * Patients directory — live sync of the signed-in user's patients (respecting
 * their AccessPolicy). Searchable list with name, DOB, current control state
 * (where a draft/latest score is on file), a Call action, and an "Open in
 * Medplum" link per row.
 */
export function PatientsView({ patients }: { patients: PatientListState }) {
  const [query, setQuery] = useState('');
  const { patients: rows, loading, error, refresh } = patients;

  // Best-effort join to the review queue so the roster can show each
  // patient's most recent score, not just their name/DOB. If this fetch
  // fails (e.g. no queue data available) the roster still renders — control
  // state is a bonus, not a blocker.
  const queue = useReviewQueue();
  const controlByPatient = useMemo(() => {
    const map = new Map<string, { moduleId: string; total: number }>();
    for (const r of queue.rows) {
      if (!r.patientId || r.scoreTotal == null || !r.conditionModuleId) continue;
      if (!map.has(r.patientId)) map.set(r.patientId, { moduleId: r.conditionModuleId, total: r.scoreTotal });
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
            <div className="search-field">
              <SearchIcon size={16} />
              <input
                className="field-input"
                placeholder="Search name, DOB, or id…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          }
        >
          {filtered.length === 0 ? (
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
                  <th>Date of birth</th>
                  <th>Control state</th>
                  <th>Id</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const phone = r.resource.telecom?.find((t) => t.system === 'phone')?.value;
                  const control = controlByPatient.get(r.id);
                  return (
                    <tr key={r.id}>
                      <td>
                        <PersonCell name={r.name} />
                      </td>
                      <td className="muted">{r.dob || '—'}</td>
                      <td>
                        {control ? (
                          <ControlChip moduleId={control.moduleId} total={control.total} />
                        ) : (
                          <span className="hint">No score on file</span>
                        )}
                      </td>
                      <td className="mono">{r.id}</td>
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
