import { useEffect, useState } from 'react';
import { BRIDGE, fetchConditions, type Condition } from '../bridge';
import { ClipboardIcon, PlusIcon } from '../components/icons';
import { Button, Card, EmptyState, PageHeader, Pill, Table } from '../components/ui';
import { TreatmentEditor } from './TreatmentEditor';

/**
 * Treatments admin — lists every ConditionModule in the catalog and opens the
 * structured editor to create a new treatment or edit an existing one.
 */
export function TreatmentsView() {
  const [rows, setRows] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // null = list view; { id: null } = create; { id } = edit that treatment.
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchConditions()
      .then((list) => setRows(list))
      .catch(() => setError(`Could not load treatments from ${BRIDGE}/conditions`))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (editing) {
    return (
      <TreatmentEditor
        id={editing.id}
        onBack={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Treatments"
        subtitle={
          loading
            ? 'Loading the treatment catalog…'
            : `${rows.length} treatment${rows.length === 1 ? '' : 's'} drive intake, scoring, and care plans.`
        }
        action={
          <Button variant="primary" onClick={() => setEditing({ id: null })}>
            <PlusIcon size={15} />
            New treatment
          </Button>
        }
      />

      {error && <div className="alert error">{error}</div>}

      <Card title="Catalog" flush>
        {rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon size={22} />}
            title={loading ? 'Loading treatments…' : 'No treatments yet'}
            message={
              !loading && !error ? 'Create one with the New treatment button.' : undefined
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Treatment</th>
                <th>Id</th>
                <th>Source</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="row-clickable"
                  onClick={() => setEditing({ id: r.id })}
                >
                  <td>
                    <span className="cell-name">{r.label}</span>
                  </td>
                  <td className="mono">{r.id}</td>
                  <td>
                    <Pill tone={r.builtIn ? 'gray' : 'accent'}>
                      {r.builtIn ? 'built-in' : 'custom'}
                    </Pill>
                  </td>
                  <td className="right">
                    <span className="row-open-btn">Edit</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
