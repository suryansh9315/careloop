/**
 * Medplum client wiring for the dashboard.
 *
 * The dashboard is LIVE-ONLY and authenticates against Medplum's own login API
 * (`auth/login` → `oauth2/token`) using PKCE, driven entirely by the values
 * already in `.env`:
 *
 *   VITE_MEDPLUM_BASE_URL    Medplum server, e.g. https://api.medplum.com/
 *   VITE_MEDPLUM_CLIENT_ID   ClientApplication id (public — never a secret)
 *   VITE_MEDPLUM_PROJECT_ID  scopes the login to one project
 *
 * No client secret ever reaches the browser, and no server-side configuration
 * is required — codes minted by `auth/login` are exchanged directly, so this
 * works against a ClientApplication with no registered redirect URI.
 *
 * Trade-off worth knowing: because the credential is collected here rather than
 * on Medplum's hosted page, CareLoop is briefly in the path of the user's
 * password, and identity providers configured on the project (Google, Okta,
 * Azure AD) are not reachable through this screen. Switching to the hosted
 * redirect flow removes both limitations and needs exactly one change on the
 * server — a Redirect URI on the ClientApplication — and nothing here.
 */
import { MedplumClient } from '@medplum/core';
import type { LoginAuthenticationResponse, ProfileResource } from '@medplum/core';

const env = import.meta.env;

export const MEDPLUM_BASE_URL = env.VITE_MEDPLUM_BASE_URL ?? 'https://api.medplum.com/';
export const MEDPLUM_CLIENT_ID = env.VITE_MEDPLUM_CLIENT_ID ?? '';
export const MEDPLUM_PROJECT_ID = env.VITE_MEDPLUM_PROJECT_ID ?? '';
/** Patient to load (empty until VITE_PATIENT_ID is configured). */
export const LIVE_PATIENT_ID = env.VITE_PATIENT_ID ?? '';

/** Category token identifying the backend-published dashboard plan artifact. */
export const ARTIFACT_CATEGORY = 'https://careloop.demo|careloop-dashboard';

/** Category token identifying a call-log Communication. */
export const CALL_CATEGORY = 'https://careloop.demo|careloop-call';

/**
 * True when there is enough configuration to attempt a sign-in. Without a
 * client id Medplum answers with an opaque error, so the sign-in screen checks
 * this first and says what is missing instead.
 */
export const AUTH_CONFIGURED = Boolean(MEDPLUM_CLIENT_ID);

export const medplum = new MedplumClient({
  baseUrl: MEDPLUM_BASE_URL,
  clientId: MEDPLUM_CLIENT_ID || undefined,
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
 * Sign in with a Medplum email + password through Medplum's login API.
 *
 * `startLogin` posts to `auth/login` with a PKCE challenge and returns one of
 * three things, all of which are handled here rather than assumed away:
 *   - `code`        — the happy path; exchange it for tokens.
 *   - `memberships` — the account belongs to more than one project and Medplum
 *                     needs to know which. With a single membership we pick it
 *                     automatically; with several we say so, because silently
 *                     choosing one would sign the user into the wrong project.
 *   - `mfaRequired` — multi-factor is enabled, which this screen cannot collect.
 *
 * The previous implementation only looked at `code` and threw a generic error
 * for everything else, which surfaced an MFA-enabled or multi-project account
 * as "Login did not return an authorization code."
 */
export async function signInWithMedplum(
  email: string,
  password: string,
): Promise<ProfileResource> {
  const result = await medplum.startLogin({
    email,
    password,
    clientId: MEDPLUM_CLIENT_ID || undefined,
    projectId: MEDPLUM_PROJECT_ID || undefined,
    scope: 'openid profile',
  });
  return medplum.processCode(await resolveAuthCode(result));
}

/** Drive a login response to an authorization code, or explain why it can't. */
async function resolveAuthCode(result: LoginAuthenticationResponse): Promise<string> {
  if (result.code) return result.code;

  if (result.mfaRequired) {
    throw new Error(
      'This account has multi-factor authentication enabled, which CareLoop cannot ' +
        'collect. Ask an administrator to disable MFA for it, or sign in through Medplum.',
    );
  }

  const memberships = result.memberships ?? [];
  if (memberships.length === 1) {
    // Medplum returns the code once a project membership is chosen.
    const chosen = await medplum.post('auth/profile', {
      login: result.login,
      profile: memberships[0].id,
    });
    const code = (chosen as { code?: string }).code;
    if (code) return code;
  }
  if (memberships.length > 1) {
    throw new Error(
      `This account belongs to ${memberships.length} Medplum projects. Set ` +
        'VITE_MEDPLUM_PROJECT_ID to the one CareLoop should use.',
    );
  }

  throw new Error('Medplum accepted the sign-in but returned no authorization code.');
}

/**
 * End the session.
 *
 * Revokes the token server-side and clears it locally. There is no hosted
 * session to tear down in this flow — the credential was collected here — so a
 * logout redirect would only bounce the user through Medplum for no effect.
 */
export async function signOut(): Promise<void> {
  await medplum.signOut();
}
