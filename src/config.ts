import 'dotenv/config';

/**
 * Central, typed configuration. Nothing throws on missing values — instead we
 * expose `*.enabled` flags so every integration can fall back to a deterministic
 * mock. That keeps `npm run simulate` working with zero credentials, and lets the
 * live path light up as each secret is filled in.
 */

function str(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

export type OrchMode = 'prompt' | 'state';

const orchModeRaw = str('ORCH_MODE', 'state');
export const ORCH_MODE: OrchMode = orchModeRaw === 'prompt' ? 'prompt' : 'state';

export const config = {
  port: Number(str('PORT', '8080')),
  publicHost: str('PUBLIC_HOST'),
  orchMode: ORCH_MODE,
  toolSharedSecret: str('TOOL_SHARED_SECRET', 'dev-secret'),
  logLevel: str('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',

  medplum: {
    baseUrl: str('MEDPLUM_BASE_URL', 'https://api.medplum.com/'),
    clientId: str('MEDPLUM_CLIENT_ID'),
    clientSecret: str('MEDPLUM_CLIENT_SECRET'),
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  twilio: {
    accountSid: str('TWILIO_ACCOUNT_SID'),
    authToken: str('TWILIO_AUTH_TOKEN'),
    phoneNumber: str('TWILIO_PHONE_NUMBER'),
    get enabled() {
      return Boolean(this.accountSid && this.authToken);
    },
  },

  deepgram: {
    apiKey: str('DEEPGRAM_API_KEY'),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  anthropic: {
    apiKey: str('ANTHROPIC_API_KEY'),
    model: str('ANTHROPIC_MODEL', 'claude-opus-4-8'),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  groq: {
    apiKey: str('GROQ_API_KEY'),
    model: str('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    baseUrl: str('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  // Which provider the post-call workers (research + expert panel) use.
  llm: {
    provider: (str('LLM_PROVIDER', 'groq') === 'anthropic' ? 'anthropic' : 'groq') as
      | 'groq'
      | 'anthropic',
  },

  moss: {
    projectId: str('MOSS_PROJECT_ID'),
    projectKey: str('MOSS_PROJECT_KEY'),
    indexName: str('MOSS_INDEX', 'careloop-asthma-kb'),
    get enabled() {
      return Boolean(this.projectId && this.projectKey);
    },
  },

  stedi: {
    apiKey: str('STEDI_API_KEY'),
    baseUrl: str('STEDI_BASE_URL', 'https://healthcare.us.stedi.com'),
    // Real-time eligibility (270/271) request parameters. In TEST mode Stedi
    // requires EXACT mock values — paste a mock example from the Stedi dashboard
    // (Eligibility → mock requests) to get a live 271; otherwise we fall back.
    payerId: str('STEDI_PAYER_ID'),
    providerNpi: str('STEDI_PROVIDER_NPI', '1999999984'),
    providerName: str('STEDI_PROVIDER_NAME', 'CareLoop Clinic'),
    serviceTypeCode: str('STEDI_SERVICE_TYPE', '30'),
    subFirstName: str('STEDI_SUB_FIRST_NAME'),
    subLastName: str('STEDI_SUB_LAST_NAME'),
    subDob: str('STEDI_SUB_DOB'), // YYYYMMDD
    subMemberId: str('STEDI_SUB_MEMBER_ID'),
    get enabled() {
      return Boolean(this.apiKey);
    },
    /** live 270 needs a payer + subscriber; otherwise stay on the mock. */
    get canQuery() {
      return Boolean(this.apiKey && this.payerId && this.subMemberId && this.subLastName);
    },
  },

  seed: {
    patientId: str('SEED_PATIENT_ID'),
    conditionId: str('SEED_CONDITION_ID'),
    appointmentId: str('SEED_APPOINTMENT_ID'),
    questionnaireId: str('SEED_QUESTIONNAIRE_ID'),
  },
} as const;

/** Build the public wss:// URL Twilio should stream media to. */
export function streamUrl(): string {
  const host = config.publicHost || `localhost:${config.port}`;
  return `wss://${host}/twilio`;
}
