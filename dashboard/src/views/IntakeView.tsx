import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BRIDGE, fetchConditions, type Condition } from '../bridge';
import { medplumPatientUrl } from '../links';
import { CallButton } from '../components/CallButton';
import { CheckIcon, ExternalIcon, ShieldIcon, UsersIcon, ClipboardIcon } from '../components/icons';
import { Button, Card, PageHeader } from '../components/ui';

/**
 * New Intake — create a patient, pick a treatment, and start the outbound call.
 * Reads the treatment catalog from GET {BRIDGE}/conditions and submits to
 * POST {BRIDGE}/intake, which creates the patient and dials them.
 *
 * Every required field is validated inline (on blur and on submit attempt),
 * errors are tied to their input via aria-describedby/aria-invalid, and a
 * failed submit focuses the first invalid field rather than leaving the user
 * to hunt for what's wrong.
 */

type IntakeSuccess = {
  patientId: string;
  conditionId: string;
  callSid?: string;
  callError?: string;
};

type FieldName = 'givenName' | 'familyName' | 'dob' | 'phone' | 'conditionId';
type FieldErrors = Partial<Record<FieldName, string>>;

const PHONE_RE = /^\+?[0-9()\-.\s]{7,20}$/;

export function IntakeView({ onCreated }: { onCreated?: () => void }) {
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [loadingConditions, setLoadingConditions] = useState(true);
  const [conditionsError, setConditionsError] = useState<string | null>(null);

  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [conditionId, setConditionId] = useState('');

  // Insurance — optional
  const [payerId, setPayerId] = useState('');
  const [payerName, setPayerName] = useState('');
  const [memberId, setMemberId] = useState('');
  const [subFirst, setSubFirst] = useState('');
  const [subLast, setSubLast] = useState('');
  const [subDob, setSubDob] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<IntakeSuccess | null>(null);

  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const fieldRefs = useRef<Record<FieldName, HTMLInputElement | HTMLSelectElement | null>>({
    givenName: null,
    familyName: null,
    dob: null,
    phone: null,
    conditionId: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchConditions();
        if (cancelled) return;
        setConditions(list);
        if (list.length > 0) setConditionId(list[0].id);
      } catch {
        if (!cancelled) setConditionsError(`Could not load treatments from ${BRIDGE}/conditions`);
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
    setTouched({});
    setSubmitAttempted(false);
    setError(null);
  };

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!givenName.trim()) errors.givenName = 'First name is required.';
    if (!familyName.trim()) errors.familyName = 'Last name is required.';
    if (!dob) {
      errors.dob = 'Date of birth is required.';
    } else {
      const d = new Date(dob);
      if (Number.isNaN(d.getTime())) errors.dob = 'Enter a valid date.';
      else if (d.getTime() > Date.now()) errors.dob = 'Date of birth cannot be in the future.';
    }
    if (!phone.trim()) errors.phone = 'Phone number is required.';
    else if (!PHONE_RE.test(phone.trim())) errors.phone = 'Enter a valid phone number, e.g. +15551234567.';
    if (!conditionId) errors.conditionId = 'Choose a treatment.';
    return errors;
  }

  const liveErrors = validate();
  const shownErrors: FieldErrors = {};
  (Object.keys(liveErrors) as FieldName[]).forEach((k) => {
    if (submitAttempted || touched[k]) shownErrors[k] = liveErrors[k];
  });

  const markTouched = (name: FieldName) => setTouched((t) => ({ ...t, [name]: true }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    const errors = validate();
    const firstInvalid = (['givenName', 'familyName', 'dob', 'phone', 'conditionId'] as FieldName[]).find(
      (k) => errors[k],
    );
    if (firstInvalid) {
      fieldRefs.current[firstInvalid]?.focus();
      setError('Fix the highlighted field(s) before submitting.');
      return;
    }

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
          <div className={`success-banner ${success.callSid ? 'ok' : 'warn'}`} role="status">
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
        subtitle="Create a patient, choose a treatment, and start the check-in call. Fields marked Required must be filled in before you can submit."
      />

      <form className="ui-card" onSubmit={onSubmit} noValidate>
        <div className="ui-card-body">
          <div className="form-section">
            <div className="form-section-title">
              <UsersIcon size={13} /> Patient
            </div>
            <div className="form-grid two">
              <Field label="First name" htmlFor="in-given" required error={shownErrors.givenName}>
                <input
                  id="in-given"
                  ref={(el) => {
                    fieldRefs.current.givenName = el;
                  }}
                  className="field-input"
                  value={givenName}
                  aria-required="true"
                  aria-invalid={Boolean(shownErrors.givenName)}
                  aria-describedby={shownErrors.givenName ? 'in-given-error' : undefined}
                  onChange={(e) => setGivenName(e.target.value)}
                  onBlur={() => markTouched('givenName')}
                />
              </Field>
              <Field label="Last name" htmlFor="in-family" required error={shownErrors.familyName}>
                <input
                  id="in-family"
                  ref={(el) => {
                    fieldRefs.current.familyName = el;
                  }}
                  className="field-input"
                  value={familyName}
                  aria-required="true"
                  aria-invalid={Boolean(shownErrors.familyName)}
                  aria-describedby={shownErrors.familyName ? 'in-family-error' : undefined}
                  onChange={(e) => setFamilyName(e.target.value)}
                  onBlur={() => markTouched('familyName')}
                />
              </Field>
              <Field label="Date of birth" htmlFor="in-dob" required error={shownErrors.dob}>
                <input
                  id="in-dob"
                  ref={(el) => {
                    fieldRefs.current.dob = el;
                  }}
                  className="field-input"
                  type="date"
                  value={dob}
                  aria-required="true"
                  aria-invalid={Boolean(shownErrors.dob)}
                  aria-describedby={shownErrors.dob ? 'in-dob-error' : undefined}
                  onChange={(e) => setDob(e.target.value)}
                  onBlur={() => markTouched('dob')}
                />
              </Field>
              <Field label="Phone" htmlFor="in-phone" required error={shownErrors.phone} hint="Include country code, e.g. +15551234567">
                <input
                  id="in-phone"
                  ref={(el) => {
                    fieldRefs.current.phone = el;
                  }}
                  className="field-input"
                  type="tel"
                  placeholder="+15551234567"
                  value={phone}
                  aria-required="true"
                  aria-invalid={Boolean(shownErrors.phone)}
                  aria-describedby={shownErrors.phone ? 'in-phone-error' : 'in-phone-hint'}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => markTouched('phone')}
                />
              </Field>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">
              <ClipboardIcon size={13} /> Treatment
            </div>
            {conditionsError && <div className="alert error">{conditionsError}</div>}
            <Field label="Condition module" htmlFor="in-condition" required error={shownErrors.conditionId}>
              <select
                id="in-condition"
                ref={(el) => {
                  fieldRefs.current.conditionId = el;
                }}
                className="field-input"
                value={conditionId}
                aria-required="true"
                aria-invalid={Boolean(shownErrors.conditionId)}
                aria-describedby={shownErrors.conditionId ? 'in-condition-error' : undefined}
                onChange={(e) => setConditionId(e.target.value)}
                onBlur={() => markTouched('conditionId')}
                disabled={loadingConditions}
              >
                {loadingConditions && <option>Loading…</option>}
                {!loadingConditions && conditions.length === 0 && <option value="">No treatments available</option>}
                {conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="form-section">
            <div className="form-section-title">
              <ShieldIcon size={13} /> Insurance <span className="wf-section-optional">· optional, for an eligibility check</span>
            </div>
            <div className="form-grid two">
              <Field label="Payer id" htmlFor="in-payer-id">
                <input id="in-payer-id" className="field-input" value={payerId} onChange={(e) => setPayerId(e.target.value)} />
              </Field>
              <Field label="Payer name" htmlFor="in-payer-name">
                <input id="in-payer-name" className="field-input" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
              </Field>
              <Field label="Member id" htmlFor="in-member-id">
                <input id="in-member-id" className="field-input" value={memberId} onChange={(e) => setMemberId(e.target.value)} />
              </Field>
              <Field label="Subscriber DOB (YYYYMMDD)" htmlFor="in-sub-dob">
                <input
                  id="in-sub-dob"
                  className="field-input"
                  placeholder="19880412"
                  value={subDob}
                  onChange={(e) => setSubDob(e.target.value)}
                />
              </Field>
              <Field label="Subscriber first" htmlFor="in-sub-first">
                <input id="in-sub-first" className="field-input" value={subFirst} onChange={(e) => setSubFirst(e.target.value)} />
              </Field>
              <Field label="Subscriber last" htmlFor="in-sub-last">
                <input id="in-sub-last" className="field-input" value={subLast} onChange={(e) => setSubLast(e.target.value)} />
              </Field>
            </div>
          </div>

          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}

          <Button variant="primary" size="lg" full type="submit" disabled={submitting} className="form-submit">
            {submitting ? 'Creating patient & starting call…' : 'Create patient & start call'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required = false,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field wf-field">
      <div className="wf-field-label-row">
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
        <span className={`wf-field-req ${required ? 'required' : 'optional'}`}>
          {required ? 'Required' : 'Optional'}
        </span>
      </div>
      {children}
      {error ? (
        <span className="wf-field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="wf-field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
