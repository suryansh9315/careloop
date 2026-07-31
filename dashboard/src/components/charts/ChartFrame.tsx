/**
 * Optional shared shell for chart cards: title / subtitle / right-slot /
 * table-view toggle button, plus a visually-hidden text summary slot for
 * screen readers. Charts are free to build their own header instead — this
 * just keeps the common case consistent.
 */
import type { ReactNode } from 'react';

export function ChartFrame({
  title,
  subtitle,
  right,
  tableToggle,
  summary,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  /** e.g. a "Table view" toggle button rendered top-right */
  tableToggle?: ReactNode;
  /** visually-hidden text summary of the series, for screen readers */
  summary?: string;
  children: ReactNode;
}) {
  const hasHead = title || subtitle || right || tableToggle;
  return (
    <div className="cl-chart-frame">
      {hasHead && (
        <div className="cl-chart-frame-head">
          <div className="cl-chart-frame-text">
            {title && <div className="cl-chart-frame-title">{title}</div>}
            {subtitle && <div className="cl-chart-frame-sub">{subtitle}</div>}
          </div>
          <div className="cl-chart-frame-actions">
            {right}
            {tableToggle}
          </div>
        </div>
      )}
      {summary && <span className="cl-visually-hidden">{summary}</span>}
      {children}
    </div>
  );
}
