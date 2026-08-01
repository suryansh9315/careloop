import { useEffect, useRef, useState } from 'react';
import { useMedplumProfile } from '@medplum/react-hooks';
import {
  callbackError,
  clearAuthParams,
  completeSignIn,
  pendingAuthCode,
} from './medplum';
import { useReviewData } from './useReviewData';
import { useReviewQueue } from './useReviewQueue';
import { useCalls } from './useCalls';
import { usePatientList } from './usePatientList';
import { Sidebar, type Page } from './components/Sidebar';
import { SignIn } from './components/SignIn';
import { DashboardHome } from './views/DashboardHome';
import { LiveView } from './views/LiveView';
import { IntakeView } from './views/IntakeView';
import { ReviewView } from './views/ReviewView';
import { ReviewQueueView } from './views/ReviewQueueView';
import { CallsView } from './views/CallsView';
import { PatientsView } from './views/PatientsView';
import { TreatmentsView } from './views/TreatmentsView';

export function App() {
  const profile = useMedplumProfile();
  const [authError, setAuthError] = useState<string | null>(null);
  // Seed from the URL so the very first paint of a callback load is the
  // "completing sign-in" state, not a flash of the sign-in button.
  const [exchanging, setExchanging] = useState(() => pendingAuthCode() !== null);
  // An authorization code is single-use, and StrictMode invokes effects twice in
  // dev. Without this guard the second run would redeem a spent code and report
  // a failure over a sign-in that actually succeeded.
  const exchangeStarted = useRef(false);

  useEffect(() => {
    const failure = callbackError();
    if (failure) {
      setAuthError(failure);
      clearAuthParams();
      setExchanging(false);
      return;
    }

    const code = pendingAuthCode();
    if (!code || exchangeStarted.current) return;
    exchangeStarted.current = true;

    completeSignIn(code)
      .catch((err: unknown) => {
        setAuthError(
          err instanceof Error ? err.message : 'Sign-in could not be completed.',
        );
      })
      .finally(() => setExchanging(false));
  }, []);

  if (exchanging) {
    return <AuthLoading />;
  }

  // LIVE-only: always require a Medplum SSO session.
  if (!profile) {
    return <SignIn error={authError} />;
  }

  return (
    <Shell userLabel={profileLabel(profile)} userEmail={profileEmail(profile)} />
  );
}

/** Shown while the authorization code is exchanged for tokens. */
function AuthLoading() {
  return (
    <div className="login-shell">
      <div className="login-card">
        <h1 className="login-title">Signing you in…</h1>
        <p className="login-sub">Completing sign-in with Medplum.</p>
      </div>
    </div>
  );
}

function Shell({ userLabel, userEmail }: { userLabel?: string; userEmail?: string }) {
  const [page, setPage] = useState<Page>('dashboard');
  // The worklist opens a specific CarePlan into the Review panel.
  const [openCarePlanId, setOpenCarePlanId] = useState<string | null>(null);

  const queue = useReviewQueue();
  const calls = useCalls();
  const patientList = usePatientList();
  const review = useReviewData(page === 'review' ? openCarePlanId : null);

  const openReview = (carePlanId: string) => {
    setOpenCarePlanId(carePlanId);
    setPage('review');
  };

  return (
    <div className="app-layout">
      <Sidebar page={page} onNavigate={setPage} userLabel={userLabel} userEmail={userEmail} />
      <main className="app-main">
        {page === 'dashboard' && (
          <DashboardHome
            queue={queue}
            calls={calls}
            patients={patientList}
            onNavigate={setPage}
            onOpenReview={openReview}
          />
        )}
        {page === 'live' && <LiveView calls={calls} />}
        {page === 'review-queue' && (
          <ReviewQueueView queue={queue} onOpenReview={openReview} />
        )}
        {page === 'calls' && (
          <CallsView calls={calls} queue={queue} onOpenReview={openReview} />
        )}
        {page === 'patients' && <PatientsView patients={patientList} />}
        {page === 'intake' && <IntakeView onCreated={patientList.refresh} />}
        {page === 'treatments' && <TreatmentsView />}
        {page === 'review' && (
          <ReviewView
            data={review}
            onBack={() => {
              setPage('review-queue');
              queue.refresh();
            }}
          />
        )}
      </main>
    </div>
  );
}

function profileLabel(profile: ReturnType<typeof useMedplumProfile>): string | undefined {
  if (!profile) return undefined;
  const name = (profile as { name?: { given?: string[]; family?: string }[] }).name?.[0];
  if (name) {
    return [name.given?.join(' '), name.family].filter(Boolean).join(' ') || undefined;
  }
  return undefined;
}

function profileEmail(profile: ReturnType<typeof useMedplumProfile>): string | undefined {
  if (!profile) return undefined;
  const telecom = (profile as { telecom?: { system?: string; value?: string }[] }).telecom;
  return telecom?.find((t) => t.system === 'email')?.value;
}
