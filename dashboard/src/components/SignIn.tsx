import { useState } from 'react';
import {
  MEDPLUM_BASE_URL,
  MEDPLUM_REDIRECT_URI,
  SSO_CONFIGURED,
  signInWithMedplum,
} from '../medplum';
import {
  BeakerIcon,
  PhoneIcon,
  PulseIcon,
  ShieldIcon,
  UsersIcon,
} from './icons';
import { Button } from './ui';

/**
 * Sign-in screen — Medplum OAuth2 (authorization code + PKCE).
 *
 * There is no credential form by design: authentication happens on Medplum's
 * hosted page and CareLoop never handles the password. The button only starts
 * the redirect.
 *
 * The redirect is user-initiated rather than automatic on load. Auto-redirecting
 * would make a failed callback unreadable — it would bounce straight back out —
 * and it would fight sign-out, which lands here.
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
  const serverHost = (() => {
    try {
      return new URL(MEDPLUM_BASE_URL).host;
    } catch {
      return MEDPLUM_BASE_URL;
    }
  })();

  return (
    <div className="auth-page">
      {/* Left: what this product is. Gives the screen a reason to exist beyond
          a lone button, and tells a new clinician what they're signing in to. */}
      <section className="auth-brand-panel">
        <div className="auth-brand">
          <span className="logo-mark">
            <PulseIcon size={19} />
          </span>
          <span className="auth-brand-word">CareLoop</span>
        </div>

        <h2 className="auth-tagline">
          Every patient arrives <em>already understood.</em>
        </h2>
        <p className="auth-lede">
          A voice agent checks patients in before the visit, charts the conversation as
          it happens, and drafts a coded care plan for you to review.
        </p>

        <ul className="auth-points">
          <li>
            <span className="auth-point-icon">
              <PhoneIcon size={15} />
            </span>
            <span>
              <strong>Charted live.</strong> The pre-visit call writes straight into the
              record.
            </span>
          </li>
          <li>
            <span className="auth-point-icon">
              <BeakerIcon size={15} />
            </span>
            <span>
              <strong>Researched and peer-reviewed.</strong> Each plan arrives with its
              evidence and an expert panel&rsquo;s verdict.
            </span>
          </li>
          <li>
            <span className="auth-point-icon">
              <UsersIcon size={15} />
            </span>
            <span>
              <strong>You decide.</strong> Nothing becomes active without your sign-off.
            </span>
          </li>
        </ul>
      </section>

      {/* Right: the single action. */}
      <section className="auth-action-panel">
        <div className="auth-card">
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-sub">
            CareLoop uses your organisation&rsquo;s Medplum account.
          </p>

          {shown && (
            <div className="auth-alert" role="alert">
              <ShieldIcon size={15} />
              <div>
                <strong>Sign-in failed</strong>
                <p>{shown}</p>
              </div>
            </div>
          )}

          {SSO_CONFIGURED ? (
            <>
              <Button variant="primary" size="lg" full onClick={onSignIn} disabled={busy}>
                {busy ? 'Redirecting to Medplum…' : 'Continue with Medplum'}
              </Button>

              <p className="auth-note">
                <ShieldIcon size={13} />
                <span>
                  You&rsquo;ll authenticate on <strong>{serverHost}</strong>. Your password
                  is never entered in CareLoop.
                </span>
              </p>

              {/*
               * Medplum rejects an unregistered redirect URI *before* redirecting
               * back, so the app never gets a callback it could explain — the user
               * just lands on a bare error on Medplum's domain. Showing the exact
               * value it compares against turns a dead end into a fix.
               */}
              <details className="auth-diag">
                <summary>Trouble signing in?</summary>
                <p>
                  If Medplum answers <strong>&ldquo;Invalid redirect URI&rdquo;</strong>,
                  this exact value must be saved as the <code>Redirect URI</code> on the
                  ClientApplication — compared byte for byte, trailing slash included:
                </p>
                <p className="auth-diag-value">
                  <code>{MEDPLUM_REDIRECT_URI}</code>
                </p>
                <p className="auth-diag-hint">
                  Medplum stores one redirect URI per client, so local and deployed
                  environments each need their own ClientApplication.
                </p>
              </details>
            </>
          ) : (
            <div className="auth-alert" role="alert">
              <ShieldIcon size={15} />
              <div>
                <strong>Not configured</strong>
                <p>
                  Set <code>VITE_MEDPLUM_CLIENT_ID</code> to a Medplum ClientApplication
                  id, then reload.
                </p>
              </div>
            </div>
          )}
        </div>

        <p className="auth-foot">Protected clinic environment</p>
      </section>
    </div>
  );
}
