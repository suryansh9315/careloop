/**
 * Quick-look preview opened from a queue card — the full clinical picture
 * (band meter, trend, triage reasons, safety flags, peer consensus, coverage,
 * patient recap) without leaving the worklist. "Open full review" is the
 * primary action; it navigates to the full review page.
 */
import { useId } from 'react';
import type { ReviewQueueRow } from '../types';
import type { Triage } from '../reviewQueueEnrich';
import { queueRowTrendPoints } from '../reviewQueueEnrich';
import { CONSENSUS_LABEL, CONSENSUS_TONE } from '../clinicalDisplay';
import { BandMeter, ScoreTrendChart, scaleForModule } from './charts';
import { Avatar, Button, Pill, type Tone } from './ui';
import { ArrowRightIcon } from './icons';
import { Modal } from './Modal';

const LEVEL_TONE: Record<Triage['level'], Tone> = {
  critical: 'red',
  urgent: 'amber',
  routine: 'gray',
};

const LEVEL_LABEL: Record<Triage['level'], string> = {
  critical: 'Critical',
  urgent: 'Urgent',
  routine: 'Routine',
};

export function PlanPreviewModal({
  row,
  triage,
  name,
  onClose,
  onOpenReview,
}: {
  row: ReviewQueueRow | null;
  triage: Triage | null;
  name: string;
  onClose: () => void;
  onOpenReview: (carePlanId: string) => void;
}) {
  const titleId = useId();
  const open = row != null;

  return (
    <Modal open={open} onClose={onClose} labelId={titleId} className="cl-plan-modal">
      {row && (
        <PlanPreviewContent
          row={row}
          triage={triage}
          name={name}
          titleId={titleId}
          onClose={onClose}
          onOpenReview={onOpenReview}
        />
      )}
    </Modal>
  );
}

function PlanPreviewContent({
  row,
  triage,
  name,
  titleId,
  onClose,
  onOpenReview,
}: {
  row: ReviewQueueRow;
  triage: Triage | null;
  name: string;
  titleId: string;
  onClose: () => void;
  onOpenReview: (carePlanId: string) => void;
}) {
  const moduleId = row.conditionModuleId ?? '';
  const scale = scaleForModule(moduleId);
  const points = queueRowTrendPoints(row);
  const safetyFlags = row.safetyFlags ?? [];
  const riskFindings = row.riskFindings ?? [];

  return (
    <>
      <header className="cl-modal-head">
        <div className="cl-modal-head-ident">
          <Avatar name={name} size={40} />
          <div>
            <h2 id={titleId} className="cl-modal-title">
              {name}
            </h2>
            <p className="cl-modal-sub">
              {row.conditionDisplay ?? row.treatment}
              {row.conditionCode && (
                <>
                  {' '}
                  <code>ICD-10 {row.conditionCode}</code>
                </>
              )}
            </p>
          </div>
        </div>
        <button type="button" className="cl-modal-close" onClick={onClose} aria-label="Close preview">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="cl-modal-body">
        {triage && triage.reasons.length > 0 && (
          <section className="cl-modal-section">
            <div className="cl-modal-section-head">
              <Pill tone={LEVEL_TONE[triage.level]}>{LEVEL_LABEL[triage.level]}</Pill>
              <span className="cl-modal-section-title">Why this plan needs attention</span>
            </div>
            <ul className="cl-triage-reason-list">
              {triage.reasons.map((r) => (
                <li key={r.code}>{r.label}</li>
              ))}
            </ul>
          </section>
        )}

        {row.scoreTotal != null && (
          <section className="cl-modal-section">
            <div className="cl-modal-section-head">
              <span className="cl-modal-section-title">
                {scale.instrumentLong} ({scale.instrument})
              </span>
            </div>
            <BandMeter scale={scale} total={row.scoreTotal} showTicks />
            {points.length > 0 && (
              <div className="cl-modal-trend">
                <ScoreTrendChart points={points} scale={scale} height={180} />
              </div>
            )}
          </section>
        )}

        {(safetyFlags.length > 0 || riskFindings.length > 0) && (
          <section className="cl-modal-section">
            <div className="cl-modal-section-head">
              <span className="cl-modal-section-title">Safety &amp; risk</span>
            </div>
            <ul className="cl-flag-list">
              {safetyFlags.map((f, i) => (
                <li key={`sf-${i}`} className={`cl-flag tone-${f.severity}`}>
                  <Pill tone={f.severity === 'critical' ? 'red' : f.severity === 'warning' ? 'amber' : 'gray'}>
                    {f.kind}
                  </Pill>
                  {f.message}
                </li>
              ))}
              {riskFindings.map((f, i) => (
                <li key={`rf-${i}`} className={`cl-flag tone-${f.severity}`}>
                  <Pill tone={f.severity === 'critical' ? 'red' : f.severity === 'warning' ? 'amber' : 'gray'}>
                    {f.label}
                  </Pill>
                  {f.detail}
                </li>
              ))}
            </ul>
          </section>
        )}

        {row.peerConsensus && (
          <section className="cl-modal-section">
            <div className="cl-modal-section-head">
              <span className="cl-modal-section-title">Peer consensus</span>
            </div>
            <p className="cl-modal-line">
              <Pill tone={CONSENSUS_TONE[row.peerConsensus] ?? 'gray'}>
                {CONSENSUS_LABEL[row.peerConsensus] ?? row.peerConsensus}
              </Pill>{' '}
              {row.peerTotal != null && row.peerTotal > 0 && (
                <span className="hint">
                  {row.peerAgree ?? 0}/{row.peerTotal} experts agree
                </span>
              )}
            </p>
          </section>
        )}

        {(row.copayUsd != null || row.covered != null || row.priorAuthRequired != null) && (
          <section className="cl-modal-section">
            <div className="cl-modal-section-head">
              <span className="cl-modal-section-title">Coverage</span>
            </div>
            <p className="cl-modal-line">
              {row.copayUsd != null && <span>Est. copay ${row.copayUsd}</span>}
              {row.covered === false && <span className="cl-modal-warn"> · not covered</span>}
              {row.priorAuthRequired && <span className="cl-modal-warn"> · prior auth required</span>}
            </p>
          </section>
        )}

        {row.patientSummary && (
          <section className="cl-modal-section">
            <div className="cl-modal-section-head">
              <span className="cl-modal-section-title">Patient recap</span>
            </div>
            <p className="cl-modal-recap">
              <span className="recap-quote">“</span>
              {row.patientSummary}
            </p>
          </section>
        )}
      </div>

      <footer className="cl-modal-foot">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" onClick={() => onOpenReview(row.carePlanId)}>
          Open full review <ArrowRightIcon size={14} />
        </Button>
      </footer>
    </>
  );
}
