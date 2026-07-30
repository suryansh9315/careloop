/**
 * Offline end-to-end proof: runs the full CareLoop pipeline with NO phone and NO
 * credentials (every integration falls back to its mock). Exercises:
 *   interview (chartLive ×5 + a Moss Q&A + an open concern) → submitQuestionnaire
 *   → QuestionnaireResponse → Bot (score → protocol → n=1 draft plan)
 *   → deep research + expert peer review + Stedi coverage.
 *
 * Run: npm run simulate
 */
import { config } from '../src/config.js';
import {
  demoPatientContext,
  SCRIPTED_ACT_ANSWERS,
  SCRIPTED_CONCERNS,
  SCRIPTED_QUESTION,
} from '../src/demo.js';
import { defaultToolDeps, newSession, runTool } from '../src/orchestration/tools.js';
import { renderSystemPrompt } from '../src/orchestration/prompt-renderer.js';
import { FlowStateMachine } from '../src/orchestration/state-machine.js';
import { buildIntakeFlow, buildDynamicVars } from '../src/conditions/types.js';
import { requireCondition } from '../src/conditions/registry.js';
import { buildDraftPlan, type PostCallDeps } from '../src/bot/questionnaire-response.js';
import type { ConditionModule } from '../src/conditions/types.js';
import { researchPlan } from '../src/workers/research.js';
import { peerReview } from '../src/workers/expert-panel.js';
import { getCoverageClient } from '../src/integrations/stedi.js';
import { llmEnabled, llmLabel } from '../src/integrations/llm.js';

const hr = (t: string) => console.log(`\n${'─'.repeat(72)}\n▶ ${t}\n${'─'.repeat(72)}`);

/** Answers to drive the interview: asthma uses the scripted narrative; other
 * conditions get generated answers that land in a meaningful (higher-severity) band. */
function scriptedAnswers(module: ConditionModule): { linkId: string; value: number; note: string }[] {
  if (module.id === 'asthma') return SCRIPTED_ACT_ANSWERS;
  return module.instrument.items.map((it) => ({
    linkId: it.linkId,
    value: module.instrument.direction === 'higherIsWorse' ? Math.max(it.min, it.max - 1) : it.min + 1,
    note: 'reported during check-in',
  }));
}

