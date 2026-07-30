# CareLoop

**Voice-first pre-visit care.** Before an appointment, an AI care coordinator ("Maya") phones the patient. The conversation is **charted into the FHIR record as it happens**; the moment it ends an AI pipeline drafts an **n=1, fully-coded treatment plan** — deep-researched, peer-reviewed by expert agents, and insurance-checked — that a clinician reviews and **approves** from a clean dashboard. Medplum is the datastore; the clinician just decides.

Built for the **YC × Medplum Agentic Healthcare Hackathon**. It is **condition-generic**: **asthma** (Asthma Control Test) and **depression** (PHQ-9) ship today; a new treatment is one module file.

> *The vision we build to:* "Prior to your visit, you check in by talking to a voice agent and your conversation is charted for you as it happens… Any health issue you describe is deep researched… You receive n=1 treatment that's customized just for you. Your treatment plan is peer reviewed by experts… And of course, you can ask how much treatment will cost ahead of time, and whether your insurance will cover it." — CareLoop implements that paragraph end to end.

---

## What happens on a call

1. A clinician creates a patient (with insurance) and starts a call from the dashboard.
2. **Maya** greets the patient *with their history*, verifies DOB, and administers the condition's questionnaire one question at a time.
3. Each answer is written to Medplum **live** as a coded `Observation` + a human-readable `Communication` — visible in real time on the **Live** page.
4. After the control instrument, Maya asks a short **future-risk block** (for asthma: recent exacerbations, reliever overuse, controller adherence) — the GINA risk factors the ACT score misses. Charted, not scored.
5. The patient can **ask questions** mid-call:
   - clinical/education ("how do I use my inhaler?") → grounded from **Moss**,
   - insurance/cost ("what's my copay?", "will this be covered?") → a real **Stedi** eligibility answer.
6. Maya ends with a **personalized recap** — reflecting back what she heard, one grounded tip, and what happens next — so the patient leaves the call with value (also saved as a patient-facing summary).
7. On hangup, an off-call pipeline drafts a **coded `CarePlan`** (RxNorm regimen, follow-up, escalation), computes **safety** + **GINA risk** flags, runs **deep research** + a **multi-agent expert panel** + a **Stedi coverage** check, and publishes it.
8. The clinician opens it in the **Review queue**, sees the patient summary + trend + risk/safety flags + plan + research + peer review + coverage + the patient recap, and **approves** — flipping the CarePlan to active, activating the meds, and closing the review task.

---

## Tech stack

| Layer | What we use |
| --- | --- |
| **Telephony** | Twilio Programmable Voice (`<Connect><Stream>` media streams, outbound REST calling) |
| **Voice agent** | Deepgram Voice Agent (`agent/converse` WebSocket: STT + turn-taking + LLM + TTS in one socket) |
| **Bridge / orchestration** | Node + TypeScript (`ws`) — bridges Twilio ↔ Deepgram, runs the flow + tools + post-call pipeline |
| **System of record + terminology** | Medplum (hosted FHIR R4; LOINC / RxNorm / ICD-10 / SNOMED terminology) |
| **Semantic retrieval** | Moss (`@moss-dev/moss`) — real-time grounding for the agent + deep research |
| **Eligibility / benefits** | Stedi (real-time 270/271 eligibility) |
| **Post-call LLM workers** | Groq (default) or Anthropic — deep research + expert peer-review panel |
| **Dashboard** | Vite + React + TypeScript + `@medplum/react-hooks` (live-only, Medplum email/password auth) |

Runtime: Node ≥ 20, TypeScript (strict, ESM/NodeNext). **No database of our own — Medplum is the datastore.**

---

## How agent orchestration works

Everything is driven by a **condition registry** (`src/conditions/`). Each treatment is one `ConditionModule` — pure data + a few pure functions:

```
ConditionModule = {
  instrument      // the questionnaire (LOINC-coded items + score bands)
  protocol        // band → deterministic plan (RxNorm med, follow-up, escalation)
  moss            // per-condition knowledge corpus + index name
  agent           // persona + emergency/crisis rules (911 for asthma, 988 for depression)
  expertPanel     // the reviewer personas (pulmonology vs psychiatry, pharmacist, safety)
  conditionCodes  // ICD-10 / SNOMED
}
```

The engine is condition-agnostic and reads the module. `buildIntakeFlow(module)` turns the instrument into a **flow graph** (greeting → verify → recap → one node per question → open concerns → submit → close).

