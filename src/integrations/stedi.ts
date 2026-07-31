import { config } from '../config.js';
import { log } from '../logger.js';
import type { CoverageClient, CoverageInfo, CoverageResult } from '../types.js';

/** Inputs to a medication coverage check (mirrors CoverageClient.checkMedication). */
type CheckInput = {
  patientId: string;
  rxcui: string;
  medDisplay: string;
  coverage?: CoverageInfo;
};

/**
 * Stedi = pharmacy/medical eligibility + formulary check. In the Bot, after a
 * step medication is drafted, we ask "is this covered, does it need prior auth,
 * roughly what will it cost?" and surface a plan-friendly note to clinician +
 * patient.
 *
 * - Live: POST an eligibility check to `config.stedi.baseUrl`, wrapped in
 *   try/catch — any failure falls back to the deterministic mock.
 * - Mock (default / no key): a realistic `CoverageResult`. Step-up MART inhalers
 *   (ICS-formoterol) are heuristically treated as prior-auth-required.
 */

const PLAN_NAME = 'BlueCross PPO (test)';

/** Deterministic, realistic mock coverage from the med display string. */
function mockCoverage(input: { medDisplay: string }): CoverageResult {
  const display = input.medDisplay.toLowerCase();

  // Heuristic: newer combination ICS-formoterol (MART step-up) commonly needs PA.
  const isStepUpMart = display.includes('formoterol');

  // Pseudo-stable copay in the $25–$45 band, seeded by the med name length so it
  // is deterministic per medication (no randomness → reproducible simulations).
  const copayUsd = 25 + (input.medDisplay.length % 21); // 25..45

  if (isStepUpMart) {
    return {
      covered: true,
      priorAuthRequired: true,
      copayUsd,
      planName: PLAN_NAME,
      notes:
        `Covered on formulary but requires prior authorization as a step-up combination ` +
        `(ICS-formoterol) inhaler. Estimated patient copay ~$${copayUsd} once PA is approved. ` +
        `The care team can submit the PA with the ACT trend and prior therapy as justification.`,
    };
  }

  return {
    covered: true,
    priorAuthRequired: false,
    copayUsd,
    planName: PLAN_NAME,
    notes:
      `Covered on formulary; no prior authorization required. Estimated patient copay ~$${copayUsd}. ` +
      `A generic equivalent may further lower cost — confirm at the pharmacy.`,
  };
}

class MockCoverageClient implements CoverageClient {
  async checkMedication(input: CheckInput): Promise<CoverageResult> {
    const result = mockCoverage(input);
    log.info('stedi.mock', {
      patientId: input.patientId,
      rxcui: input.rxcui,
      medDisplay: input.medDisplay,
      priorAuthRequired: result.priorAuthRequired,
      copayUsd: result.copayUsd,
    });
    return result;
  }
}

// ── Real Stedi 270/271 eligibility shapes (subset we consume) ───────────────
type BenefitInfo = {
  code?: string; // '1' Active Coverage, 'B' Co-Payment, 'A' Co-Insurance, 'C' Deductible …
  name?: string;
  serviceTypeCodes?: string[];
  benefitAmount?: string;
  benefitPercent?: string;
  authOrCertIndicator?: string; // 'Y' | 'N' | 'U'
  benefitsAdditionalInformation?: { planDescription?: string; groupNumber?: string };
};
type Aaa = { code?: string; description?: string };
type Stedi271 = {
  benefitsInformation?: BenefitInfo[];
  planStatusInformation?: { planStatus?: string } | { planStatus?: string }[];
  errors?: Aaa[];
};

/**
 * Build the 270 request. When the patient's `coverage` is present it drives the
 * payer + subscriber; otherwise we fall back to the `config.stedi.*` env test
 * values (a matching Stedi mock member).
 */
function buildEligibilityRequest(coverage?: CoverageInfo) {
  const payerId = coverage?.payerId ?? config.stedi.payerId;
  const subscriber = coverage
    ? {
        firstName: coverage.subscriberFirstName,
        lastName: coverage.subscriberLastName,
        dateOfBirth: coverage.subscriberDob,
        memberId: coverage.memberId,
      }
    : {
        firstName: config.stedi.subFirstName,
        lastName: config.stedi.subLastName,
        dateOfBirth: config.stedi.subDob,
        memberId: config.stedi.subMemberId,
      };
  return {
    tradingPartnerServiceId: payerId,
    provider: { npi: config.stedi.providerNpi, organizationName: config.stedi.providerName },
    subscriber,
    encounter: { serviceTypeCodes: [config.stedi.serviceTypeCode] },
  };
}

