# CareLoop technical and operating documentation

CareLoop is a voice-first pre-visit workflow. Maya calls a patient, records a structured check-in into a FHIR chart, and prepares a clinician-reviewable care-plan draft. The system is decision support: a licensed clinician remains the person who approves and activates treatment.

## Documents

- [Voice AI and infrastructure](./voice-ai-and-infrastructure.md) — call path, services, deployment, security boundaries, and failure behavior.
- [Moss](./moss.md) — retrieval, condition indexes, live-call grounding, and research grounding.
- [Stedi and insurance](./stedi.md) — Coverage records, eligibility checks, 270/271 mapping, and limitations.
- [Medplum](./medplum.md) — FHIR resources, reads/writes, terminology, subscriptions, and dashboard data.
- [Deep research and peer review](./deep-research.md) — evidence synthesis, citations, expert personas, consensus, and human review.
- [Care-plan lifecycle](./care-plan.md) — scoring through draft, review, approval, revision, and follow-up.
- [Historical patient data](./historical-data.md) — what is read, how it becomes context/trends, and what is not yet implemented.

## Scope and implementation status

These documents describe the current repository implementation, not an assertion that every workflow is production clinical software. The live path is condition-generic and currently ships with Asthma/ACT and Depression/PHQ-9 modules. External integrations intentionally degrade to deterministic mocks when credentials or network access are absent. Mock output must never be represented to a patient or clinician as a real payer response or real clinical evidence.

## Core principle

The LLMs propose language and evidence summaries; deterministic code selects the protocol band, creates FHIR resources, runs basic safety checks, and controls state transitions. Approval is a separate clinician action.