**Live-call path:**
1. `POST /intake` (or `/call`) creates the Patient / Condition / `Coverage` and places an **outbound Twilio call** tagged with `patientId` + `conditionId`.
2. Twilio fetches `/voice` → TwiML opens a **media stream** to the bridge; the bridge loads the right module and connects to **Deepgram** with the flow rendered as a system prompt.
3. The agent calls **server-side tools**:
   - `chartLive` → writes each answer to Medplum live (`Communication` + coded `Observation`),
   - `getCareContext` → **Moss** retrieval for grounded clinical/education Q&A,
   - `checkCoverage` → **Stedi** eligibility on the patient's `Coverage` for cost/insurance Q&A,
   - `submitQuestionnaire` → writes the final `QuestionnaireResponse`.
4. **On hangup** (fully offloaded off the call), the bridge runs the pipeline: score → protocol step → draft coded `CarePlan` (+ RxNorm `MedicationRequest`, `Task`) → **deep research** → **expert peer review** → **Stedi coverage** → publish a dashboard artifact. Then the call auto-hangs-up ~10 s after the closing.

**Orchestration modes** (`ORCH_MODE`): one flow spec renders two ways — `prompt` (single system prompt, all tools; the reliable live default, since Deepgram can't change its tool list mid-call) and `state` (a bridge state machine that re-prompts per node). `npm run simulate` A/B-compares them offline. All heavy work is offloaded to call-end so nothing competes with the live conversation.

---

## Tools & the FHIR it writes

The voice agent calls four server-side tools (own server; per-call session, idempotent):

| Tool | When the agent calls it | What it does |
| --- | --- | --- |
| `chartLive` | after each answer / concern | writes a coded `Observation` (LOINC + value, `preliminary`) + a human-readable `Communication` — the live chart |
| `getCareContext` | clinical/education question | Moss retrieval on the condition index → a grounded, sourced snippet |
| `checkCoverage` | insurance/cost question | Stedi 270/271 on the patient's `Coverage` → covered / copay / prior-auth |
| `submitQuestionnaire` | end of interview | writes the final `QuestionnaireResponse` (tagged with the condition module) |

**FHIR resources** (all in your Medplum project):
- **read at call start:** `Patient`, `Condition`, `Coverage`, prior `Observation`s (score trend), current `MedicationRequest`, `Appointment`.
- **written live during the call:** `Observation` (coded answers) + `Communication` (chart lines; the call log is also a tagged `Communication`).
- **written post-call:** `QuestionnaireResponse` (ACT answers + charted risk answers), final coded `Observation`s, a draft `CarePlan` (with `replaces` when revising an active plan), **one or more coded `MedicationRequest`s** (RxNorm, `draft`, each with a structured `dosageInstruction` + `dispenseRequest`), a `Task` (urgent when escalated by band **or** a critical risk finding), review `Communication`s (research + coverage), a **patient-facing summary** `Communication`, and a dashboard-artifact `Communication`.
- **on approve:** `CarePlan` → `active`, all its `MedicationRequest`s → `active`, the review `Task` → `completed`. **Approval is gated** — a `critical` safety flag (e.g. an allergy match) blocks the clinician until acknowledged.

## Clinical spec

**Asthma — Asthma Control Test (ACT).** 5 LOINC-coded items (each 1–5), total 5–25. Bands: **≥20 well controlled · 16–19 not well controlled · ≤15 very poorly controlled** → a GINA-style step protocol (continue controller / step-up ICS-formoterol / step-up + short oral-corticosteroid + specialist referral + urgent escalation). Condition ICD-10 `J45.x` / SNOMED `195967001`; meds RxNorm.

**Future-risk block (beyond ACT).** GINA frames asthma assessment as *current control* (ACT) **plus** *future risk*, which ACT ignores. So after the ACT, Maya asks 3 supplemental questions — **exacerbation history (12 mo), reliever/SABA overuse, controller adherence** — captured but not scored. `src/clinical/risk.ts` turns them into `RiskFinding`s with GINA-grounded thresholds (e.g. ≥1 reliever canister/month → mortality-risk flag; a prior exacerbation ≈2.5× the next). A critical risk finding **escalates** the plan (urgent `Task`). These surface as a *Future-risk factors* card in Review.

**Depression — PHQ-9.** 9 items (each 0–3), total 0–27. Bands: minimal 0–4 · mild 5–9 · moderate 10–14 · moderately-severe 15–19 · severe 20–27 → stepped care (watchful waiting / behavioral activation + therapy referral / SSRI / SSRI + referral / SSRI + expedited psychiatry). Condition ICD-10 `F32.9` / SNOMED `370143000`; item-9 (self-harm) triggers a **988 crisis override**; meds RxNorm (sertraline).

All codes are validated at runtime against Medplum's **terminology service** (`$validate-code` / `$lookup`); RxCUIs resolve via `$lookup` with a hardcoded fallback.

**Structured, multi-medication regimens.** A protocol step is no longer a single drug — each band carries a `medications: MedOrder[]` regimen with a clinical **role** (`controller` / `reliever` / `rescue` / `acute-course`), a human **sig**, route, frequency, PRN flag, duration, quantity, and refills. Asthma's poorly-controlled band, for example, drafts an **ICS-formoterol MART controller + as-needed reliever + a 5-day prednisone course** — three coded `MedicationRequest`s, each with its own `dosageInstruction`/`dispenseRequest`. (The legacy single `medRxcui`/`medDisplay` fields are kept as the "primary" med for back-compat and coverage.)

**Safety checks that gate approval.** Before a plan is drafted, `src/clinical/safety.ts` (`checkRegimenSafety`) runs the regimen against the patient's allergies + current meds and emits `SafetyFlag`s: **allergy → `critical`** (blocks approval until acknowledged), **duplicate-therapy / interaction → `warning`**, informational → `info`. This is a deterministic, transparent stub with the seams a production drug-interaction service (FDB / Medi-Span / RxNav) would plug into — it is decision support, not a substitute for one.

---

## How we use Moss

Moss is the **real-time retrieval layer**, **per condition**. Each module carries a `moss.corpus` (patient-safe education/protocol snippets) indexed into a per-condition Moss Cloud index (`careloop-asthma-kb`, `careloop-depression-kb`) via `npm run moss:index`. The asthma corpus covers the high-value topics a check-in surfaces — inhaler technique, reliever overuse, controller adherence, the written action plan (green/yellow/red), exacerbation warning signs, vaccines, smoking/vaping, and exercise. **After editing a corpus, re-run `npm run moss:index`** so live Moss retrieval reflects it (the offline mock reads the corpus directly).

Two jobs:
1. **Mid-call grounding** — the `getCareContext` tool queries the patient's condition index so Maya answers questions ("how do I use my inhaler?", "what's a good PHQ-9 score?") from clinic knowledge instead of improvising. `src/integrations/moss.ts` uses the `@moss-dev/moss` SDK (`loadIndex` once, `query` per turn); no key → a keyword mock over the same corpus so everything runs offline.
2. **Deep-research grounding** — the post-call research worker pulls Moss snippets to ground the cited n=1 rationale.

Moss holds **general knowledge only** — never patient-specific data.

---

## How insurance works

Insurance is a **per-patient FHIR `Coverage`**, captured on the New-Intake form (payer id + member id + subscriber name/DOB) and written alongside the Patient/Condition. It powers Stedi in **two** places:

- **Live (in-call):** the `checkCoverage` tool builds a real 270 from the patient's `Coverage` and calls Stedi, so Maya can answer *"your plan's active, copay ~$15, prior auth may be needed"* when the patient asks about cost.
- **Post-call:** the pipeline runs a Stedi check on the *drafted* medication and attaches `{ covered, priorAuthRequired, copayUsd, planName }` to the plan for the clinician + patient.

`src/integrations/stedi.ts` calls Stedi's `/change/medicalnetwork/eligibility/v3` (falls back to a deterministic mock without a key). **Test mode:** use a Stedi test API key and a documented mock member — e.g. UnitedHealthcare payer **87726**, member **UHC123456**, subscriber **Jane Doe** DOB **19710101** (Maria is seeded with exactly this, so calling Maria returns a real 271). Eligibility (270/271) isn't per-drug, so prior-auth on the drafted med is inferred from the payer's auth indicator + a step-up heuristic.

Insurance lives in the `Coverage` resource; **Stedi computes the answer; Moss is never used for it.**

---

## The dashboard (`dashboard/`)

Live-only, gated by **Medplum email/password login** (a per-user session — no client secret in the browser). Clean, minimal Apple/Uber-style UI. Pages:

- **Dashboard** — stat cards (draft plans, calls, patients, treatments) + recent activity.
- **Live** — detects the in-progress call and streams that patient's **coded Observations + charting feed in real time** (the "watch documentation write itself" view).
- **Review queue** — a **worklist of all draft `CarePlan`s** across every patient (no "active patient" — pick any plan).
- **Review** (per plan) — the score **trend chart**, draft plan (the **full multi-medication regimen** with roles + sigs, follow-up, goal), **safety flags**, **deep-research** rationale + citations, **expert peer-review** panel + consensus, **Stedi coverage**, and the live charting timeline. The clinician can **edit the regimen in place** — add/remove meds, each with an **RxNorm search dropdown** (Medplum `ValueSet/$expand`) + role/sig/dose/quantity/refills — then **Approve** (CarePlan `draft→active` + activate all meds + close task, attributed to the signed-in clinician). A `critical` safety flag **gates Approve** behind an explicit acknowledgement.
- **Calls** — a call log (patient, treatment, direction, status pill, started, duration).
- **Patients** — directory of the user's patients.
- **Treatments** — the **admin** for treatments-as-data: list every condition module (built-in vs. custom), and **create/edit** one in a structured form — instrument items + bands, per-band protocol with the multi-med editor (RxNorm dropdowns), Moss corpus, agent prompt, research template, and expert panel. Saves write a FHIR `PlanDefinition` and hot-reload the bridge's registry.
- **New intake** — create a patient + pick a treatment + enter insurance → creates the FHIR record and can place the call.

Medplum stays the source of truth and admin fallback; the clinician **workflow** lives here.

---

## Multi-condition & treatments-as-data

A treatment is a **`ConditionModule`** — pure, fully JSON-serializable data (instrument + bands, per-band protocol regimen, Moss corpus, agent prompt, research-topic template, expert panel). The same engine — flow, tools, live charting, scoring, protocol, research, expert panel, coverage, dashboard — runs any module; only the data changes. **Asthma** (ACT) and **depression** (PHQ-9 with a 988 crisis protocol) ship as code-defined modules.

Modules are also **stored as data in Medplum**: each is a FHIR **`PlanDefinition`** (the module JSON in an extension, tagged for search — see `src/conditions/store.ts`). On startup the bridge **hydrates the registry** from Medplum, overlaying the code-defined seeds; `npm run seed` publishes the built-ins. So a treatment can be authored two ways:
- **In code** — add a module in `src/conditions/` and register it (the seed source + offline fallback).
- **At runtime** — create/edit it in the dashboard **Treatments** admin, which `POST`/`PUT`s `/conditions` on the bridge, writes the `PlanDefinition`, and hot-reloads the in-memory registry (no restart, no redeploy).

## Concurrency

Every call is **fully isolated**: each Twilio call opens its own WebSocket → its own Deepgram session, `CallSession`, tools state, and call-log record (keyed by Twilio `callSid`). No shared mutable call state; the Medplum client is a stateless HTTP client safe for concurrent use. Practical ceilings are third-party (Deepgram/Twilio/Groq/Medplum rate & concurrency limits) and the single bridge process — scale horizontally for production (each call is self-contained). The Live view currently shows one in-progress call at a time.

---

## Repo layout

```
src/
  conditions/     Condition registry — asthma.ts, depression.ts, types.ts (flow builder, scoring), store.ts (PlanDefinition persistence)
  clinical/       questionnaire items + scoring, codes (LOINC/RxNorm/ICD-10/SNOMED), protocol, safety.ts (regimen safety flags)
  orchestration/  tools (chartLive / getCareContext / checkCoverage / submitQuestionnaire), prompt renderer, state machine
  integrations/   deepgram, twilio, moss, stedi, llm (groq/anthropic)
  medplum/        client, terminology, seed, intake (patient+coverage), chart, calllog, artifact
  bridge/server.ts  Twilio media stream ⇄ Deepgram ⇄ tools · /intake /call /voice · /conditions CRUD · post-call pipeline
  bot/            QuestionnaireResponse → coded draft CarePlan (multi-med) + safety flags; approve-plan bot
  workers/        research (Moss + LLM) + expert-panel (multi-agent peer review)
scripts/          seed, moss-index, simulate-call, update-phones
dashboard/        Vite + React clinician app (login → worklist → review/edit → approve · live · calls · patients · intake · treatments admin)
```

---

## How to run

### 0. Install
```bash
npm install
cp .env.example .env      # fill in credentials (all optional — missing ones mock)
```

### 1. Offline (no phone, no credentials)
```bash
npm run simulate                      # full pipeline for asthma
CONDITION_ID=depression npm run simulate
```
Runs a scripted call → live charting → coded draft plan → research → expert panel → coverage, every integration falling back to a mock when its key is absent.

### 2. Wire the backend (Medplum first)
Set `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET` (app.medplum.com → Project → Clients), then:
```bash
npm run seed          # creates the demo patient (Maria) + questionnaire + coverage; prints SEED_* ids → paste into .env
npm run moss:index    # indexes each condition's knowledge into Moss (needs MOSS_PROJECT_ID/KEY)
```
Add as available (each optional; missing ones mock): `GROQ_API_KEY`, `MOSS_PROJECT_ID`/`MOSS_PROJECT_KEY`, `STEDI_API_KEY` (+ `STEDI_SUB_*` test member), `DEEPGRAM_API_KEY`, Twilio creds. Keep `ORCH_MODE=prompt`.

### 3. Dashboard (live)
```bash
cd dashboard && npm install && npm run dev     # http://localhost:5180 — sign in with your Medplum user email/password
```
`dashboard/.env`: `VITE_MEDPLUM_BASE_URL`, `VITE_MEDPLUM_CLIENT_ID`, `VITE_PATIENT_ID`, `VITE_BRIDGE_URL` (default `http://localhost:3000`).

### 4. Real phone calls
```bash
npm run bridge        # starts on PORT (3000)
```
- Expose the bridge publicly and set `PUBLIC_HOST` to that host (e.g. a Cloudflare tunnel → `localhost:3000`).
- **Twilio:** buy a **Voice** number → `TWILIO_PHONE_NUMBER`. Outbound needs no per-number webhook — but the tunnel must reach the bridge, and on a **trial account** the destination number must be a **Verified Caller ID** with geo-permissions enabled for its country.
- Trigger from the dashboard **New intake** / **Call**, or:
```bash
curl -X POST https://<PUBLIC_HOST>/call -H 'content-type: application/json' \
  -d '{"patientId":"<id>","conditionId":"asthma","phone":"+1<verified>"}'
```
The call runs the interview, charts live, auto-hangs-up on completion, and a new plan appears in the Review queue ~15 s later.

### Scripts
`npm run simulate` · `npm run seed` · `npm run moss:index` · `npm run bridge` · `npm run typecheck` · `npx tsx scripts/update-phones.ts [+E164]`

---

## Environment variables

Everything is optional — a missing key degrades to a mock so `npm run simulate` and offline dev always work. Copy `.env.example` → `.env`.

| Var(s) | Purpose | Missing → |
| --- | --- | --- |
| `PORT`, `PUBLIC_HOST` | bridge port / public host Twilio reaches | `3000` / `localhost` |
| `ORCH_MODE` | `prompt` (live default) or `state` | `prompt` |
| `TOOL_SHARED_SECRET` | `x-internal-secret` for tool auth | `dev-secret` |
| `MEDPLUM_BASE_URL`, `MEDPLUM_CLIENT_ID`, `MEDPLUM_CLIENT_SECRET` | FHIR datastore + terminology (client credentials) | everything mocks; no persistence |
| `SEED_PATIENT_ID` / `SEED_CONDITION_ID` / `SEED_APPOINTMENT_ID` / `SEED_QUESTIONNAIRE_ID` | printed by `npm run seed`, paste back | — |
| `DEEPGRAM_API_KEY` | Voice Agent | mock (no live voice) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | telephony (outbound REST) | no real calls |
| `LLM_PROVIDER` (`groq`\|`anthropic`), `GROQ_API_KEY`, `GROQ_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | deep research + expert panel | canned output |
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`, `MOSS_INDEX` | semantic retrieval (Moss Cloud) | keyword mock over the corpus |
| `STEDI_API_KEY`, `STEDI_BASE_URL`, `STEDI_PAYER_ID`, `STEDI_PROVIDER_NPI`, `STEDI_SUB_FIRST_NAME`/`_LAST_NAME`/`_DOB`/`_MEMBER_ID` | real 270/271 eligibility (test member) | deterministic mock |

**Dashboard** (`dashboard/.env`): `VITE_MEDPLUM_BASE_URL`, `VITE_MEDPLUM_CLIENT_ID`, `VITE_PATIENT_ID`, `VITE_BRIDGE_URL` (default `http://localhost:3000`).

---

## Design decisions & safety

- **Hybrid orchestration:** the long-lived call WebSocket + tools run in our own Node server; FHIR/terminology is Medplum; heavy AI work is offloaded to **call-end** so nothing competes with the live audio.
- **Prompt mode** is the live default (Deepgram can't change its tool set mid-call); `state` mode + both A/B metrics live in the simulator.
- CareLoop **drafts and researches; a human clinician approves.** Every generated resource is `draft`/`proposal` until approved; the multi-agent "peer review" is decision support, not sign-off. Each flow has an emergency/crisis override. Use synthetic patients and Stedi test mode only.
