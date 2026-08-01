import { useId, useState } from 'react';
import { AUTH_CONFIGURED, MEDPLUM_BASE_URL, signInWithMedplum } from '../medplum';
import { PulseIcon, ShieldIcon } from './icons';
import { Button } from './ui';

/**
 * Sign-in screen — Medplum email + password, exchanged through Medplum's login
 * API. Nothing is stored here: the password lives in component state only until
 * the request resolves, and the resulting session is held by the Medplum client.
 */
export function SignIn() {
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithMedplum(email, password);
      // On success the reactive profile flips and App renders the dashboard.
    } catch (err) {
      // Medplum's own message is more useful than anything we'd invent here
      // (it distinguishes bad credentials from a locked or missing account).
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Sign in failed. Check your email and password.',
      );
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const serverHost = (() => {
    try {
      return new URL(MEDPLUM_BASE_URL).host;
    } catch {
      return MEDPLUM_BASE_URL;
    }
  })();

  if (!AUTH_CONFIGURED) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <Brand />
          <h1 className="login-title">Not configured</h1>
          <div className="alert error" role="alert">
            Set <code>VITE_MEDPLUM_CLIENT_ID</code> in <code>dashboard/.env</code> to a
            Medplum ClientApplication id, then reload.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <Brand />
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Use your Medplum account to access the clinic dashboard.</p>

        <label className="field" htmlFor={emailId}>
          <span className="field-label">Email</span>
        </label>
        <input
          id={emailId}
          className="field-input"
          type="email"
          autoComplete="username"
          value={email}
          required
          disabled={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@clinic.com"
        />

        <label className="field" htmlFor={passwordId}>
          <span className="field-label">Password</span>
        </label>
        <input
          id={passwordId}
          className="field-input"
          type="password"
          autoComplete="current-password"
          value={password}
          required
          disabled={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />

        {error && (
          <div className="alert error" id={errorId} role="alert">
            {error}
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          full
          type="submit"
          disabled={busy || !email || !password}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="login-help">
          <ShieldIcon size={13} /> Authenticated against {serverHost}. Your session stays
          on this device.
        </p>
      </form>
    </div>
  );
}

function Brand() {
  return (
    <div className="login-brand">
      <span className="logo-mark">
        <PulseIcon size={19} />
      </span>
      <span className="login-word">CareLoop</span>
    </div>
  );
}
