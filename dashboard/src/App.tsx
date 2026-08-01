import { useState } from 'react';
import { useMedplumProfile } from '@medplum/react-hooks';
import { useReviewData } from './useReviewData';
import { useReviewQueue } from './useReviewQueue';
import { useCalls } from './useCalls';
import { usePatientList } from './usePatientList';
import { usePatientNames } from './usePatientNames';
import { Sidebar, type Page } from './components/Sidebar';
import { Login } from './components/Login';
import { DashboardHome } from './views/DashboardHome';
import { LiveView } from './views/LiveView';
import { IntakeView } from './views/IntakeView';
import { ReviewView } from './views/ReviewView';
import { ReviewQueueView } from './views/ReviewQueueView';
import { CallsView } from './views/CallsView';
import { CallDetailView } from './views/CallDetailView';
import { PatientsView } from './views/PatientsView';
import { TreatmentsView } from './views/TreatmentsView';

export function App() {
  const profile = useMedplumProfile();

  // LIVE-only: always require an interactive Medplum session.
  if (!profile) {
    return <Login />;
  }

  return (
    <Shell userLabel={profileLabel(profile)} userEmail={profileEmail(profile)} />
  );
}

function Shell({ userLabel, userEmail }: { userLabel?: string; userEmail?: string }) {
  const [page, setPage] = useState<Page>('dashboard');
  // The worklist opens a specific CarePlan into the Review panel.
  const [openCarePlanId, setOpenCarePlanId] = useState<string | null>(null);
  // The Calls log opens a specific call into the read-only Call detail panel.
  const [openCallId, setOpenCallId] = useState<string | null>(null);

  const queue = useReviewQueue();
  const calls = useCalls();
  const patientList = usePatientList();
  const review = useReviewData(page === 'review' ? openCarePlanId : null);

  const openReview = (carePlanId: string) => {
    setOpenCarePlanId(carePlanId);
    setPage('review');
  };

  const openCall = (call: { id: string }) => {
    setOpenCallId(call.id);
    setPage('call');
  };

  const openCallRow = page === 'call' ? calls.rows.find((r) => r.id === openCallId) ?? null : null;
  // Resolve just this one patient's name (cached — cheap alongside the other
  // usePatientNames calls elsewhere in the tree).
  const openCallNames = usePatientNames([openCallRow?.patientId]);
  const openCallPatientName = openCallRow?.patientId ? openCallNames[openCallRow.patientId] : undefined;
  // The call detail page links through to the patient's newest draft plan, if any.
  const openCallCarePlanId = openCallRow?.patientId
    ? queue.rows.find((q) => q.patientId === openCallRow.patientId)?.carePlanId
    : undefined;

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
          <CallsView calls={calls} queue={queue} onOpenReview={openReview} onOpenCall={openCall} />
        )}
        {page === 'call' && (
          <CallDetailView
            call={openCallRow}
            patientName={openCallPatientName}
            calls={calls.rows}
            carePlanId={openCallCarePlanId}
            onBack={() => setPage('calls')}
            onOpenReview={openReview}
          />
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
