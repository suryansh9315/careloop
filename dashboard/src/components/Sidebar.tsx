import { signOut } from '../medplum';
import {
  ClipboardIcon,
  HomeIcon,
  ListIcon,
  LiveIcon,
  LogoutIcon,
  PhoneIcon,
  PlusIcon,
  PulseIcon,
  UsersIcon,
} from './icons';
import { Avatar, SectionLabel } from './ui';

export type Page =
  | 'dashboard'
  | 'live'
  | 'review-queue'
  | 'calls'
  | 'patients'
  | 'intake'
  | 'treatments'
  | 'review';

const NAV: {
  id: Page;
  label: string;
  icon: (p: { size?: number }) => JSX.Element;
  live?: boolean;
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: HomeIcon },
  { id: 'live', label: 'Live', icon: LiveIcon, live: true },
  { id: 'review-queue', label: 'Review queue', icon: ListIcon },
  { id: 'calls', label: 'Calls', icon: PhoneIcon },
  { id: 'patients', label: 'Patients', icon: UsersIcon },
  { id: 'intake', label: 'New intake', icon: PlusIcon },
  { id: 'treatments', label: 'Treatments', icon: ClipboardIcon },
];

export function Sidebar({
  page,
  onNavigate,
  userLabel,
  userEmail,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
  userLabel?: string;
  userEmail?: string;
}) {
  // The Review panel is a detail view reached from the queue; keep the queue
  // item highlighted while a plan is open in review.
  const activeId: Page = page === 'review' ? 'review-queue' : page;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="logo-mark">
          <PulseIcon size={17} />
        </span>
        <span className="brand-word">CareLoop</span>
      </div>

      <SectionLabel>Workspace</SectionLabel>
      <nav className="sidebar-nav">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-item ${activeId === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
              {item.live && <span className="nav-live-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="user-card">
          <Avatar name={userLabel} fallback={userEmail} size={34} />
          <div className="user-meta">
            <div className="user-name">{userLabel ?? 'Signed in'}</div>
            {userEmail && <div className="user-email">{userEmail}</div>}
          </div>
          <button
            className="icon-btn"
            title="Sign out"
            aria-label="Sign out"
            // Ends the SSO session too, not just the local one — see signOut().
            onClick={() => void signOut()}
          >
            <LogoutIcon size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
