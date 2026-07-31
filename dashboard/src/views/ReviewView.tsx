import { useState } from 'react';
import type { ApproveResult, PlanEdits, ReviewData, SaveResult } from '../useReviewData';
import type { DraftPlan, ExpertReview, MedOrder, ProtocolStep, SafetyFlag, RiskFinding } from '../types';
import type { ChartLine } from '../types';
import { usePatientNames } from '../usePatientNames';
import {
  CheckCircleIcon,
  CheckIcon,
  ExternalIcon,
  PillIcon,
  BeakerIcon,
  ShieldIcon,
  PlusIcon,
  UsersIcon,
  PulseIcon,
  ListIcon,
} from '../components/icons';
import { Avatar, Button, Card, EmptyState, Pill, type Tone } from '../components/ui';
import type { PatientContext } from '../types';
import { RxNormSelect } from '../components/RxNormSelect';
import { ScoreTrendChart, BandMeter, DeltaBadge, SeverityBar, scaleForModule, type SeverityBarSegment } from '../components/charts';
import {
  instrumentMeta,
  itemMeta,
  itemSeverity,
  itemSeverityLevel,
  type InstrumentItemMeta,
} from '../instrumentItems';
import { BAND_LABEL, BAND_TONE, CONSENSUS_LABEL, INSTRUMENT_LABEL, trendPointsFromPlan } from '../clinicalDisplay';
import { formatTime } from './format';

const MED_ROLES: MedOrder['role'][] = ['controller', 'reliever', 'rescue', 'acute-course'];

const SAFETY_TONE: Record<SafetyFlag['severity'], Tone> = {
  critical: 'red',
  warning: 'amber',
  info: 'gray',
};

/** Resolve the med list for display, falling back to the legacy single med. */
function planMeds(plan: DraftPlan): MedOrder[] {
  const list = plan.step.medications ?? [];
  if (list.length > 0) return list;
  if (plan.step.medDisplay || plan.step.medRxcui) {
    return [{ rxcui: plan.step.medRxcui ?? '', display: plan.step.medDisplay ?? '' }];
  }
  return [];
}

