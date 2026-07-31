# CareLoop

CareLoop is a voice-first pre-visit care coordinator. Maya calls a patient, records a structured check-in into Medplum, answers patient questions with grounded knowledge, and prepares a coded care-plan draft for clinician approval.

CareLoop is decision support—not an autonomous prescriber. A clinician reviews and activates every plan.

## Workflow

1. Create a patient, condition, and optional insurance record.
2. Start an outbound Twilio call from the dashboard.
3. Deepgram powers Maya's speech recognition, turn-taking, and voice responses.
4. Answers are charted live as FHIR `Observation` and `Communication` resources.
5. Moss grounds clinical education questions; Stedi checks eligibility and cost questions.
6. After the call, deterministic scoring selects a protocol step.
7. Deep research, expert peer review, safety checks, and coverage enrich the draft.
8. A clinician edits/reviews the draft and approves it in the dashboard.

## Architecture

| Area | Technology |
| --- | --- |
| Telephony | Twilio Programmable Voice + media streams |
| Voice agent | Deepgram Voice Agent |
| Bridge | Node.js, TypeScript, WebSockets |
| System of record | Medplum FHIR R4 |
| Knowledge retrieval | Moss |
| Insurance eligibility | Stedi 270/271 |
| Research/review LLMs | Groq or Anthropic |
| Clinician dashboard | React, Vite, Medplum auth |
| Hosted bridge | Ubuntu 24.04 EC2, Caddy, systemd, SSM |

## Detailed documentation

See [`docs/`](./docs/README.md):

- [Voice AI and infrastructure](./docs/voice-ai-and-infrastructure.md)
- [Moss](./docs/moss.md)
- [Stedi and insurance](./docs/stedi.md)
- [Medplum](./docs/medplum.md)
- [Deep research and peer review](./docs/deep-research.md)
- [Care-plan lifecycle](./docs/care-plan.md)
- [Historical patient data](./docs/historical-data.md)

## Local setup

Requirements: Node.js 20+, npm, and credentials for any live integrations you want to use.

```bash
npm install
cp .env.example .env
npm run typecheck
```

Run the offline pipeline without external credentials:

```bash
npm run simulate
# or
CONDITION_ID=depression npm run simulate
```

Start the bridge locally:

```bash
npm run bridge
```

Start the dashboard:

```bash
cd dashboard
npm install
npm run dev
```

## Live integrations

Set the relevant values in `.env`:

- `MEDPLUM_CLIENT_ID`, `MEDPLUM_CLIENT_SECRET`
- `DEEPGRAM_API_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`
- `STEDI_API_KEY` and payer/subscriber test values
- `GROQ_API_KEY` or `ANTHROPIC_API_KEY`

Missing integrations use deterministic development fallbacks where supported. Do not commit `.env` or secrets.

Index the condition knowledge corpus after changing it:

```bash
npm run moss:index
```

## Production deployment

The bridge Terraform stack is in [`deploy/terraform`](./deploy/terraform). It deploys to the configured AWS account, uses an Ubuntu 24.04 EC2 instance, stores runtime secrets in SSM Parameter Store, and exposes HTTPS/WSS through Caddy.

```bash
cd deploy/terraform
terraform init
terraform plan
terraform apply
```

The dashboard can be deployed separately to Vercel. Configure its `VITE_*` variables and use `https://bridge.<your-domain>` as the bridge URL.

See [`deploy/README.md`](./deploy/README.md) and [`deploy/DEPLOY_PLAN.md`](./deploy/DEPLOY_PLAN.md) for deployment details.

## Conditions

The engine is condition-generic. Asthma/ACT and Depression/PHQ-9 are included. A condition module defines its questionnaire, scoring bands, protocol, Moss corpus, safety/emergency rules, research template, and expert panel.

## Useful commands

```bash
npm run typecheck
npm run simulate
npm run bridge
npm run moss:index
```