async function main() {
  // Pick the condition module to simulate (env CONDITION_ID or default 'asthma').
  const conditionId = process.env.CONDITION_ID?.trim() || 'asthma';
  const module = requireCondition(conditionId);

  // Use the real seeded patient when Medplum + SEED ids are configured (so the
  // pipeline persists real FHIR); otherwise the offline demo fixture.
  const patient =
    config.medplum.enabled && config.seed.patientId
      ? await (await import('../src/medplum/seed.js')).loadPatientContext(config.seed.patientId)
      : demoPatientContext();
  patient.conditionModuleId = module.id;
  const flow = buildIntakeFlow(module);
  const vars = buildDynamicVars(patient);

  hr('CareLoop — offline call simulation');
  console.log(`Patient: ${patient.givenName} ${patient.familyName} · DOB ${patient.dob} · ${patient.conditionDisplay} (${patient.conditionCode})`);
  console.log(`Prior ACT: ${patient.priorActScores.map((s) => s.total).join(' → ')}`);
  console.log(`Mode config: ORCH_MODE=${config.orchMode} · medplum=${config.medplum.enabled} · llm=${llmLabel()} (${llmEnabled() ? 'live' : 'mock'}) · moss=${config.moss.enabled} · stedi=${config.stedi.enabled}`);

  // Show both orchestration renderers build from the one flow spec (A/B foundation).
  hr('Orchestration (both modes render from one flowSpec)');
  const promptModeChars = renderSystemPrompt(flow, vars).length;
  const sm = new FlowStateMachine(flow, vars);
  console.log(`Mode 1 (prompt): single system prompt, ${promptModeChars} chars, all tools exposed.`);
  console.log(`Mode 2 (state): start node "${sm.view().nodeId}", ${sm.view().functions.length} tool(s) gated at this node.`);

  // ── Interview (tool calls the voice agent would make) ─────────────────────
  hr('Interview → live charting');
  const session = newSession('sim-call-1', patient);
  const deps = await defaultToolDeps();

  for (const a of scriptedAnswers(module)) {
    const r = await runTool('chartLive', a, session, deps, `tc-${a.linkId}`);
    console.log(`  ${a.linkId}=${a.value}  ("${a.note}")  → ${r.ok ? 'charted' : 'ERR ' + r.error}`);
  }
  const qa = await runTool('getCareContext', { question: SCRIPTED_QUESTION }, session, deps, 'tc-qa');
  console.log(`  Q&A: "${SCRIPTED_QUESTION}"\n       → ${qa.say}`);
  for (const [i, c] of SCRIPTED_CONCERNS.entries()) {
    await runTool('chartLive', { concern: c }, session, deps, `tc-concern-${i}`);
    console.log(`  concern captured: "${c}"`);
  }
  // Supplemental risk questions (charted, not scored) — scripted to a realistic
  // higher-risk profile so the GINA risk engine + patient summary are exercised.
  const RISK_SCRIPT: Record<string, { value: number; note: string }> = {
    exacerbations: { value: 1, note: 'one prednisone course and an ER visit last winter' },
    reliever: { value: 2, note: 'goes through a rescue inhaler most weeks' },
    adherence: { value: 3, note: 'forgets on busy days' },
  };
  for (const rq of module.riskQuestions ?? []) {
    const scripted = RISK_SCRIPT[rq.id] ?? { value: 1, note: 'reported during check-in' };
    await runTool('chartLive', { riskId: rq.id, ...scripted }, session, deps, `tc-risk-${rq.id}`);
    console.log(`  risk ${rq.id}=${scripted.value}  ("${scripted.note}")`);
  }
  await runTool('submitQuestionnaire', {}, session, deps, 'tc-submit');
  const qr = session.questionnaireResponse!;
  console.log(`  submitted QuestionnaireResponse with ${qr.item?.length ?? 0} items`);

  // ── Post-call: bot builds the n=1 draft plan + workers ────────────────────
  hr('Post-call pipeline → n=1 draft CarePlan');
  const postDeps: PostCallDeps = {
    research: (d) => researchPlan({ patient, actResult: d.actResult, concerns: d.concerns }),
    peerReview: (d) => peerReview({ draft: d }),
    coverage: (rxcui, display, patientId) =>
      getCoverageClient().checkMedication({ patientId, rxcui, medDisplay: display, coverage: patient.coverage }),
  };
  // Simulate an existing active plan so we exercise the "revise" branch.
  const findPrior = async () => 'demo-prior-careplan-001';
  const draft = await buildDraftPlan(qr, patient, module, findPrior, postDeps);
  draft.conditionModuleId = module.id;

  console.log(`ACT total: ${draft.actResult.total}/25 → ${draft.actResult.bandLabel ?? draft.actResult.band} (${draft.actResult.band})`);
  console.log(`Plan type: ${draft.replacesCarePlanId ? `REVISION (replaces CarePlan/${draft.replacesCarePlanId})` : 'NEW plan'}`);
  console.log(`Step-up med (RxNorm ${draft.step.medRxcui}): ${draft.step.medDisplay}`);
  console.log(`  oral steroid: ${draft.step.addOralSteroid} · referral: ${draft.step.specialistReferral} · follow-up: ${draft.step.followUpWeeks} wk · escalate: ${draft.step.escalate}`);
  console.log(`  goal: ${draft.step.goal}`);

  hr('Regimen (structured, coded)');
  for (const m of draft.step.medications ?? []) {
    console.log(`• [${m.role ?? 'med'}] ${m.display} (RxNorm ${m.rxcui})${m.prn ? ' — PRN' : ''}`);
    if (m.sig) console.log(`    sig: ${m.sig}`);
  }

  hr('Safety checks (gate approval)');
  if (draft.safetyFlags?.length) {
    for (const f of draft.safetyFlags) console.log(`• [${f.severity.toUpperCase()} · ${f.kind}] ${f.message}`);
  } else {
    console.log('• no safety flags');
  }

  hr('GINA future-risk findings (beyond the ACT score)');
  if (draft.riskFindings?.length) {
    for (const f of draft.riskFindings) console.log(`• [${f.severity.toUpperCase()}] ${f.label} — ${f.detail}`);
  } else {
    console.log('• no risk findings');
  }

  hr('Patient recap (what Maya says at the end / saved summary)');
  console.log(draft.patientSummary ?? '(none)');

  hr('Deep research (n=1 rationale)');
  for (const f of draft.research) {
    console.log(`• ${f.topic}\n  ${f.rationale}`);
    for (const c of f.citations) console.log(`    – ${c.title} (${c.url})`);
  }

  hr('Expert peer review (decision support — human still approves)');
  if (draft.peerReview) {
    for (const r of draft.peerReview.reviews) {
      console.log(`• ${r.expert}: ${r.verdict.toUpperCase()} — ${r.rationale}${r.suggestedEdit ? `\n    edit: ${r.suggestedEdit}` : ''}`);
    }
    console.log(`Consensus: ${draft.peerReview.consensus}`);
    if (draft.peerReview.flagged.length) console.log(`Flagged: ${draft.peerReview.flagged.join('; ')}`);
  }

  hr('Coverage & cost (Stedi)');
  if (draft.coverage) {
    const c = draft.coverage;
    console.log(`${c.planName}: covered=${c.covered} · prior-auth=${c.priorAuthRequired} · est. copay $${c.copayUsd}`);
    console.log(`  ${c.notes}`);
  }

  // ── Optional: persist to Medplum if configured ────────────────────────────
  if (config.medplum.enabled) {
    hr('Persisting to Medplum');
    try {
      const { getMedplum } = await import('../src/medplum/client.js');
      const { persistDraftPlan } = await import('../src/bot/questionnaire-response.js');
      const { writeDashboardArtifact } = await import('../src/medplum/artifact.js');
      const ids = await persistDraftPlan(await getMedplum(), draft, module);
      const artifactId = await writeDashboardArtifact(patient, draft);
      console.log(`  wrote CarePlan/${ids.carePlanId}, MedicationRequests [${ids.medicationRequestIds.join(', ')}]${ids.taskId ? `, Task/${ids.taskId}` : ''}`);
      console.log(`  wrote dashboard artifact Communication/${artifactId}`);
    } catch (err) {
      console.log(`  skipped (${err instanceof Error ? err.message : String(err)})`);
    }
  } else {
    console.log('\n(Medplum not configured — set MEDPLUM_CLIENT_ID/SECRET and run `npm run seed` to persist for real.)');
  }

  hr('Done — this is the full pre-visit pipeline, before any doctor visit.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
