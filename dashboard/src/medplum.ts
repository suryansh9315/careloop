/**
 * Medplum client wiring for the dashboard.
 *
 * The dashboard is LIVE-ONLY and authenticates via **Medplum SSO** — the
 * OAuth2 authorization code flow with PKCE. The user is redirected to Medplum's
 * hosted sign-in page, authenticates there, and comes back with a short-lived
 * authorization code that the client exchanges for tokens. CareLoop never sees
 * the user's password, and any external identity provider configured on the
 * Medplum project (Google, Okta, Azure AD, …) works automatically, because the
 * hosted page owns that decision rather than us.
 *
 * Required configuration:
 *   VITE_MEDPLUM_BASE_URL   Medplum server, e.g. https://api.medplum.com/
 *   VITE_MEDPLUM_CLIENT_ID  ClientApplication id (public — no secret in a browser)
 *   VITE_MEDPLUM_REDIRECT_URI  optional; defaults to this app's origin + "/"
 *
 * The redirect URI must be registered on the Medplum ClientApplication and match
 * **byte for byte**, trailing slash included — OAuth2 compares it exactly. The
 * SDK's own default is `protocol//host/`, so we default to the same thing and
 * make it explicit rather than implicit.
 */
import { MedplumClient } from '@medplum/core';

const env = import.meta.env;

export const MEDPLUM_BASE_URL = env.VITE_MEDPLUM_BASE_URL ?? 'https://api.medplum.com/';
export const MEDPLUM_CLIENT_ID = env.VITE_MEDPLUM_CLIENT_ID ?? '';
export const MEDPLUM_PROJECT_ID = env.VITE_MEDPLUM_PROJECT_ID ?? '';
/** Patient to load (empty until VITE_PATIENT_ID is configured). */
export const LIVE_PATIENT_ID = env.VITE_PATIENT_ID ?? '';

/** Where Medplum sends the browser back after sign-in. Must be registered. */
export const MEDPLUM_REDIRECT_URI =
  env.VITE_MEDPLUM_REDIRECT_URI ?? `${window.location.origin}/`;

/** Category token identifying the backend-published dashboard plan artifact. */
export const ARTIFACT_CATEGORY = 'https://careloop.demo|careloop-dashboard';

/** Category token identifying a call-log Communication. */
export const CALL_CATEGORY = 'https://careloop.demo|careloop-call';

/**
 * True when the app has enough configuration to start an SSO handshake. Without
 * a client id the redirect would bounce off Medplum with an opaque error, so the
 * sign-in screen checks this first and explains what is missing instead.
 */
export const SSO_CONFIGURED = Boolean(MEDPLUM_CLIENT_ID);

export const medplum = new MedplumClient({
  baseUrl: MEDPLUM_BASE_URL,
  clientId: MEDPLUM_CLIENT_ID || undefined,
  // NB: the redirect URI is not a client-level option in @medplum/core — it is
  // carried on each login request, so it is passed in `signInWithMedplum()`.
  cacheTime: 60_000,
  // A token that expired or was revoked server-side would otherwise surface as
  // a wall of failed requests. Dropping the local session flips the reactive
  // profile to undefined, so the app falls back to the sign-in screen. This
  // deliberately does NOT auto-redirect: a redirect loop on a persistently
  // failing token is far worse than showing a sign-in button.
  onUnauthenticated: () => {
    medplum.clear();
  },
});

/** True once a session exists — cheaper than waiting on the reactive profile. */
export function isSignedIn(): boolean {
  return medplum.isAuthenticated();
}

/**
 * Start Medplum SSO by redirecting to the hosted sign-in page.
 *
 * `signInWithRedirect()` is dual-purpose in the SDK: with no `code` in the URL
 * it performs the redirect (and never returns), and with a `code` present it
 * exchanges it. We only ever call it for the first case — the callback is
 * handled explicitly by `completeSignIn` so we control error reporting and URL
 * cleanup rather than leaving a spent code in the address bar.
 */
export async function signInWithMedplum(): Promise<void> {
  await medplum.signInWithRedirect({
    clientId: MEDPLUM_CLIENT_ID || undefined,
    projectId: MEDPLUM_PROJECT_ID || undefined,
    redirectUri: MEDPLUM_REDIRECT_URI,
    scope: 'openid profile',
  });
}

/** The authorization code Medplum handed back, if this is a callback load. */
export function pendingAuthCode(): string | null {
  return new URLSearchParams(window.location.search).get('code');
}

/**
 * An error Medplum reported on the callback (e.g. `access_denied` when the user
 * cancels). Returned as a readable sentence, or null when there is no error.
 */
export function callbackError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  if (!error) return null;
  return params.get('error_description') ?? error.replace(/_/g, ' ');
}

/**
 * Strip the OAuth handshake params from the address bar.
 *
 * An authorization code is single-use. Leaving `?code=…` in the URL means a
 * refresh (or anything that re-reads the query string) retries a spent code and
 * fails, so we clear it as soon as the exchange resolves — success or failure.
 * `replaceState` keeps it out of history, so Back doesn't resurrect it either.
 */
export function clearAuthParams(): void {
  const url = new URL(window.location.href);
  let touched = false;
  for (const key of ['code', 'state', 'error', 'error_description']) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      touched = true;
    }
  }
  if (!touched) return;
  const search = url.searchParams.toString();
  window.history.replaceState(
    {},
    '',
    `${url.pathname}${search ? `?${search}` : ''}${url.hash}`,
  );
}

/**
 * Finish the SSO handshake by exchanging the authorization code for tokens.
 * Always clears the handshake params, so a failed attempt leaves a clean URL
 * the user can retry from.
 */
export async function completeSignIn(code: string): Promise<void> {
  try {
    await medplum.processCode(code);
  } finally {
    clearAuthParams();
  }
}

/**
 * End the session.
 *
 * Local revocation runs first and is awaited, so the CareLoop session is gone
 * even if the redirect that follows never completes. Then we hand off to
 * Medplum's logout endpoint to end the SSO session itself — without that step
 * the identity provider still considers the user signed in, and the next
 * "Sign in" silently logs them straight back in, which does not read as a
 * sign-out to anyone.
 */
export async function signOut(): Promise<void> {
  try {
    await medplum.signOut();
  } finally {
    medplum.signOutWithRedirect();
  }
}