function planActive(json: Stedi271): boolean {
  const p = json.planStatusInformation;
  const statuses = Array.isArray(p) ? p : p ? [p] : [];
  return statuses.some((s) => s.planStatus === 'A');
}

/** Map a Stedi 271 into our CoverageResult (with mock-derived fallbacks). */
function parse271(json: Stedi271, input: CheckInput): CoverageResult {
  const benefits = json.benefitsInformation ?? [];
  const covered = benefits.some((b) => b.code === '1') || planActive(json);

  // Copay comes from the 271 itself: a benefit with code 'B' (co-payment) carries
  // the dollar amount the plan reported. If the payer returns none, fall back to a
  // deterministic name-based estimate so the card still shows a figure.
  const copayBenefit = benefits.find((b) => b.code === 'B' && b.benefitAmount);
  const copayParsed = copayBenefit ? Math.round(Number(copayBenefit.benefitAmount)) : NaN;
  const copayFromPlan = Number.isFinite(copayParsed);
  const copayUsd = copayFromPlan ? copayParsed : mockCoverage(input).copayUsd;

  // Eligibility (270/271) does not carry per-drug formulary PA, so combine any
  // payer auth indicator with our step-up heuristic for the ICS-formoterol MART.
  const authFlag = benefits.some((b) => b.authOrCertIndicator === 'Y');
  const isStepUpMart = input.medDisplay.toLowerCase().includes('formoterol');
  const priorAuthRequired = authFlag || isStepUpMart;

  const knownPayers: Record<string, string> = { '87726': 'UnitedHealthcare' };
  const payerId = input.coverage?.payerId ?? config.stedi.payerId;
  const payerName = input.coverage?.payerName ?? knownPayers[payerId] ?? `Payer ${payerId}`;
  const planName =
    benefits.find((b) => b.benefitsAdditionalInformation?.planDescription)
      ?.benefitsAdditionalInformation?.planDescription ?? `${payerName} (test)`;

  const copayText = copayFromPlan
    ? `plan copay ~$${copayUsd} (USD, from the eligibility response)`
    : `estimated patient copay ~$${copayUsd} (USD)`;
  const notes =
    `Real-time eligibility via Stedi (270/271): coverage ${covered ? 'active' : 'not confirmed'}. ` +
    `${priorAuthRequired ? 'Prior authorization likely required for this step-up combination inhaler; ' : 'No prior-auth flagged; '}` +
    `${copayText}. The care team can attach the ACT trend as PA justification.`;

  return { covered, priorAuthRequired, copayUsd, planName, notes };
}

class LiveCoverageClient implements CoverageClient {
  async checkMedication(input: CheckInput): Promise<CoverageResult> {
    // We can form a valid 270 from EITHER the patient's Coverage (passed at call
    // time) OR the configured env test member. Without either, stay on the
    // deterministic mock rather than sending an invalid request.
    if (!(input.coverage || config.stedi.payerId)) {
      log.info('stedi.mock', { reason: 'no coverage/payer available', patientId: input.patientId });
      return mockCoverage(input);
    }
    // Real-time eligibility check; on ANY error (network, non-2xx, unexpected
    // shape) we fall back to the mock so the Bot never blocks on coverage.
    try {
      const url = `${config.stedi.baseUrl.replace(/\/$/, '')}/change/medicalnetwork/eligibility/v3`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: config.stedi.apiKey, // Stedi expects the raw API key
        },
        body: JSON.stringify(buildEligibilityRequest(input.coverage)),
      });
      if (!res.ok) throw new Error(`stedi http ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as Stedi271;

      // A live 271 with no benefit lines usually means the test subscriber values
      // don't match the payer's mock fixture (AAA error). The call IS live — we
      // just fall back to the deterministic estimate so the coverage card is
      // complete, and log the real Stedi response for transparency.
      const benefits = json.benefitsInformation ?? [];
      if (benefits.length === 0) {
        log.warn('stedi.live.no_benefits', {
          patientId: input.patientId,
          errors: (json.errors ?? []).map((e) => `${e.code}:${e.description}`),
          hint: 'paste a matching mock member (STEDI_SUB_*) from the Stedi dashboard for live benefits',
        });
        return mockCoverage(input);
      }

      const result = parse271(json, input);
      log.info('stedi.live', {
        patientId: input.patientId,
        rxcui: input.rxcui,
        covered: result.covered,
        priorAuthRequired: result.priorAuthRequired,
        copayUsd: result.copayUsd,
      });
      return result;
    } catch (err) {
      log.warn('stedi.live.fallback', { error: (err as Error).message });
      return mockCoverage(input);
    }
  }
}

export function getCoverageClient(): CoverageClient {
  return config.stedi.enabled ? new LiveCoverageClient() : new MockCoverageClient();
}
