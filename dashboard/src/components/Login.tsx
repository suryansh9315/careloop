import { useState } from 'react';
import { signInWithPassword } from '../medplum';
import { PulseIcon } from './icons';
import { Button } from './ui';

/**
 * Centered login card for LIVE mode. Calls the interactive Medplum email +
 * password sign-in; on success the reactive profile updates and the app
 * renders (the session is persisted by the client).
 */
export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
      // On success useMedplumProfile() flips and App renders the dashboard.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed. Check your credentials.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <span className="logo-mark">
            <PulseIcon size={19} />
          </span>
          <span className="login-word">CareLoop</span>
        </div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Use your Medplum account to access the clinic dashboard.</p>

        <label className="field">
          <span className="field-label">Email</span>
          <input
            className="field-input"
            type="email"
            autoComplete="username"
            value={email}
            required
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@clinic.com"
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            className="field-input"
            type="password"
            autoComplete="current-password"
            value={password}
            required
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        {error && <div className="alert error">{error}</div>}

        <Button variant="primary" size="lg" full type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="login-help">Protected clinic environment · your session stays on this device.</p>
      </form>
    </div>
  );
}
