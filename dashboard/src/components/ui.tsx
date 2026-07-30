/**
 * CareLoop UI kit — small, dependency-free presentational primitives shared
 * across every screen. Purely visual; no data logic lives here.
 */
import type { ReactNode } from 'react';

// ── Tone system ─────────────────────────────────────────────────────────────

export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'gray' | 'accent';

// ── Avatar ──────────────────────────────────────────────────────────────────

const AVATAR_TINTS = [
  { bg: '#eeeefc', fg: '#4b3fd1' }, // indigo
  { bg: '#e7f7ee', fg: '#137a45' }, // green
  { bg: '#e9f0ff', fg: '#2f5fe0' }, // blue
  { bg: '#fdf0e3', fg: '#a15c12' }, // amber
  { bg: '#fbeaf3', fg: '#b03a7a' }, // pink
  { bg: '#eaf1f0', fg: '#2f7d6e' }, // teal-slate
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initialsOf(name?: string, fallback?: string): string {
  const src = name?.trim() || fallback?.trim() || '';
  if (!src) return '—';
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '');
  return chars.join('') || src[0]?.toUpperCase() || '—';
}

export function Avatar({
  name,
  fallback,
  size = 34,
}: {
  name?: string;
  fallback?: string;
  size?: number;
}) {
  const key = (name || fallback || 'anon').toLowerCase();
  const tint = AVATAR_TINTS[hashString(key) % AVATAR_TINTS.length];
  return (
    <span
      className="ui-avatar"
      style={{
        width: size,
        height: size,
        background: tint.bg,
        color: tint.fg,
        fontSize: Math.max(11, Math.round(size * 0.38)),
      }}
      aria-hidden="true"
    >
      {initialsOf(name, fallback)}
    </span>
  );
}

// ── Pill / Badge ────────────────────────────────────────────────────────────

export function Pill({
  tone = 'gray',
  children,
  soft = false,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  /** subtle dot-prefixed variant */
  soft?: boolean;
  className?: string;
}) {
  return (
    <span className={`ui-pill tone-${tone} ${className}`}>
      {soft && <span className="ui-pill-dot" />}
      {children}
    </span>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────

type ButtonProps = {
  variant?: 'primary' | 'dark' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  full?: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = 'secondary',
  size = 'md',
  full = false,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`ui-btn v-${variant} s-${size} ${full ? 'full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

export function Card({
  title,
  subtitle,
  right,
  icon,
  className = '',
  bodyClassName = '',
  flush = false,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  icon?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** remove body padding (e.g. for full-bleed tables) */
  flush?: boolean;
  children?: ReactNode;
}) {
  const hasHeader = title || subtitle || right || icon;
  return (
    <section className={`ui-card ${className}`}>
      {hasHeader && (
        <header className="ui-card-head">
          {icon && <span className="ui-card-head-icon">{icon}</span>}
          <div className="ui-card-head-text">
            {title && <h3 className="ui-card-title">{title}</h3>}
            {subtitle && <p className="ui-card-sub">{subtitle}</p>}
          </div>
          {right && <div className="ui-card-head-right">{right}</div>}
        </header>
      )}
      <div className={`ui-card-body ${flush ? 'flush' : ''} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

// ── StatCard ────────────────────────────────────────────────────────────────

export function StatCard({
  icon,
  tone = 'accent',
  value,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  tone?: Tone;
  value: ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
}) {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag className={`ui-stat ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <span className={`ui-stat-icon tone-${tone}`}>{icon}</span>
      <span className="ui-stat-value">{value}</span>
      <span className="ui-stat-label">{label}</span>
      {hint && <span className="ui-stat-hint">{hint}</span>}
    </Tag>
  );
}

// ── PageHeader ──────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="ui-page-head">
      <div className="ui-page-head-text">
        <h1 className="ui-page-title">{title}</h1>
        {subtitle && <p className="ui-page-sub">{subtitle}</p>}
      </div>
      {action && <div className="ui-page-head-action">{action}</div>}
    </header>
  );
}

// ── SectionLabel ────────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="ui-section-label">{children}</div>;
}

// ── EmptyState ──────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      {icon && <span className="ui-empty-icon">{icon}</span>}
      <h3 className="ui-empty-title">{title}</h3>
      {message && <p className="ui-empty-msg">{message}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

// ── Table helpers ───────────────────────────────────────────────────────────

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">{children}</table>
    </div>
  );
}

// ── PersonCell (avatar + name + subtext) ───────────────────────────────────

export function PersonCell({
  name,
  fallback,
  subtext,
}: {
  name?: string;
  fallback?: string;
  subtext?: ReactNode;
}) {
  return (
    <div className="ui-person">
      <Avatar name={name} fallback={fallback} size={34} />
      <div className="ui-person-text">
        <span className="ui-person-name">{name || fallback || '—'}</span>
        {subtext && <span className="ui-person-sub">{subtext}</span>}
      </div>
    </div>
  );
}
