import { useEffect, useMemo, useState } from 'react';
import {
  fetchConditionModule,
  saveConditionModule,
  type ConditionModuleDetail,
} from '../bridge';
import type {
  ConditionModule,
  InstrumentItem,
  MedOrder,
  MossCorpusDoc,
  ProtocolStepDef,
  ScoreBand,
} from '../types';
import { BeakerIcon, ClipboardIcon, ListIcon, PillIcon, PlusIcon, ShieldIcon, SparkIcon, UsersIcon } from '../components/icons';
import { Button, Card, PageHeader } from '../components/ui';
import { RxNormSelect } from '../components/RxNormSelect';

const MED_ROLES: MedOrder['role'][] = ['controller', 'reliever', 'rescue', 'acute-course'];

/** A fresh, valid-shaped module for the create flow. */
function blankModule(): ConditionModule {
  return {
    id: '',
    label: '',
    conditionCodes: {
      icd10: { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: '', display: '' },
    },
    instrument: {
      name: '',
      panelLoinc: '',
      totalLoinc: '',
      items: [],
      direction: 'higherIsWorse',
      bands: [],
    },
    protocol: {},
    moss: { indexName: '', corpus: [] },
    agent: { globalPrompt: '' },
    researchTopicTemplate: '',
    expertPanel: [],
  };
}

/** A fresh protocol step keyed to a band. */
function blankStep(bandId: string): ProtocolStepDef {
  return {
    bandId,
    summary: '',
    medications: [],
    medRxcui: '',
    medDisplay: '',
    addOralSteroid: false,
    specialistReferral: false,
    followUpWeeks: 4,
    escalate: false,
    goal: '',
  };
}

