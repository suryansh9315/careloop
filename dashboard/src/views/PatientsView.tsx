import { useMemo, useState } from 'react';
import type { PatientListState } from '../usePatientList';
import { MEDPLUM_APP_URL } from '../links';
import { CallButton } from '../components/CallButton';
import { ExternalIcon, RefreshIcon, SearchIcon, UsersIcon } from '../components/icons';
import { Button, Card, EmptyState, PageHeader, PersonCell, Table } from '../components/ui';

/**
 * Patients directory — live sync of the signed-in user's patients (respecting
 * their AccessPolicy). Searchable list with name, DOB, id, a Call action, and
 * an "Open in Medplum" link per row.
 */
export function PatientsView({ patients }: { patients: PatientListState }) {
  const [query, setQuery] = useState('');
  const { patients: rows, loading, error, refresh } = patients;

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
                <th>Id</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const phone = r.resource.telecom?.find((t) => t.system === 'phone')?.value;
                return (
                  <tr key={r.id}>
                    <td>
                      <PersonCell name={r.name} />
                    </td>
                    <td className="muted">{r.dob || '—'}</td>
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
  );
}
