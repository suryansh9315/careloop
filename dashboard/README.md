# CareLoop Dashboard

Standalone **Vite + React 18 + TypeScript** dashboard for the CareLoop pre-visit
demo — a clean, modern SaaS app. Self-contained package (own `package.json` /
`tsconfig` / `index.html`); no dependency on the root project.

## Layout

A fixed **left sidebar** (CareLoop mark + nav) and a main content area. Three
pages:

- **Dashboard** — greeting, a row of soft pastel stat cards (Total intakes,
  Calls started, Treatments available, Draft plans) and a **Recent intakes**
  table. Each row has a **Call** action and an **Open in Medplum** link
  (`https://app.medplum.com/Patient/{id}`).
- **New intake** — the intake form (name, DOB, phone, a **Treatment** dropdown
  loaded from `GET {BRIDGE}/conditions`, and optional insurance fields).
  Submit → `POST {BRIDGE}/intake`. On success a clean card shows the patientId +
  callSid with a **Call** button and an **Open in Medplum** link. If calling
  fails (e.g. Twilio not configured) the patient is still created and the error
  is shown inline.
- **Review** — clinician decision-support rendered from the plan artifact: the
  draft CarePlan, the expert peer-review panel, the deep-research rationale with
  citations, the Stedi coverage/cost summary, and the live charting feed, plus
  an **Approve** button. Keeps the "DRAFT — awaiting clinician approval" banner.

`BRIDGE` = `import.meta.env.VITE_BRIDGE_URL ?? 'http://localhost:8080'`. The
**Call** action posts `{ patientId, conditionId, phone }` to `{BRIDGE}/call`,
where `conditionId` is the module id (e.g. `asthma`, `depression`).

## Run it

```bash
cd dashboard
npm install      # first time only (needs network)
npm run dev      # http://localhost:5180
```

The dashboard is **live-only** — it always signs in and reads real data.

## Login & configuration

The app **always requires a Medplum sign-in**: you are shown a centered
**login card** and sign in with your **Medplum user email + password**
(`medplum.startLogin` → `processCode`). The client persists the session, so a
refresh keeps you signed in. A **Sign out** control lives in the sidebar footer
(`medplum.signOut()`). There is **no client secret in the browser** — auth is
the user session.

Configuration comes from Vite env vars (see `.env.example`; copy to `.env`):

- `VITE_MEDPLUM_BASE_URL` — your Medplum server base URL.
- `VITE_MEDPLUM_CLIENT_ID` — the client id used for the interactive login.
- `VITE_PATIENT_ID` — the patient whose plan artifact + charting feed the
  dashboard renders.
- `VITE_BRIDGE_URL` — the CareLoop bridge backend (intake + calling).

Until the patient's plan artifact loads (or if no intake exists yet), the views
render a friendly empty state rather than any mock data.

## Files

```
dashboard/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  .env.example
  README.md
  src/
    main.tsx                 # entry — MedplumProvider + App
    App.tsx                  # sidebar layout + login gate + page routing
    medplum.ts               # MedplumClient + signInWithPassword
    bridge.ts                # BRIDGE client: fetchConditions / startCall
    links.ts                 # Medplum admin deep links
    useDashboardData.ts      # data hook: live Medplum artifact + charting subscription
    types.ts                 # self-contained domain types
    styles.css               # self-contained styling (light SaaS theme)
    vite-env.d.ts            # Vite env typings
    components/
      Sidebar.tsx            # left nav + sign-out
      Login.tsx              # centered email/password login card
      CallButton.tsx         # reusable POST {BRIDGE}/call action
      icons.tsx              # inline SVG icons (no icon lib)
    views/
      DashboardHome.tsx      # greeting, stat cards, recent intakes table
      IntakeView.tsx         # intake form + success card
      ClinicianView.tsx      # Review: plan, peer review, research, coverage, feed, approve
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — type-check + production build
- `npm run typecheck` — type-check only
