import { useState } from 'react';
import { MEDPLUM_BASE_URL, SSO_CONFIGURED, signInWithMedplum } from '../medplum';
import { PulseIcon, ShieldIcon } from './icons';
import { Button } from './ui';

/**
 * Sign-in screen for Medplum SSO.
 *
 * There is no credential form here by design: CareLoop hands authentication to
 * Medplum's hosted page and never handles the user's password. The button only
 * starts the redirect — everything after that happens on Medplum's domain.
 *
 * The redirect is deliberately user-initiated rather than automatic on load.
 * Auto-redirecting would make a failed callback impossible to read (it would
 * bounce straight back out) and would fight sign-out, which lands here.
 */
export function SignIn({ error }: { error?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const onSignIn = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      // On success this navigates away and never resolves.
      await signInWithMedplum();
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : 'Could not reach Medplum to start sign-in.',
      );
      setBusy(false);
    }
  };

  const shown = error ?? localError;
  // Show the host rather than the full URL — it is the part that tells an
  // operator whether they are pointed at the right Medplum server.
  const serverHost = (() => {
    try {
      return new URL(MEDPLUM_BASE_URL).host;
    } catch {
      return MEDPLUM_BASE_URL;
    }
  })();

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <span className="logo-mark">
            <PulseIcon size={19} />
          </span>
          <span className="login-word">CareLoop</span>
        </div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">
          CareLoop uses your organisation&rsquo;s Medplum account. You&rsquo;ll be taken to
          Medplum to sign in, then brought straight back.
        </p>

        {shown && (
          <div className="alert error" role="alert">
            {shown}
          </div>
        )}

        {SSO_CONFIGURED ? (
          <>
            <Button variant="primary" size="lg" full onClick={onSignIn} disabled={busy}>
              {busy ? 'Redirecting to Medplum…' : 'Continue with Medplum'}
            </Button>
            <p className="login-help">
              <ShieldIcon size={13} /> Your password is entered on {serverHost}, never in
              CareLoop.
            </p>
          </>
        ) : (
          <div className="alert error" role="alert">
            Single sign-on is not configured. Set <code>VITE_MEDPLUM_CLIENT_ID</code> to a
            Medplum ClientApplication id and register this app&rsquo;s redirect URI on it.
          </div>
        )}
      </div>
    </div>
  );
}
