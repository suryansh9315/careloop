import { useEffect, useState } from 'react';
import { BRIDGE, fetchConditionModule, fetchConditions, type Condition, type ConditionModuleDetail } from '../bridge';
import { ClipboardIcon, PlusIcon, RefreshIcon, ShieldIcon, UsersIcon } from '../components/icons';
import { Button, Card, EmptyState, PageHeader, Pill, Table } from '../components/ui';
import { TreatmentEditor } from './TreatmentEditor';

/**
 * Treatments admin — lists every ConditionModule in the catalog and opens the
 * structured editor to create a new treatment or edit an existing one.
 *
 * The bridge that backs this page is a local dev service and is frequently
 * not running; when it's unreachable we say so plainly and offer a retry
 * rather than presenting an empty, unexplained table.
 */
export function TreatmentsView() {
  const [rows, setRows] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-row full module detail, fetched lazily after the catalog loads so the
  // list card ('instrument · bands · expert panel') can show at a glance.
  // undefined = not yet loaded, 'error' = that one row's detail failed.
  const [details, setDetails] = useState<Record<string, ConditionModuleDetail | 'error' | undefined>>({});

  // null = list view; { id: null } = create; { id } = edit that treatment.
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    setDetails({});
    fetchConditions()
      .then((list) => {
        setRows(list);
        // Best-effort enrichment — each row renders progressively as its
        // detail arrives, and a failed row just falls back to a dash rather
        // than blocking the rest of the list.
        list.forEach((c) => {
          fetchConditionModule(c.id)
            .then((detail) => setDetails((d) => ({ ...d, [c.id]: detail })))
            .catch(() => setDetails((d) => ({ ...d, [c.id]: 'error' })));
        });
      })
      .catch(() => setError(`Could not reach the treatment service at ${BRIDGE}.`))
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

  const unreachable = Boolean(error) && rows.length === 0;

  return (
    <div className="page">
      <PageHeader
        title="Treatments"
        subtitle={
          loading
            ? 'Loading the treatment catalog…'
            : unreachable
              ? 'The treatment catalog could not be loaded.'
              : `${rows.length} treatment${rows.length === 1 ? '' : 's'} drive intake, scoring, and care plans.`
        }
        action={
          <Button variant="primary" onClick={() => setEditing({ id: null })} disabled={unreachable}>
            <PlusIcon size={15} />
            New treatment
          </Button>
        }
      />

      {error && rows.length > 0 && <div className="alert error">{error}</div>}

      <Card title="Catalog" flush={!unreachable}>
        {unreachable ? (
          <EmptyState
            icon={<ShieldIcon size={22} />}
            title="Can't reach the treatment service"
            message={`${error} Start the bridge (default ${BRIDGE}) and try again — this page needs it for the treatment catalog, and New intake needs it to place calls.`}
            action={
              <Button variant="secondary" onClick={load}>
                <RefreshIcon size={15} />
                Retry
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon size={22} />}
            title={loading ? 'Loading treatments…' : 'No treatments yet'}
            message={!loading ? 'Create one with the New treatment button.' : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Treatment</th>
                <th>Instrument</th>
                <th>Bands</th>
                <th>Expert panel</th>
                <th>Source</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const detail = details[r.id];
                return (
                  <tr key={r.id} className="row-clickable" onClick={() => setEditing({ id: r.id })}>
                    <td>
                      <span className="cell-name">{r.label}</span>
                      <div className="wf-tx-id mono">{r.id}</div>
                    </td>
                    <td>
                      {detail === undefined ? (
                        <span className="hint">…</span>
                      ) : detail === 'error' ? (
                        <span className="muted">—</span>
                      ) : (
                        <span className="wf-tx-instrument">
                          {detail.instrument.name || <span className="muted">Unnamed</span>}
                          <span className="wf-tx-direction">
                            {detail.instrument.direction === 'higherIsBetter' ? 'higher is better' : 'higher is worse'}
                          </span>
                        </span>
                      )}
                    </td>
                    <td>
                      {detail === undefined ? (
                        <span className="hint">…</span>
                      ) : detail === 'error' ? (
                        <span className="muted">—</span>
                      ) : (
                        <Pill tone="gray">{detail.instrument.bands.length} band{detail.instrument.bands.length === 1 ? '' : 's'}</Pill>
                      )}
                    </td>
                    <td>
                      {detail === undefined ? (
                        <span className="hint">…</span>
                      ) : detail === 'error' ? (
                        <span className="muted">—</span>
                      ) : detail.expertPanel.length === 0 ? (
                        <span className="hint">None configured</span>
                      ) : (
                        <span className="wf-tx-experts">
                          <UsersIcon size={13} />
                          {detail.expertPanel.length} expert{detail.expertPanel.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </td>
                    <td>
                      <Pill tone={r.builtIn ? 'gray' : 'accent'}>{r.builtIn ? 'built-in' : 'custom'}</Pill>
                    </td>
                    <td className="right">
                      <span className="row-open-btn">Edit</span>
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
