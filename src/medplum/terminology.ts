import { SYSTEM } from '../clinical/codes.js';
import { log } from '../logger.js';
import { getMedplum, medplumEnabled } from './client.js';

/**
 * Thin wrappers over Medplum's hosted terminology service ($validate-code,
 * $expand). Every call degrades gracefully: on any error — or when Medplum is
 * disabled — we log a warning and fall back rather than block the pipeline.
 * Callers fall back to the hardcoded MED / code constants.
 */

/**
 * Validate that `code` exists in `system` via CodeSystem/$validate-code.
 * Returns true when valid; on error or when Medplum is disabled logs a warn and
 * returns true so a bad-but-plausible constant never blocks a write.
 */
export async function validateCode(system: string, code: string): Promise<boolean> {
  if (!medplumEnabled()) {
    log.warn('terminology.validate.skipped', { system, code, reason: 'medplum-disabled' });
    return true;
  }
  try {
    const medplum = await getMedplum();
    const url = `fhir/R4/CodeSystem/$validate-code?url=${encodeURIComponent(
      system,
    )}&code=${encodeURIComponent(code)}`;
    const params = (await medplum.get(url)) as {
      parameter?: { name: string; valueBoolean?: boolean }[];
    };
    const result = params.parameter?.find((p) => p.name === 'result');
    const ok = result?.valueBoolean === true;
    if (!ok) log.warn('terminology.validate.invalid', { system, code });
    return ok;
  } catch (err) {
    log.warn('terminology.validate.error', { system, code, error: String(err) });
    return true;
  }
}

/**
 * Resolve a free-text medication query to an RxNorm { code, display } via
 * ValueSet/$expand filtered against the RxNorm code system. Returns the first
 * match, or null on failure / when disabled so callers fall back to MED.*.
 */
export async function lookupRxNorm(
  query: string,
): Promise<{ code: string; display: string } | null> {
  if (!medplumEnabled()) {
    log.warn('terminology.rxnorm.skipped', { query, reason: 'medplum-disabled' });
    return null;
  }
  try {
    const medplum = await getMedplum();
    const url = `fhir/R4/ValueSet/$expand?filter=${encodeURIComponent(
      query,
    )}&count=1&url=${encodeURIComponent(`${SYSTEM.RXNORM}?fhir_vs`)}`;
    const vs = (await medplum.get(url)) as {
      expansion?: { contains?: { system?: string; code?: string; display?: string }[] };
    };
    const first = vs.expansion?.contains?.find(
      (c) => c.system === SYSTEM.RXNORM && c.code,
    );
    if (!first?.code) {
      log.warn('terminology.rxnorm.nomatch', { query });
      return null;
    }
    return { code: first.code, display: first.display ?? query };
  } catch (err) {
    log.warn('terminology.rxnorm.error', { query, error: String(err) });
    return null;
  }
}