export function TreatmentEditor({
  id,
  onBack,
  onSaved,
}: {
  /** null = create a new treatment; otherwise the id to load and edit. */
  id: string | null;
  onBack: () => void;
  onSaved: () => void;
}) {
  const isCreate = id === null;
  const [module, setModule] = useState<ConditionModule | null>(isCreate ? blankModule() : null);
  const [builtIn, setBuiltIn] = useState(false);
  const [loading, setLoading] = useState(!isCreate);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const retryLoad = () => setReloadNonce((n) => n + 1);

  useEffect(() => {
    if (isCreate) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchConditionModule(id)
      .then((m: ConditionModuleDetail) => {
        if (cancelled) return;
        const { builtIn: bi, ...rest } = m;
        setBuiltIn(Boolean(bi));
        setModule(rest);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isCreate, reloadNonce]);

  const validationError = useMemo(
    () => (module ? validate(module) : null),
    [module],
  );

  const backLink = (
    <button className="back-link" onClick={onBack}>
      ← Treatments
    </button>
  );

  if (loadError) {
    return (
      <div className="page">
        {backLink}
        <PageHeader title="Couldn't load this treatment" />
        <Card>
          <div className="wf-tx-load-error">
            <ShieldIcon size={22} />
            <div>
              <p>{loadError}</p>
              <p className="hint">Check that the bridge is running, then try again.</p>
            </div>
            <Button variant="secondary" onClick={retryLoad}>
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (loading || !module) {
    return (
      <div className="page">
        {backLink}
        <PageHeader title="Loading treatment…" />
      </div>
    );
  }

  // ── Mutators (all operate on a shallow clone to stay immutable) ────────────
  const set = (next: ConditionModule) => setModule(next);
  const patch = (partial: Partial<ConditionModule>) => set({ ...module, ...partial });

  const onSave = async () => {
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveConditionModule(module, { create: isCreate });
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      {backLink}
      <PageHeader
        title={isCreate ? 'New treatment' : `Edit ${module.label || module.id}`}
        subtitle={
          isCreate
            ? 'Define the condition module that drives intake, scoring, and care plans.'
            : builtIn
              ? 'Built-in treatment — edits will be persisted as an override.'
              : 'Custom treatment.'
        }
        action={
          <div className="tx-head-actions">
            <Button variant="ghost" onClick={onBack} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : isCreate ? 'Create treatment' : 'Save changes'}
            </Button>
          </div>
        }
      />

      {/* ── At-a-glance summary — scannable before diving into any section ─── */}
      <div className="wf-tx-glance">
        <GlanceStat icon={<ListIcon size={16} />} value={module.instrument.items.length} label="Instrument items" />
        <GlanceStat icon={<ShieldIcon size={16} />} value={module.instrument.bands.length} label="Score bands" />
        <GlanceStat icon={<BeakerIcon size={16} />} value={module.moss.corpus.length} label="Corpus docs" />
        <GlanceStat icon={<UsersIcon size={16} />} value={module.expertPanel.length} label="Expert panel" />
      </div>

      {/* ── Basics ─────────────────────────────────────────────────────────── */}
      <Card icon={<ClipboardIcon size={18} />} title="Basics">
        <div className="form-grid two">
          <Field label="Id">
            <input
              className="field-input"
              value={module.id}
              disabled={!isCreate}
              placeholder="e.g. copd"
              onChange={(e) => patch({ id: e.target.value })}
            />
          </Field>
          <Field label="Label">
            <input
              className="field-input"
              value={module.label}
              placeholder="e.g. COPD"
              onChange={(e) => patch({ label: e.target.value })}
            />
          </Field>
        </div>

        <div className="tx-subhead">ICD-10 code</div>
        <div className="form-grid three">
          <Field label="System">
            <input
              className="field-input"
              value={module.conditionCodes.icd10.system}
              onChange={(e) =>
                patch({
                  conditionCodes: {
                    ...module.conditionCodes,
                    icd10: { ...module.conditionCodes.icd10, system: e.target.value },
                  },
                })
              }
            />
          </Field>
          <Field label="Code">
            <input
              className="field-input"
              value={module.conditionCodes.icd10.code}
              placeholder="e.g. J44.9"
              onChange={(e) =>
                patch({
                  conditionCodes: {
                    ...module.conditionCodes,
                    icd10: { ...module.conditionCodes.icd10, code: e.target.value },
                  },
                })
              }
            />
          </Field>
          <Field label="Display">
            <input
              className="field-input"
              value={module.conditionCodes.icd10.display}
              onChange={(e) =>
                patch({
                  conditionCodes: {
                    ...module.conditionCodes,
                    icd10: { ...module.conditionCodes.icd10, display: e.target.value },
                  },
                })
              }
            />
          </Field>
        </div>

        <div className="tx-subhead">
          SNOMED code · optional
          {module.conditionCodes.snomed ? (
            <button
              type="button"
              className="tx-inline-remove"
              onClick={() =>
                patch({ conditionCodes: { icd10: module.conditionCodes.icd10 } })
              }
            >
              Remove
            </button>
          ) : (
            <button
              type="button"
              className="tx-inline-add"
              onClick={() =>
                patch({
                  conditionCodes: {
                    ...module.conditionCodes,
                    snomed: {
                      system: 'http://snomed.info/sct',
                      code: '',
                      display: '',
                    },
                  },
                })
              }
            >
              Add SNOMED
            </button>
          )}
        </div>
        {module.conditionCodes.snomed && (
          <div className="form-grid three">
            <Field label="System">
              <input
                className="field-input"
                value={module.conditionCodes.snomed.system}
                onChange={(e) =>
                  patch({
                    conditionCodes: {
                      ...module.conditionCodes,
                      snomed: { ...module.conditionCodes.snomed!, system: e.target.value },
                    },
                  })
                }
              />
            </Field>
            <Field label="Code">
              <input
                className="field-input"
                value={module.conditionCodes.snomed.code}
                onChange={(e) =>
                  patch({
                    conditionCodes: {
                      ...module.conditionCodes,
                      snomed: { ...module.conditionCodes.snomed!, code: e.target.value },
                    },
                  })
                }
              />
            </Field>
            <Field label="Display">
              <input
                className="field-input"
                value={module.conditionCodes.snomed.display}
                onChange={(e) =>
                  patch({
                    conditionCodes: {
                      ...module.conditionCodes,
                      snomed: { ...module.conditionCodes.snomed!, display: e.target.value },
                    },
                  })
                }
              />
            </Field>
          </div>
        )}
      </Card>

      {/* ── Instrument ─────────────────────────────────────────────────────── */}
      <Card
        icon={<ListIcon size={18} />}
        title="Instrument"
        subtitle="The questionnaire the voice agent administers."
        right={<span className="count-chip">{module.instrument.items.length} item{module.instrument.items.length === 1 ? '' : 's'}</span>}
      >
        <div className="form-grid two">
          <Field label="Name">
            <input
              className="field-input"
              value={module.instrument.name}
              placeholder="e.g. CAT"
              onChange={(e) =>
                patch({ instrument: { ...module.instrument, name: e.target.value } })
              }
            />
          </Field>
          <Field label="Direction">
            <select
              className="field-input"
              value={module.instrument.direction}
              onChange={(e) =>
                patch({
                  instrument: {
                    ...module.instrument,
                    direction: e.target.value as ConditionModule['instrument']['direction'],
                  },
                })
              }
            >
              <option value="higherIsWorse">Higher is worse</option>
              <option value="higherIsBetter">Higher is better</option>
            </select>
          </Field>
          <Field label="Panel LOINC">
            <input
              className="field-input"
              value={module.instrument.panelLoinc}
              onChange={(e) =>
                patch({ instrument: { ...module.instrument, panelLoinc: e.target.value } })
              }
            />
          </Field>
          <Field label="Total LOINC">
            <input
              className="field-input"
              value={module.instrument.totalLoinc}
              onChange={(e) =>
                patch({ instrument: { ...module.instrument, totalLoinc: e.target.value } })
              }
            />
          </Field>
        </div>

        <div className="tx-subhead">Items</div>
        {module.instrument.items.map((item, i) => (
          <div key={i} className="tx-row">
            <div className="tx-row-head">
              <span className="tx-row-index">Item {i + 1}</span>
              <button
                type="button"
                className="med-remove"
                aria-label="Remove item"
                onClick={() => {
                  const items = module.instrument.items.filter((_, j) => j !== i);
                  patch({ instrument: { ...module.instrument, items } });
                }}
              >
                ×
              </button>
            </div>
            <Field label="Prompt">
              <input
                className="field-input"
                value={item.prompt}
                onChange={(e) => updateItem(module, patch, i, { prompt: e.target.value })}
              />
            </Field>
            <div className="form-grid three">
              <Field label="Link id">
                <input
                  className="field-input"
                  value={item.linkId}
                  onChange={(e) => updateItem(module, patch, i, { linkId: e.target.value })}
                />
              </Field>
              <Field label="LOINC">
                <input
                  className="field-input"
                  value={item.loinc}
                  onChange={(e) => updateItem(module, patch, i, { loinc: e.target.value })}
                />
              </Field>
              <Field label="Scale">
                <input
                  className="field-input"
                  value={item.scale}
                  placeholder="e.g. 0–5"
                  onChange={(e) => updateItem(module, patch, i, { scale: e.target.value })}
                />
              </Field>
              <Field label="Min">
                <input
                  className="field-input"
                  type="number"
                  value={item.min}
                  onChange={(e) => updateItem(module, patch, i, { min: Number(e.target.value) })}
                />
              </Field>
              <Field label="Max">
                <input
                  className="field-input"
                  type="number"
                  value={item.max}
                  onChange={(e) => updateItem(module, patch, i, { max: Number(e.target.value) })}
                />
              </Field>
            </div>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="med-add"
          onClick={() => {
            const item: InstrumentItem = {
              linkId: '',
              loinc: '',
              prompt: '',
              scale: '',
              min: 0,
              max: 5,
            };
            patch({
              instrument: { ...module.instrument, items: [...module.instrument.items, item] },
            });
          }}
        >
          <PlusIcon size={14} /> Add item
        </Button>
      </Card>

      {/* ── Bands ──────────────────────────────────────────────────────────── */}
      <div className="wf-tx-linked-group">
      <Card
        icon={<ShieldIcon size={18} />}
        title="Score bands"
        subtitle="Each band must have a matching protocol step below — they are kept in sync automatically."
        right={<span className="count-chip">{module.instrument.bands.length} band{module.instrument.bands.length === 1 ? '' : 's'}</span>}
      >
        {module.instrument.bands.map((band, i) => (
          <div key={i} className="tx-band-row">
            <Field label="Id">
              <input
                className="field-input"
                value={band.id}
                onChange={(e) => renameBand(module, set, i, e.target.value)}
              />
            </Field>
            <Field label="Label">
              <input
                className="field-input"
                value={band.label}
                onChange={(e) => updateBand(module, set, i, { label: e.target.value })}
              />
            </Field>
            <Field label="Min">
              <input
                className="field-input"
                type="number"
                value={band.min}
                onChange={(e) => updateBand(module, set, i, { min: Number(e.target.value) })}
              />
            </Field>
            <Field label="Max">
              <input
                className="field-input"
                type="number"
                value={band.max}
                onChange={(e) => updateBand(module, set, i, { max: Number(e.target.value) })}
              />
            </Field>
            <button
              type="button"
              className="med-remove tx-band-remove"
              aria-label="Remove band"
              onClick={() => removeBand(module, set, i)}
            >
              ×
            </button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="med-add"
          onClick={() => addBand(module, set)}
        >
          <PlusIcon size={14} /> Add band
        </Button>
      </Card>

      {/* ── Protocol (one step per band) ───────────────────────────────────── */}
      <div className="wf-tx-linked-connector" aria-hidden="true">
        <span>↕ kept in sync with the bands above</span>
      </div>
      <Card icon={<PillIcon size={18} />} title="Protocol" subtitle="The deterministic care-plan step recommended per band.">
        {module.instrument.bands.length === 0 && (
          <p className="hint">Add a score band above to define its protocol step.</p>
        )}
        {module.instrument.bands.map((band) => {
          const step = module.protocol[band.id] ?? blankStep(band.id);
          const updateStep = (partial: Partial<ProtocolStepDef>) =>
            patch({
              protocol: { ...module.protocol, [band.id]: { ...step, ...partial, bandId: band.id } },
            });
          return (
            <div key={band.id} className="tx-protocol-step">
              <div className="tx-protocol-head">
                <span className="cell-name">{band.label || band.id}</span>
                <code>{band.id}</code>
              </div>
              <Field label="Summary">
                <textarea
                  className="field-input"
                  rows={2}
                  value={step.summary}
                  onChange={(e) => updateStep({ summary: e.target.value })}
                />
              </Field>

              <div className="med-editor">
                <span className="field-label">Medications</span>
                {(step.medications ?? []).map((m, mi) => (
                  <div key={mi} className="med-edit-row">
                    <div className="med-edit-head">
                      <RxNormSelect
                        value={{ rxcui: m.rxcui, display: m.display }}
                        onChange={(next) =>
                          updateMed(step, updateStep, mi, {
                            rxcui: next.rxcui,
                            display: next.display,
                          })
                        }
                        placeholder="Search RxNorm (drug name)…"
                      />
                      <button
                        type="button"
                        className="med-remove"
                        aria-label="Remove medication"
                        onClick={() =>
                          updateStep({
                            medications: (step.medications ?? []).filter((_, j) => j !== mi),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                    <div className="med-edit-grid">
                      <label className="field">
                        <span className="field-label">Role</span>
                        <select
                          className="field-input"
                          value={m.role ?? ''}
                          onChange={(e) =>
                            updateMed(step, updateStep, mi, {
                              role: (e.target.value || undefined) as MedOrder['role'],
                            })
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
                        <span className="field-label">Sig</span>
                        <input
                          className="field-input"
                          value={m.sig ?? ''}
                          placeholder="e.g. 2 puffs twice daily"
                          onChange={(e) => updateMed(step, updateStep, mi, { sig: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Route</span>
                        <input
                          className="field-input"
                          value={m.route ?? ''}
                          placeholder="e.g. inhaled"
                          onChange={(e) =>
                            updateMed(step, updateStep, mi, { route: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Frequency</span>
                        <input
                          className="field-input"
                          value={m.frequency ?? ''}
                          placeholder="e.g. BID"
                          onChange={(e) =>
                            updateMed(step, updateStep, mi, { frequency: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Duration (days)</span>
                        <input
                          className="field-input"
                          type="number"
                          min={0}
                          value={typeof m.durationDays === 'number' ? m.durationDays : ''}
                          onChange={(e) =>
                            updateMed(step, updateStep, mi, {
                              durationDays:
                                e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
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
                            updateMed(step, updateStep, mi, {
                              quantity: e.target.value === '' ? undefined : Number(e.target.value),
                            })
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
                            updateMed(step, updateStep, mi, {
                              refills: e.target.value === '' ? undefined : Number(e.target.value),
                            })
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
                          onClick={() => updateMed(step, updateStep, mi, { prn: !m.prn })}
                        >
                          <span className="med-toggle-knob" />
                        </button>
                      </label>
                    </div>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="med-add"
                  onClick={() =>
                    updateStep({
                      medications: [
                        ...(step.medications ?? []),
                        { rxcui: '', display: '' },
                      ],
                    })
                  }
                >
                  <PlusIcon size={14} /> Add medication
                </Button>
              </div>

              <div className="tx-protocol-toggles">
                <ToggleField
                  label="Add oral steroid"
                  checked={Boolean(step.addOralSteroid)}
                  onChange={(v) => updateStep({ addOralSteroid: v })}
                />
                <ToggleField
                  label="Specialist referral"
                  checked={Boolean(step.specialistReferral)}
                  onChange={(v) => updateStep({ specialistReferral: v })}
                />
                <ToggleField
                  label="Escalate"
                  checked={step.escalate}
                  onChange={(v) => updateStep({ escalate: v })}
                />
              </div>
              <div className="form-grid two">
                <Field label="Follow-up (weeks)">
                  <input
                    className="field-input"
                    type="number"
                    min={0}
                    value={Number.isFinite(step.followUpWeeks) ? step.followUpWeeks : ''}
                    onChange={(e) => updateStep({ followUpWeeks: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <Field label="Goal">
                <textarea
                  className="field-input"
                  rows={2}
                  value={step.goal}
                  onChange={(e) => updateStep({ goal: e.target.value })}
                />
              </Field>
            </div>
          );
        })}
      </Card>
      </div>

      {/* ── Moss corpus ────────────────────────────────────────────────────── */}
      <Card
        icon={<BeakerIcon size={18} />}
        title="Knowledge corpus (Moss)"
        subtitle="Grounding documents for the plan drafter."
        right={<span className="count-chip">{module.moss.corpus.length} doc{module.moss.corpus.length === 1 ? '' : 's'}</span>}
      >
        <Field label="Index name">
          <input
            className="field-input"
            value={module.moss.indexName}
            onChange={(e) => patch({ moss: { ...module.moss, indexName: e.target.value } })}
          />
        </Field>
        <div className="tx-subhead">Documents</div>
        {module.moss.corpus.map((doc, i) => (
          <div key={i} className="tx-row">
            <div className="tx-row-head">
              <span className="tx-row-index">Doc {i + 1}</span>
              <button
                type="button"
                className="med-remove"
                aria-label="Remove document"
                onClick={() =>
                  patch({
                    moss: {
                      ...module.moss,
                      corpus: module.moss.corpus.filter((_, j) => j !== i),
                    },
                  })
                }
              >
                ×
              </button>
            </div>
            <div className="form-grid two">
              <Field label="Id">
                <input
                  className="field-input"
                  value={doc.id}
                  onChange={(e) => updateCorpus(module, patch, i, { id: e.target.value })}
                />
              </Field>
              <Field label="Source">
                <input
                  className="field-input"
                  value={doc.source}
                  onChange={(e) => updateCorpus(module, patch, i, { source: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Text">
              <textarea
                className="field-input"
                rows={3}
                value={doc.text}
                onChange={(e) => updateCorpus(module, patch, i, { text: e.target.value })}
              />
            </Field>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="med-add"
          onClick={() => {
            const doc: MossCorpusDoc = { id: '', text: '', source: '' };
            patch({ moss: { ...module.moss, corpus: [...module.moss.corpus, doc] } });
          }}
        >
          <PlusIcon size={14} /> Add document
        </Button>
      </Card>

      {/* ── Agent + research ───────────────────────────────────────────────── */}
      <Card icon={<SparkIcon size={18} />} title="Voice agent">
        <Field label="Global prompt">
          <textarea
            className="field-input"
            rows={6}
            value={module.agent.globalPrompt}
            onChange={(e) => patch({ agent: { globalPrompt: e.target.value } })}
          />
        </Field>
      </Card>

      <Card icon={<ListIcon size={18} />} title="Research topic template">
        <Field label="Template">
          <textarea
            className="field-input"
            rows={3}
            value={module.researchTopicTemplate}
            onChange={(e) => patch({ researchTopicTemplate: e.target.value })}
          />
        </Field>
        <p className="hint">
          Placeholders: <code>{'{{conditionDisplay}}'}</code> <code>{'{{triggers}}'}</code>{' '}
          <code>{'{{bandLabel}}'}</code> <code>{'{{total}}'}</code>
        </p>
      </Card>

      {/* ── Expert panel ───────────────────────────────────────────────────── */}
      <Card
        icon={<UsersIcon size={18} />}
        title="Expert panel"
        subtitle="Personas that peer-review each draft plan."
        right={<span className="count-chip">{module.expertPanel.length} expert{module.expertPanel.length === 1 ? '' : 's'}</span>}
      >
        {module.expertPanel.map((expert, i) => (
          <div key={i} className="tx-row">
            <div className="tx-row-head">
              <span className="tx-row-index">Expert {i + 1}</span>
              <button
                type="button"
                className="med-remove"
                aria-label="Remove expert"
                onClick={() =>
                  patch({ expertPanel: module.expertPanel.filter((_, j) => j !== i) })
                }
              >
                ×
              </button>
            </div>
            <div className="form-grid two">
              <Field label="Key">
                <input
                  className="field-input"
                  value={expert.key}
                  placeholder="e.g. pulmonology"
                  onChange={(e) => updateExpert(module, patch, i, { key: e.target.value })}
                />
              </Field>
              <Field label="Label">
                <input
                  className="field-input"
                  value={expert.label}
                  onChange={(e) => updateExpert(module, patch, i, { label: e.target.value })}
                />
              </Field>
            </div>
            <Field label="System prompt">
              <textarea
                className="field-input"
                rows={3}
                value={expert.systemPrompt}
                onChange={(e) => updateExpert(module, patch, i, { systemPrompt: e.target.value })}
              />
            </Field>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="med-add"
          onClick={() =>
            patch({
              expertPanel: [...module.expertPanel, { key: '', label: '', systemPrompt: '' }],
            })
          }
        >
          <PlusIcon size={14} /> Add expert
        </Button>
      </Card>

      {/* ── Current medication ─────────────────────────────────────────────── */}
      <Card icon={<PillIcon size={18} />} title="Current medication" subtitle="Optional baseline medication for this condition.">
        <RxNormSelect
          value={{
            rxcui: module.currentMedication?.rxcui ?? '',
            display: module.currentMedication?.display ?? '',
          }}
          onChange={(next) =>
            patch({
              currentMedication:
                next.rxcui || next.display
                  ? { rxcui: next.rxcui, display: next.display }
                  : undefined,
            })
          }
          placeholder="Search RxNorm (optional)…"
        />
      </Card>

      {validationError && <div className="alert warn">{validationError}</div>}
      {saveError && <div className="alert error">{saveError}</div>}

      <div className="tx-footer-actions">
        <Button variant="ghost" onClick={onBack} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : isCreate ? 'Create treatment' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────

function GlanceStat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="wf-tx-glance-stat">
      <span className="wf-tx-glance-icon">{icon}</span>
      <span className="wf-tx-glance-value">{value}</span>
      <span className="wf-tx-glance-label">{label}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field med-prn">
      <span className="field-label">{label}</span>
      <button
        type="button"
        className={`med-toggle ${checked ? 'on' : ''}`}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span className="med-toggle-knob" />
      </button>
    </label>
  );
}

function updateItem(
  module: ConditionModule,
  patch: (p: Partial<ConditionModule>) => void,
  i: number,
  partial: Partial<InstrumentItem>,
) {
  const items = module.instrument.items.map((it, j) => (j === i ? { ...it, ...partial } : it));
  patch({ instrument: { ...module.instrument, items } });
}

function updateCorpus(
  module: ConditionModule,
  patch: (p: Partial<ConditionModule>) => void,
  i: number,
  partial: Partial<MossCorpusDoc>,
) {
  const corpus = module.moss.corpus.map((d, j) => (j === i ? { ...d, ...partial } : d));
  patch({ moss: { ...module.moss, corpus } });
}

function updateExpert(
  module: ConditionModule,
  patch: (p: Partial<ConditionModule>) => void,
  i: number,
  partial: Partial<ConditionModule['expertPanel'][number]>,
) {
  const expertPanel = module.expertPanel.map((e, j) => (j === i ? { ...e, ...partial } : e));
  patch({ expertPanel });
}

function updateMed(
  step: ProtocolStepDef,
  updateStep: (p: Partial<ProtocolStepDef>) => void,
  i: number,
  partial: Partial<MedOrder>,
) {
  const medications = (step.medications ?? []).map((m, j) =>
    j === i ? { ...m, ...partial } : m,
  );
  updateStep({ medications });
}

// ── Band ⇄ protocol-key syncing ──────────────────────────────────────────────

function addBand(module: ConditionModule, set: (m: ConditionModule) => void) {
  const band: ScoreBand = { id: uniqueBandId(module), label: '', min: 0, max: 0 };
  set({
    ...module,
    instrument: { ...module.instrument, bands: [...module.instrument.bands, band] },
    protocol: { ...module.protocol, [band.id]: blankStep(band.id) },
  });
}

function updateBand(
  module: ConditionModule,
  set: (m: ConditionModule) => void,
  i: number,
  partial: Partial<ScoreBand>,
) {
  const bands = module.instrument.bands.map((b, j) => (j === i ? { ...b, ...partial } : b));
  set({ ...module, instrument: { ...module.instrument, bands } });
}

/** Rename a band and carry its protocol step over to the new key. */
function renameBand(
  module: ConditionModule,
  set: (m: ConditionModule) => void,
  i: number,
  nextId: string,
) {
  const prev = module.instrument.bands[i];
  if (!prev) return;
  const bands = module.instrument.bands.map((b, j) => (j === i ? { ...b, id: nextId } : b));
  const protocol = { ...module.protocol };
  const step = protocol[prev.id] ?? blankStep(nextId);
  delete protocol[prev.id];
  if (nextId) protocol[nextId] = { ...step, bandId: nextId };
  set({ ...module, instrument: { ...module.instrument, bands }, protocol });
}

function removeBand(module: ConditionModule, set: (m: ConditionModule) => void, i: number) {
  const removed = module.instrument.bands[i];
  const bands = module.instrument.bands.filter((_, j) => j !== i);
  const protocol = { ...module.protocol };
  if (removed) delete protocol[removed.id];
  set({ ...module, instrument: { ...module.instrument, bands }, protocol });
}

function uniqueBandId(module: ConditionModule): string {
  const taken = new Set(module.instrument.bands.map((b) => b.id));
  let n = module.instrument.bands.length + 1;
  let id = `band-${n}`;
  while (taken.has(id)) id = `band-${++n}`;
  return id;
}

// ── Client-side validation (mirrors the bridge rules) ────────────────────────

function validate(m: ConditionModule): string | null {
  if (!m.id.trim()) return 'An id is required.';
  if (!m.label.trim()) return 'A label is required.';
  if (!m.conditionCodes.icd10.code.trim()) return 'An ICD-10 code is required.';
  if (m.instrument.items.length === 0) return 'Add at least one instrument item.';
  if (m.instrument.bands.length === 0) return 'Add at least one score band.';
  if (!m.agent.globalPrompt.trim()) return 'The agent global prompt is required.';
  if (typeof m.researchTopicTemplate !== 'string')
    return 'The research topic template must be text.';
  if (!m.moss.indexName.trim()) return 'A Moss index name is required.';
  for (const band of m.instrument.bands) {
    if (!band.id.trim()) return 'Every band needs an id.';
    if (!m.protocol[band.id]) return `Band "${band.id}" is missing its protocol step.`;
  }
  return null;
}
