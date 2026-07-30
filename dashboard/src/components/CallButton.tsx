import { useState } from 'react';
import { startCall } from '../bridge';
import { PhoneIcon } from './icons';

/**
 * Reusable "Call" action. Fires POST {BRIDGE}/call with the patient id, the
 * module/condition id, and the phone number, then reports the returned callSid
 * or the error inline.
 */
export function CallButton({
  patientId,
  conditionId,
  phone,
  label = 'Call',
  size = 'sm',
}: {
  patientId: string;
  conditionId: string;
  phone?: string;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const [state, setState] = useState<'idle' | 'calling'>('idle');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const onClick = async () => {
    if (!phone) {
      setResult({ ok: false, message: 'No phone number on file for this patient.' });
      return;
    }
    setState('calling');
    setResult(null);
    try {
      const res = await startCall({ patientId, conditionId, phone });
      setResult({ ok: true, message: `Call started · ${res.callSid ?? 'queued'}` });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setState('idle');
    }
  };

  return (
    <span className="call-wrap">
      <button
        type="button"
        className={`btn-call ${size}`}
        onClick={onClick}
        disabled={state === 'calling'}
      >
        <PhoneIcon size={14} />
        {state === 'calling' ? 'Calling…' : label}
      </button>
      {result && (
        <span className={`call-result ${result.ok ? 'ok' : 'err'}`}>{result.message}</span>
      )}
    </span>
  );
}
