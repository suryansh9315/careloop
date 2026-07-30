import { useEffect, useState } from 'react';
import { BRIDGE, fetchConditions, type Condition } from '../bridge';
import { medplumPatientUrl } from '../links';
import { CallButton } from '../components/CallButton';
import { CheckIcon, ExternalIcon } from '../components/icons';
import { Button, Card, PageHeader } from '../components/ui';

/**
 * New Intake — create a patient, pick a treatment, and start the outbound call.
 * Reads the treatment catalog from GET {BRIDGE}/conditions and submits to
 * POST {BRIDGE}/intake, which creates the patient and dials them.
 */

type IntakeSuccess = {
  patientId: string;
  conditionId: string;
  callSid?: string;
  callError?: string;
};

export function IntakeView({ onCreated }: { onCreated?: () => void }) {
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [loadingConditions, setLoadingConditions] = useState(true);

  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [conditionId, setConditionId] = useState('');

  // Insurance
  const [payerId, setPayerId] = useState('');
  const [payerName, setPayerName] = useState('');
  const [memberId, setMemberId] = useState('');
  const [subFirst, setSubFirst] = useState('');
  const [subLast, setSubLast] = useState('');
  const [subDob, setSubDob] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<IntakeSuccess | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchConditions();
        if (cancelled) return;
        setConditions(list);
        if (list.length > 0) setConditionId(list[0].id);
      } catch {
        if (!cancelled) setError(`Could not load treatments from ${BRIDGE}/conditions`);
      } finally {
        if (!cancelled) setLoadingConditions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetForm = () => {
    setSuccess(null);
    setGivenName('');
    setFamilyName('');
    setDob('');
    setPhone('');
    setPayerId('');
    setPayerName('');
    setMemberId('');
    setSubFirst('');
    setSubLast('');
    setSubDob('');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const coverage =
      payerId && memberId
        ? {
            payerId,
            payerName: payerName || undefined,
            memberId,
            subscriberFirstName: subFirst || givenName,
            subscriberLastName: subLast || familyName,
            subscriberDob: subDob,
          }
        : undefined;

    try {
      const res = await fetch(`${BRIDGE}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ givenName, familyName, dob, phone, conditionId, coverage }),
      });
      const json = await res.json();
      if (!res.ok) {
        // The bridge may still have created the patient even if calling failed
        // (e.g. Twilio not configured). Surface the id when it returns one.
        if (json.patientId) {
          setSuccess({
            patientId: json.patientId,
            conditionId: json.conditionId ?? conditionId,
            callError: json.error ?? `Intake returned ${res.status}`,
          });
          onCreated?.();
          return;
        }
        throw new Error(json.error ?? `Intake failed (${res.status})`);
      }
      setSuccess(json as IntakeSuccess);
      onCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="page narrow">
        <PageHeader title="Intake created" subtitle="The patient is on file in Medplum." />

        <Card bodyClassName="success-panel">
          <div className={`success-banner ${success.callSid ? 'ok' : 'warn'}`}>
            <CheckIcon size={18} />
            {success.callSid
              ? 'Patient created and outbound call placed.'
              : 'Patient created. The outbound call could not be placed automatically.'}
          </div>

          <dl className="kv">
            <div>
              <dt>Patient id</dt>
              <dd>
                <code>{success.patientId}</code>
              </dd>
            </div>
            <div>
              <dt>Treatment</dt>
              <dd>
                <code>{success.conditionId}</code>
              </dd>
            </div>
            {success.callSid && (
              <div>
                <dt>Call SID</dt>
                <dd>
                  <code>{success.callSid}</code>
                </dd>
              </div>
            )}
          </dl>

          {success.callError && (
            <div className="alert warn">
              {success.callError} — the patient was still created. Use Call below to retry.
            </div>
          )}

          <div className="success-actions">
            <CallButton
              patientId={success.patientId}
              conditionId={success.conditionId}
              phone={phone}
              label="Call patient"
              size="md"
            />
            <a
              className="ui-btn v-secondary s-md"
              href={medplumPatientUrl(success.patientId)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalIcon size={15} />
              Open in Medplum
            </a>
            <Button variant="secondary" onClick={resetForm}>
              New intake
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <PageHeader
        title="New intake"
        subtitle="Create a patient, choose a treatment, and start the check-in call."
      />

      <form className="ui-card" onSubmit={onSubmit}>
        <div className="ui-card-body">
        <div className="form-section">
        <div className="form-section-title">Patient</div>
        <div className="form-grid two">
          <Field label="First name">
            <input className="field-input" value={givenName} required onChange={(e) => setGivenName(e.target.value)} />
          </Field>
          <Field label="Last name">
            <input className="field-input" value={familyName} required onChange={(e) => setFamilyName(e.target.value)} />
          </Field>
          <Field label="Date of birth">
            <input className="field-input" type="date" value={dob} required onChange={(e) => setDob(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input
              className="field-input"
              type="tel"
              placeholder="+15551234567"
              value={phone}
              required
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        </div>

        <div className="form-section">
        <div className="form-section-title">Treatment</div>
        <Field label="Condition module">
          <select
            className="field-input"
            value={conditionId}
            onChange={(e) => setConditionId(e.target.value)}
            disabled={loadingConditions}
            required
          >
            {loadingConditions && <option>Loading…</option>}
            {conditions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        </div>

        <div className="form-section">
        <div className="form-section-title">Insurance · optional — for eligibility check</div>
        <div className="form-grid two">
          <Field label="Payer id">
            <input className="field-input" value={payerId} onChange={(e) => setPayerId(e.target.value)} />
          </Field>
          <Field label="Payer name">
            <input className="field-input" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
          </Field>
          <Field label="Member id">
            <input className="field-input" value={memberId} onChange={(e) => setMemberId(e.target.value)} />
          </Field>
          <Field label="Subscriber DOB (YYYYMMDD)">
            <input className="field-input" placeholder="19880412" value={subDob} onChange={(e) => setSubDob(e.target.value)} />
          </Field>
          <Field label="Subscriber first">
            <input className="field-input" value={subFirst} onChange={(e) => setSubFirst(e.target.value)} />
          </Field>
          <Field label="Subscriber last">
            <input className="field-input" value={subLast} onChange={(e) => setSubLast(e.target.value)} />
          </Field>
        </div>
        </div>

        {error && <div className="alert error">{error}</div>}

        <Button variant="primary" size="lg" full type="submit" disabled={submitting} className="form-submit">
          {submitting ? 'Creating patient & starting call…' : 'Create patient & start call'}
        </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