/** Whole years between a YYYY-MM-DD DOB and today. */
function ageFromDob(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

/** A short, friendly rendering of a YYYY-MM-DD date. */
function niceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Long LLM prose, clamped to a few lines with an inline show-more toggle. */
function Clamp({ text, lines = 3 }: { text: string; lines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 150;
  const clamp = long && !expanded;
  return (
    <>
      <p className={clamp ? 'clamp-text clamped' : 'clamp-text'} style={clamp ? { WebkitLineClamp: lines } : undefined}>
        {text}
      </p>
      {long && (
        <button type="button" className="clamp-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

/**
 * Review panel — clinician decision-support for ONE draft CarePlan. Renders the
 * plan artifact (draft plan, peer review, research, coverage) plus the live
 * charting feed, with a one-click Approve that acts on this CarePlan.
 */
export function ReviewView({ data, onBack }: { data: ReviewData; onBack: () => void }) {
  const {
    patient,
    patientId,
    draftPlan,
    chartLines,
    carePlanStatus,
    approve,
    approving,
    approveResult,
    loading,
    editing,
    edits,
    startEditing,
    cancelEditing,
    updateEdit,
    updateMed,
    addMed,
    removeMed,
    applySuggestion,
    saving,
    saveResult,
    saveEdits,
  } = data;

  // Resolve a display name from the artifact, else from the CarePlan's patient.
  const resolved = usePatientNames([patient ? undefined : patientId]);
  const patientName = patient
    ? `${patient.givenName} ${patient.familyName}`
    : (patientId && resolved[patientId]) || 'Patient';

  const backLink = (
    <button className="back-link" onClick={onBack}>
      ← Review queue
    </button>
  );

  if (!patient || !draftPlan) {
    return (
      <div className="page">
        {backLink}
        <div className="review-hero">
          <Avatar name={patientName} size={52} />
          <div className="review-hero-text">
            <h1>{patientName}</h1>
            <p className="review-hero-sub">
              {loading ? 'Loading the latest plan…' : 'No plan artifact to review yet.'}
            </p>
          </div>
        </div>
        <Card>
          <EmptyState
            icon={<BeakerIcon size={22} />}
            title="No draft plan detail yet"
            message="The AI-drafted plan artifact will appear here once the check-in call completes."
          />
        </Card>
      </div>
    );
  }

  const band = draftPlan.actResult.band;
  const instrument = INSTRUMENT_LABEL[draftPlan.conditionModuleId] ?? 'Score';
  const bandText = draftPlan.actResult.bandLabel ?? BAND_LABEL[band] ?? band;
  const bandTone: Tone = BAND_TONE[band] ?? 'gray';
  const scale = scaleForModule(draftPlan.conditionModuleId);
  const trendPoints = trendPointsFromPlan(patient, draftPlan);

  return (
    <div className="page">
      {backLink}

      <div className="review-hero">
        <Avatar name={patientName} size={52} />
        <div className="review-hero-text">
          <h1>{patient.givenName} {patient.familyName}</h1>
          <p className="review-hero-sub">
            {[
              ageFromDob(patient.dob) !== null ? `${ageFromDob(patient.dob)} yrs` : null,
              patient.sex,
              [patient.city, patient.state].filter(Boolean).join(', ') || null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {' · '}
            {patient.conditionDisplay} <code>ICD-10 {patient.conditionCode}</code>
          </p>
        </div>
        <div className="review-hero-score">
          <span className={`score-chip tone-${bandTone}`}>
            <span className="score-num">{draftPlan.actResult.total}</span>
            {instrument} · {bandText}
          </span>
          <div className="rv-hero-meter">
            <BandMeter scale={scale} total={draftPlan.actResult.total} />
          </div>
        </div>
      </div>

      {carePlanStatus === 'draft' ? (
        <div className="review-banner draft">
          <span className="live-dot" />
          Draft — awaiting your approval. AI drafted, experts reviewed; you decide.
        </div>
      ) : (
        <div className="review-banner approved">
          <CheckCircleIcon size={17} />
          Approved · CarePlan set active
          {approveResult && (
            <>
              {' '}· {approveResult.medicationsActivated} med(s) activated ·{' '}
              {approveResult.tasksCompleted} task(s) closed
            </>
          )}
        </div>
      )}

      <div className="review-grid">
        <div className="review-main">
          <PatientSnapshotCard patient={patient} />
          <Card
            title={`${instrument} trend`}
            subtitle={`${trendPoints.length} check-in${trendPoints.length === 1 ? '' : 's'} · target ${scale.target} (${scale.higherIsBetter ? '≥' : '≤'})`}
            right={<DeltaBadge points={trendPoints} scale={scale} />}
          >
            <ScoreTrendChart points={trendPoints} scale={scale} />
          </Card>
          <ItemBreakdownCard plan={draftPlan} />
          <RiskFactorsCard findings={draftPlan.riskFindings} />
          <SafetyFlagsCard flags={draftPlan.safetyFlags} />
          <DraftPlanCard
            plan={draftPlan}
            editable={carePlanStatus === 'draft'}
            editing={editing}
            edits={edits}
            saving={saving}
            saveResult={saveResult}
            onStartEditing={startEditing}
            onCancelEditing={cancelEditing}
            onUpdateEdit={updateEdit}
            onUpdateMed={updateMed}
            onAddMed={addMed}
            onRemoveMed={removeMed}
            onSave={saveEdits}
          />
          <ResearchCard plan={draftPlan} />
          <CoverageCard plan={draftPlan} />
        </div>
        <div className="review-side">
          <ApproveCard
            status={carePlanStatus}
            onApprove={approve}
            approving={approving}
            result={approveResult}
            consensus={draftPlan.peerReview?.consensus}
            safetyFlags={draftPlan.safetyFlags}
          />
          <PatientRecapCard summary={draftPlan.patientSummary} />
          <PeerReviewCard
            plan={draftPlan}
            canApply={carePlanStatus === 'draft'}
            onApply={applySuggestion}
          />
          <ChartFeed lines={chartLines} />
        </div>
      </div>
    </div>
  );
}

// ── Live charting feed (timeline) ───────────────────────────────────────────

function ChartFeed({ lines }: { lines: ChartLine[] }) {
  return (
    <Card
      title={
        <>
          <span className="live-dot" />
          Live charting
        </>
      }
      subtitle="Charted as the call progresses."
      right={<span className="count-chip">{lines.length}</span>}
    >
      <div className="feed">
        {[...lines].reverse().map((l) => (
          <div key={l.id} className={`feed-line ${l.kind}`}>
            <span className="feed-dot" />
            <div className="time">{formatTime(l.at)}</div>
            <div className="body">
              <span className={`kind-chip ${l.kind}`}>{l.kind}</span>
              {l.text}
            </div>
          </div>
        ))}
        {lines.length === 0 && <p className="hint">Waiting for charting activity…</p>}
      </div>
    </Card>
  );
}

// ── Patient / clinical summary ──────────────────────────────────────────────

function PatientSnapshotCard({ patient }: { patient: PatientContext }) {
  const age = ageFromDob(patient.dob);
  const meds = patient.currentMedications ?? [];
  const allergies = patient.allergies ?? [];
  const triggers = patient.triggers ?? [];
  const cov = patient.coverage;

  return (
    <Card icon={<UsersIcon size={18} />} title="Patient summary">
      <div className="snapshot">
        <div className="snap-facts">
          <SnapFact label="Age / sex" value={[age !== null ? `${age}` : null, patient.sex].filter(Boolean).join(' · ') || '—'} />
          <SnapFact label="Date of birth" value={niceDate(patient.dob)} />
          <SnapFact label="Location" value={[patient.city, patient.state].filter(Boolean).join(', ') || '—'} />
          <SnapFact
            label="Insurance"
            value={cov ? `${cov.payerName ?? cov.payerId}` : '—'}
            sub={cov ? `${cov.subscriberFirstName} ${cov.subscriberLastName} · ${cov.memberId}` : undefined}
          />
        </div>

        <div className="snap-block">
          <span className="snap-label">
            <ShieldIcon size={13} /> Allergies
          </span>
          <div className="chip-row">
            {allergies.length === 0 && <span className="hint">No known allergies</span>}
            {allergies.map((a) => (
              <span key={a} className="clin-chip alert">{a}</span>
            ))}
          </div>
        </div>

        <div className="snap-block">
          <span className="snap-label">Triggers</span>
          <div className="chip-row">
            {triggers.length === 0 && <span className="hint">None recorded</span>}
            {triggers.map((t) => (
              <span key={t} className="clin-chip">{t}</span>
            ))}
          </div>
        </div>

        <div className="snap-block">
          <span className="snap-label">
            <PillIcon size={13} /> Current medications
          </span>
          <div className="snap-meds">
            {meds.length === 0 && <span className="hint">None on file</span>}
            {meds.map((m) => (
              <div key={m} className="snap-med">
                <span className="snap-med-dot" />
                {m}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SnapFact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="snap-fact">
      <span className="snap-fact-label">{label}</span>
      <span className="snap-fact-value">{value}</span>
      {sub && <span className="snap-fact-sub">{sub}</span>}
    </div>
  );
}

// ── Item-level breakdown ─────────────────────────────────────────────────────

type ItemRow = {
  linkId: string;
  value: number;
  item: InstrumentItemMeta;
  severity: number;
  level: 'ok' | 'mild' | 'concern';
  sentinelEndorsed: boolean;
};

/*
 * Severity wording, not clinical judgement. "No concern" overstated the low
 * bucket: a PHQ-9 response of 1 is "several days", which is subthreshold but
 * not nothing, and labelling it away invites a reader to skip it. These read as
 * points on a scale and leave the interpretation to the clinician.
 */
const LEVEL_LABEL: Record<ItemRow['level'], string> = {
  ok: 'Low',
  mild: 'Moderate',
  concern: 'High',
};

const LEVEL_TONE: Record<ItemRow['level'], Tone> = {
  ok: 'green',
  mild: 'amber',
  concern: 'red',
};

/**
 * "Why is this score what it is?" — every instrument item as its own small
 * response-scale bar, ordered worst-first. A sentinel item (PHQ-9 self-harm,
 * item 9) that was endorsed is pinned above the rest and called out
 * distinctly, regardless of where it would otherwise sort.
 */
function ItemBreakdownCard({ plan }: { plan: DraftPlan }) {
  const meta = instrumentMeta(plan.conditionModuleId);
  const answers = plan.actResult.answers ?? [];
  if (!meta || answers.length === 0) return null;

  const rows: ItemRow[] = answers
    .map((a) => {
      const item = itemMeta(plan.conditionModuleId, a.linkId);
      if (!item) return null;
      const severity = itemSeverity(item, a.value, meta.higherIsBetter);
      const sentinelEndorsed = Boolean(item.sentinel) && a.value > item.min;
      // A sentinel item (self-harm) that was endorsed escalates on its own,
      // regardless of what the generic severity ramp says about this response.
      const level = sentinelEndorsed ? 'concern' : itemSeverityLevel(item, a.value, meta.higherIsBetter);
      return { linkId: a.linkId, value: a.value, item, severity, level, sentinelEndorsed };
    })
    .filter((r): r is ItemRow => r !== null)
    .sort((a, b) => {
      if (a.sentinelEndorsed !== b.sentinelEndorsed) return a.sentinelEndorsed ? -1 : 1;
      return b.severity - a.severity;
    });

  if (rows.length === 0) return null;

  const concernCount = rows.filter((r) => r.level === 'concern').length;
  const sentinelRow = rows.find((r) => r.sentinelEndorsed);

  return (
    <Card
      icon={<ListIcon size={18} />}
      title={`${meta.label} item breakdown`}
      subtitle="Worst-scoring items first — what's driving the total"
      right={
        <span className="count-chip">
          {sentinelRow ? 'self-harm flag' : concernCount > 0 ? `${concernCount} high concern` : `${rows.length} items`}
        </span>
      }
    >
      <div className="rv-item-list">
        {rows.map((row) => (
          <ItemBreakdownRow key={row.linkId} row={row} />
        ))}
      </div>
    </Card>
  );
}

function ItemBreakdownRow({ row }: { row: ItemRow }) {
  const [expanded, setExpanded] = useState(false);
  const { item, value, level, sentinelEndorsed } = row;
  const span = item.max - item.min || 1;
  const pct = ((Math.max(item.min, Math.min(item.max, value)) - item.min) / span) * 100;

  return (
    <div
      className={`rv-item-row level-${level} ${sentinelEndorsed ? 'sentinel' : ''}`}
      tabIndex={0}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
    >
      {sentinelEndorsed && (
        <div className="rv-item-sentinel-banner">
          <ShieldIcon size={14} />
          Self-harm thoughts endorsed — review immediately
        </div>
      )}
      <div className="rv-item-head">
        <span className="rv-item-name">{item.short}</span>
        <span className="rv-item-level">{LEVEL_LABEL[level]}</span>
        <Pill tone={LEVEL_TONE[level]} className="rv-item-value">
          {value} / {item.max}
        </Pill>
      </div>
      <div className="rv-item-track" aria-hidden="true">
        <div className={`rv-item-fill tone-${level}`} style={{ width: `${pct}%` }} />
        <div className="rv-item-marker" style={{ left: `${pct}%` }} />
      </div>
      {expanded && (
        <div className="rv-item-detail">
          <p className="rv-item-prompt">{item.prompt}</p>
          <p className="rv-item-scale">{item.scale}</p>
        </div>
      )}
    </div>
  );
}

// ── Draft CarePlan ──────────────────────────────────────────────────────────

function DraftPlanCard({
  plan,
  editable,
  editing,
  edits,
  saving,
  saveResult,
  onStartEditing,
  onCancelEditing,
  onUpdateEdit,
  onUpdateMed,
  onAddMed,
  onRemoveMed,
  onSave,
}: {
  plan: DraftPlan;
  editable: boolean;
  editing: boolean;
  edits: PlanEdits | null;
  saving: boolean;
  saveResult: SaveResult | null;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onUpdateEdit: <K extends keyof PlanEdits>(key: K, value: PlanEdits[K]) => void;
  onUpdateMed: <K extends keyof MedOrder>(key: string, field: K, value: MedOrder[K]) => void;
  onAddMed: () => void;
  onRemoveMed: (key: string) => void;
  onSave: () => void;
}) {
  const step: ProtocolStep = plan.step;
  const meds = planMeds(plan);
  const showForm = editing && edits;

  const headerRight = showForm ? (
    <div className="plan-edit-actions">
      <Button variant="ghost" size="sm" onClick={onCancelEditing} disabled={saving}>
        Cancel
      </Button>
      <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  ) : (
    <div className="plan-edit-actions">
      <Pill tone={plan.replacesCarePlanId ? 'amber' : 'accent'}>
        {plan.replacesCarePlanId ? 'revising active plan' : 'new plan'}
      </Pill>
      {editable && (
        <Button variant="secondary" size="sm" onClick={onStartEditing}>
          Edit plan
        </Button>
      )}
    </div>
  );

  return (
    <Card icon={<PillIcon size={18} />} title="Draft care plan" right={headerRight}>
      {showForm ? (
        <div className="plan-edit-form">
          <div className="med-editor">
            <span className="field-label">Medications</span>
            {edits.medications.map((m) => (
              <div key={m.key} className="med-edit-row">
                <div className="med-edit-head">
                  <RxNormSelect
                    value={{ rxcui: m.rxcui, display: m.display }}
                    onChange={(next) => {
                      onUpdateMed(m.key, 'display', next.display);
                      onUpdateMed(m.key, 'rxcui', next.rxcui);
                    }}
                    placeholder="Search RxNorm (drug name)…"
                    disabled={saving}
                  />
                  <button
                    type="button"
                    className="med-remove"
                    aria-label="Remove medication"
                    onClick={() => onRemoveMed(m.key)}
                    disabled={saving}
                  >
                    ×
                  </button>
                </div>
                <div className="med-edit-grid">
                  <label className="field">
                    <span className="field-label">Sig</span>
                    <input
                      className="field-input"
                      value={m.sig ?? ''}
                      onChange={(e) => onUpdateMed(m.key, 'sig', e.target.value)}
                      placeholder="e.g. 2 puffs twice daily"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Role</span>
                    <select
                      className="field-input"
                      value={m.role ?? ''}
                      onChange={(e) =>
                        onUpdateMed(
                          m.key,
                          'role',
                          (e.target.value || undefined) as MedOrder['role'],
                        )
                      }
                    >
                      <option value="">—</option>
                      {MED_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">Frequency</span>
                    <input
                      className="field-input"
                      value={m.frequency ?? ''}
                      onChange={(e) => onUpdateMed(m.key, 'frequency', e.target.value)}
                      placeholder="e.g. BID"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Quantity</span>
                    <input
                      className="field-input"
                      type="number"
                      min={0}
                      value={typeof m.quantity === 'number' ? m.quantity : ''}
                      onChange={(e) =>
                        onUpdateMed(
                          m.key,
                          'quantity',
                          e.target.value === '' ? undefined : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Refills</span>
                    <input
                      className="field-input"
                      type="number"
                      min={0}
                      value={typeof m.refills === 'number' ? m.refills : ''}
                      onChange={(e) =>
                        onUpdateMed(
                          m.key,
                          'refills',
                          e.target.value === '' ? undefined : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                  <label className="field med-prn">
                    <span className="field-label">PRN</span>
                    <button
                      type="button"
                      className={`med-toggle ${m.prn ? 'on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(m.prn)}
                      onClick={() => onUpdateMed(m.key, 'prn', !m.prn)}
                    >
                      <span className="med-toggle-knob" />
                    </button>
                  </label>
                </div>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="med-add" onClick={onAddMed} disabled={saving}>
              <PlusIcon size={14} /> Add medication
            </Button>
          </div>
          <label className="field">
            <span className="field-label">Follow-up interval (weeks)</span>
            <input
              className="field-input"
              type="number"
              min={0}
              value={Number.isFinite(edits.followUpWeeks) ? edits.followUpWeeks : ''}
              onChange={(e) => onUpdateEdit('followUpWeeks', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span className="field-label">Goal</span>
            <textarea
              className="field-input"
              rows={2}
              value={edits.goal}
              onChange={(e) => onUpdateEdit('goal', e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Clinician note</span>
            <textarea
              className="field-input"
              rows={3}
              value={edits.clinicianNote}
              onChange={(e) => onUpdateEdit('clinicianNote', e.target.value)}
              placeholder="Free-form note captured on the care plan…"
            />
          </label>
          {saveResult && saveResult.errors.length > 0 && (
            <div className="alert error">
              {saveResult.errors.map((err, i) => (
                <div key={i}>{err}</div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="kv-rows">
          <div className="kv-row">
            <span className="k">Medications</span>
            <div className="v med-list">
              {meds.length === 0 && <span className="hint">No medication drafted.</span>}
              {meds.map((m, i) => (
                <div key={`${m.rxcui}-${i}`} className="med-item">
                  <div className="med-item-head">
                    <span className="med-item-name">{m.display}</span>
                    {m.role && <span className={`med-role-pill role-${m.role}`}>{m.role}</span>}
                    {m.prn && <span className="med-role-pill role-prn">PRN</span>}
                  </div>
                  {m.sig && <div className="med-item-sig">{m.sig}</div>}
                  {m.rxcui && <code>RxNorm {m.rxcui}</code>}
                </div>
              ))}
            </div>
          </div>
          <Row label="Adjuncts">
            {[
              step.addOralSteroid ? 'Short oral corticosteroid course' : null,
              step.specialistReferral ? 'Specialist referral' : null,
              'Trigger-avoidance counseling',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Row>
          <Row label="Follow-up">In {step.followUpWeeks} weeks</Row>
          <Row label="Goal">{step.goal}</Row>
          {plan.concerns.length > 0 && (
            <Row label="Open concerns">{plan.concerns.map((c) => c.text).join(' ')}</Row>
          )}
        </div>
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv-row">
      <span className="k">{label}</span>
      <span className="v">{children}</span>
    </div>
  );
}

// ── Expert peer review ──────────────────────────────────────────────────────

function PeerReviewCard({
  plan,
  canApply,
  onApply,
}: {
  plan: DraftPlan;
  canApply: boolean;
  onApply: (text: string) => void;
}) {
  const review = plan.peerReview;
  if (!review) return null;
  const agree = review.reviews.filter((r) => r.verdict === 'agree').length;
  const concern = review.reviews.filter((r) => r.verdict === 'concern').length;
  const suggest = review.reviews.filter((r) => r.verdict === 'suggest-edit').length;
  const consensusTone: Tone =
    review.consensus === 'approve-as-drafted' ? 'green' : review.consensus === 'revise' ? 'red' : 'amber';
  const allSegments: SeverityBarSegment[] = [
    { key: 'agree', label: 'Agree', count: agree, tone: 'green' },
    { key: 'suggest', label: 'Suggest edit', count: suggest, tone: 'amber' },
    { key: 'concern', label: 'Concern', count: concern, tone: 'red' },
  ];
  const segments = allSegments.filter((s) => s.count > 0);
  return (
    <Card
      title="Expert peer review"
      right={<span className="count-chip">{review.reviews.length} experts</span>}
    >
      <div className="consensus-summary">
        <SeverityBar segments={segments} total={review.reviews.length} />
        <Pill tone={consensusTone}>{CONSENSUS_LABEL[review.consensus] ?? review.consensus}</Pill>
      </div>

      {review.reviews.map((r, i) => (
        // Index-suffixed: the persona key *should* be unique per panel, but it
        // arrives from generated plan data and a repeat silently drops a review.
        <ExpertRow key={`${r.expert}-${i}`} review={r} canApply={canApply} onApply={onApply} />
      ))}

      {review.flagged.length > 0 && (
        <>
          <div className="hint strong">Flagged items for clinician:</div>
          <ul className="flagged-list">
            {review.flagged.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function ExpertRow({
  review,
  canApply,
  onApply,
}: {
  review: ExpertReview;
  canApply: boolean;
  onApply: (text: string) => void;
}) {
  const tone: Tone =
    review.verdict === 'agree' ? 'green' : review.verdict === 'concern' ? 'red' : 'amber';
  const name = (review.label ?? review.expert).replace(/-/g, ' ');
  return (
    <div className="expert">
      <div className="expert-head">
        <Avatar name={name} size={34} />
        <span className="expert-name">{name}</span>
        <Pill tone={tone}>{review.verdict.replace(/-/g, ' ')}</Pill>
      </div>
      <div className="expert-rationale">
        <Clamp text={review.rationale} lines={2} />
      </div>
      {review.suggestedEdit && (
        <div className="suggested-edit">
          <span className="suggested-edit-text">Suggested: {review.suggestedEdit}</span>
          {canApply && (
            <Button
              variant="ghost"
              size="sm"
              className="suggested-edit-apply"
              onClick={() => onApply(review.suggestedEdit!)}
            >
              Apply
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Research rationale ──────────────────────────────────────────────────────

function ResearchCard({ plan }: { plan: DraftPlan }) {
  if (plan.research.length === 0) return null;
  return (
    <Card
      icon={<BeakerIcon size={18} />}
      title="Deep research rationale"
      right={<span className="count-chip">{plan.research.length} topics</span>}
    >
      {plan.research.map((f, i) => (
        <div key={i} className="research-item">
          <div className="research-topic">{f.topic}</div>
          <div className="research-rationale">
            <Clamp text={f.rationale} lines={3} />
          </div>
          <div className="citation-chips">
            {f.citations.map((c, j) => (
              <a key={j} className="citation" href={c.url} target="_blank" rel="noreferrer">
                <ExternalIcon size={12} />
                <span className="title">{c.title}</span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}

// ── Coverage / cost ─────────────────────────────────────────────────────────

function CoverageCard({ plan }: { plan: DraftPlan }) {
  const c = plan.coverage;
  if (!c) return null;
  const statusTone: Tone = !c.covered ? 'amber' : c.priorAuthRequired ? 'amber' : 'green';
  const statusText = !c.covered ? 'Not on formulary' : c.priorAuthRequired ? 'Covered · prior auth needed' : 'Covered · no prior auth';
  return (
    <Card
      icon={<ShieldIcon size={18} />}
      title="Coverage & cost"
      right={<span className="count-chip">Stedi</span>}
    >
      <div className="rv-coverage">
        <div className="rv-coverage-stat">
          <span className="rv-coverage-amt">${c.copayUsd}</span>
          <span className="rv-coverage-amt-label">estimated out-of-pocket copay</span>
        </div>
        <div className={`rv-coverage-status tone-${statusTone}`}>
          <span className="rv-coverage-status-dot" />
          {statusText}
        </div>
      </div>
      <div className="hint">{c.planName}</div>
      {c.notes && <div className="hint">{c.notes}</div>}
    </Card>
  );
}

// ── GINA future-risk findings ───────────────────────────────────────────────

const SEVERITY_RANK: Record<'critical' | 'warning' | 'info', number> = { critical: 0, warning: 1, info: 2 };

function bySeverity<T extends { severity: 'critical' | 'warning' | 'info' }>(items: T[]): T[] {
  return [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function RiskFactorsCard({ findings }: { findings?: RiskFinding[] }) {
  if (!findings || findings.length === 0) return null;
  const sorted = bySeverity(findings);
  const criticalCount = sorted.filter((f) => f.severity === 'critical').length;
  return (
    <Card
      icon={<PulseIcon size={18} />}
      title="Future-risk factors"
      subtitle="Beyond the ACT control score (GINA)"
      right={
        <span className="count-chip">
          {criticalCount > 0 ? `${criticalCount} critical` : `${sorted.length} flag(s)`}
        </span>
      }
    >
      <div className="safety-list">
        {sorted.map((f, i) => (
          <div key={i} className={`safety-flag sev-${f.severity} ${f.severity === 'critical' ? 'rv-flag-critical' : ''}`}>
            <Pill tone={SAFETY_TONE[f.severity]}>{f.severity}</Pill>
            <div className="safety-flag-body">
              <span className="safety-flag-kind">{f.label}</span>
              <span className="safety-flag-msg">{f.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Patient recap (what the patient heard / saved summary) ───────────────────

function PatientRecapCard({ summary }: { summary?: string }) {
  if (!summary) return null;
  return (
    <Card icon={<UsersIcon size={18} />} title="Patient recap" subtitle="Said at the end of the call · saved for the patient">
      <div className="patient-recap">
        <span className="recap-quote">“</span>
        <p>{summary}</p>
      </div>
    </Card>
  );
}

// ── Safety flags ────────────────────────────────────────────────────────────

function SafetyFlagsCard({ flags }: { flags?: SafetyFlag[] }) {
  if (!flags || flags.length === 0) return null;
  const sorted = bySeverity(flags);
  const criticalCount = sorted.filter((f) => f.severity === 'critical').length;
  return (
    <Card
      icon={<ShieldIcon size={18} />}
      title="Safety review"
      right={
        <span className="count-chip">
          {criticalCount > 0 ? `${criticalCount} critical` : `${sorted.length} flag(s)`}
        </span>
      }
    >
      <div className="safety-list">
        {sorted.map((f, i) => (
          <div key={i} className={`safety-flag sev-${f.severity} ${f.severity === 'critical' ? 'rv-flag-critical' : ''}`}>
            <Pill tone={SAFETY_TONE[f.severity]}>{f.severity}</Pill>
            <div className="safety-flag-body">
              <span className="safety-flag-kind">{f.kind}</span>
              <span className="safety-flag-msg">{f.message}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Approve ─────────────────────────────────────────────────────────────────

function ApproveCard({
  status,
  onApprove,
  approving,
  result,
  consensus,
  safetyFlags,
}: {
  status: string;
  onApprove: () => void;
  approving: boolean;
  result: ApproveResult | null;
  consensus?: string;
  safetyFlags?: SafetyFlag[];
}) {
  const hasErrors = Boolean(result && result.errors.length > 0);
  const criticals = (safetyFlags ?? []).filter((f) => f.severity === 'critical');
  const hasCritical = criticals.length > 0;
  const [override, setOverride] = useState(false);
  const blocked = hasCritical && !override;
  return (
    <Card title="Clinician sign-off">
      {status === 'draft' ? (
        <>
          <p className="hint">
            Panel consensus: <strong>{consensus ? CONSENSUS_LABEL[consensus] : '—'}</strong>.
            Approving activates the CarePlan and its medications, and closes the review task(s) —
            attributed to you.
          </p>
          {hasCritical && (
            <div className="safety-gate">
              <div className="safety-gate-head">
                <ShieldIcon size={15} />
                {criticals.length} critical safety alert(s) require acknowledgement
              </div>
              <label className="safety-gate-check">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                />
                <span>I've reviewed the safety alert(s)</span>
              </label>
            </div>
          )}
          <Button
            variant="primary"
            size="lg"
            full
            onClick={onApprove}
            disabled={approving || blocked}
          >
            <CheckIcon size={16} />
            {approving ? 'Approving…' : 'Approve care plan'}
          </Button>
          {hasErrors && (
            <div className="alert error">
              {result!.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="approved-state">
          <div className="approved-head">
            <CheckCircleIcon size={17} />
            Approved · active
          </div>
          {result && (
            <ul className="approve-summary">
              <li>CarePlan → active</li>
              <li>{result.medicationsActivated} medication(s) activated</li>
              <li>{result.tasksCompleted} review task(s) closed</li>
            </ul>
          )}
          {hasErrors && (
            <div className="alert warn">
              Some steps reported issues:
              {result!.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
