/**
 * Aggregate queue visualizations — "how is my whole panel doing?"
 *
 * Each instrument gets its own honest small-multiple: ACT and PHQ-9 are
 * different instruments on different scales, so they are never merged into
 * one shared distribution bar. Peer consensus keeps its own severity bar.
 * Metrics are actionable counts, never a cross-patient average.
 */
import { useState } from 'react';
import type { ReviewQueueRow } from '../types';
import { CONSENSUS_LABEL, CONSENSUS_TONE } from '../clinicalDisplay';
import { scaleForModule, bandForScore, SeverityBar, type SeverityBarSegment } from './charts';
import { clamp, toneVar } from './charts/utils';
import { Card } from './ui';

type InstrumentGroup = {
  moduleId: string;
  patients: { patientId: string; name: string; scoreTotal: number }[];
};

function groupByInstrument(
  rows: ReviewQueueRow[],
  names: Record<string, string>,
): InstrumentGroup[] {
  const map = new Map<string, InstrumentGroup['patients']>();
  for (const r of rows) {
    if (!r.conditionModuleId || r.scoreTotal == null) continue;
    const list = map.get(r.conditionModuleId) ?? [];
    list.push({
      patientId: r.patientId ?? r.carePlanId,
      name: (r.patientId && names[r.patientId]) || 'Patient',
      scoreTotal: r.scoreTotal,
    });
    map.set(r.conditionModuleId, list);
  }
  return Array.from(map.entries()).map(([moduleId, patients]) => ({ moduleId, patients }));
}

function consensusSegments(rows: ReviewQueueRow[]): SeverityBarSegment[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r.peerConsensus) continue;
    map.set(r.peerConsensus, (map.get(r.peerConsensus) ?? 0) + 1);
  }
  return ['approve-as-drafted', 'approve-with-notes', 'revise']
    .filter((k) => map.has(k))
    .map((k) => ({
      key: k,
      label: CONSENSUS_LABEL[k] ?? k,
      count: map.get(k)!,
      tone: (CONSENSUS_TONE[k] as SeverityBarSegment['tone']) ?? 'gray',
    }));
}

function InstrumentRow({ moduleId, patients }: InstrumentGroup) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const scale = scaleForModule(moduleId);
  const span = scale.max - scale.min || 1;
  const pct = (v: number) => (clamp(v, scale.min, scale.max) - scale.min) / span;
  const active = patients.find((p) => p.patientId === activeId) ?? null;
  const activeBand = active ? bandForScore(scale, active.scoreTotal) : null;

  return (
    <div className="qi-row">
      <div className="qi-row-head">
        <span className="qi-row-title">
          {scale.instrumentLong} <span className="qi-row-code">({scale.instrument})</span>
        </span>
        <span className="hint">
          {patients.length} patient{patients.length === 1 ? '' : 's'}
        </span>
      </div>
      <div
        className="qi-track"
        role="img"
        aria-label={`${scale.instrument} scores for ${patients.length} patients: ${patients
          .map((p) => `${p.name} ${p.scoreTotal}`)
          .join(', ')}`}
      >
        {scale.bands.map((b) => {
          const widthPct = ((b.max - b.min + 1) / (span + 1)) * 100;
          return (
            <span
              key={b.id}
              className="qi-track-band"
              style={{ width: `${widthPct}%`, background: toneVar(b.tone).bg }}
            />
          );
        })}
        {patients.map((p) => (
          <button
            key={p.patientId}
            type="button"
            className={`qi-dot ${activeId === p.patientId ? 'active' : ''}`}
            style={{ left: `${pct(p.scoreTotal) * 100}%` }}
            onMouseEnter={() => setActiveId(p.patientId)}
            onMouseLeave={() => setActiveId((a) => (a === p.patientId ? null : a))}
            onFocus={() => setActiveId(p.patientId)}
            onBlur={() => setActiveId((a) => (a === p.patientId ? null : a))}
            aria-label={`${p.name}: ${scale.instrument} ${p.scoreTotal} of ${scale.max} — ${
              bandForScore(scale, p.scoreTotal).label
            }`}
          />
        ))}
        {active && activeBand && (
          <div className="qi-tooltip" style={{ left: `${pct(active.scoreTotal) * 100}%` }}>
            <b>{active.name}</b>
            <span>
              {scale.instrument} {active.scoreTotal} · {activeBand.label}
            </span>
          </div>
        )}
      </div>
      <div className="qi-legend">
        {scale.bands.map((b) => (
          <span key={b.id} className="qi-legend-item">
            <span className="qi-legend-dot" style={{ background: toneVar(b.tone).ink }} />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function QueueInsightsPanel({
  rows,
  names = {},
}: {
  rows: ReviewQueueRow[];
  names?: Record<string, string>;
}) {
  const withArtifact = rows.filter((r) => r.hasArtifact);
  if (withArtifact.length === 0) return null;

  const instrumentGroups = groupByInstrument(withArtifact, names);
  const consensus = consensusSegments(withArtifact);

  const criticalFlags = withArtifact.reduce(
    (s, r) => s + (r.safetyCritical ?? 0) + (r.riskCritical ?? 0),
    0,
  );
  const coverageBlocked = withArtifact.filter(
    (r) => r.priorAuthRequired || r.covered === false,
  ).length;
  const missingIntake = rows.filter((r) => !r.hasArtifact).length;

  return (
    <div className="queue-insights">
      <Card title="Queue at a glance" subtitle="Clinical picture across draft plans with intake data">
        {instrumentGroups.length > 0 && (
          <div className="qi-instruments">
            {instrumentGroups.map((g) => (
              <InstrumentRow key={g.moduleId} {...g} />
            ))}
          </div>
        )}

        <div className="qi-secondary">
          <div className="qi-block">
            <div className="qi-row-head">
              <span className="qi-row-title">Expert consensus</span>
              <span className="hint">peer panel</span>
            </div>
            {consensus.length === 0 ? (
              <p className="hint">No peer review on file yet.</p>
            ) : (
              <SeverityBar segments={consensus} />
            )}
          </div>

          <div className="qi-block qi-metrics">
            <div className="queue-metric">
              <span className="queue-metric-val">{criticalFlags}</span>
              <span className="queue-metric-label">Critical flags</span>
            </div>
            <div className="queue-metric">
              <span className="queue-metric-val">{coverageBlocked}</span>
              <span className="queue-metric-label">Coverage blocked</span>
            </div>
            <div className="queue-metric">
              <span className="queue-metric-val">{missingIntake}</span>
              <span className="queue-metric-label">Awaiting intake</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
