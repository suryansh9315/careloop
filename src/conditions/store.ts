import type { MedplumClient } from '@medplum/core';
import type { PlanDefinition } from '@medplum/fhirtypes';
import type { ConditionModule } from './types.js';
import { CONDITION_TAG_SYSTEM } from './registry.js';

/**
 * Treatments-as-data: store each ConditionModule as a FHIR PlanDefinition so
 * treatments can be created/edited from the admin UI instead of living only in
 * code. The full module (now fully JSON-serializable) is carried verbatim in a
 * private extension; PlanDefinition's url/identifier/title give us clean listing
 * and idempotent upsert.
 *
 * The code-defined modules (asthma, depression) remain the seed source and the
 * offline fallback; anything published here overrides/extends them by id.
 */

/** Extension that carries the serialized ConditionModule JSON. */
export const CONDITION_MODULE_EXT = 'https://careloop.demo/ext/condition-module';
/** Canonical url pattern for a condition's PlanDefinition. */
export const conditionUrl = (id: string) => `https://careloop.demo/ConditionModule/${id}`;

/** Minimal structural validation — enough to keep a corrupt resource from breaking the registry. */
export function validateModule(x: unknown): ConditionModule {
  const m = x as Partial<ConditionModule>;
  const bad = (msg: string): never => {
    throw new Error(`Invalid ConditionModule: ${msg}`);
  };
  if (!m || typeof m !== 'object') bad('not an object');
  if (!m.id || typeof m.id !== 'string') bad('missing id');
  if (!m.label || typeof m.label !== 'string') bad('missing label');
  if (!m.conditionCodes?.icd10?.code) bad('missing conditionCodes.icd10');
  if (!m.instrument?.items?.length) bad('instrument has no items');
  if (!m.instrument?.bands?.length) bad('instrument has no bands');
  if (!m.protocol || typeof m.protocol !== 'object') bad('missing protocol');
  // Every band must have a protocol step.
  for (const b of m.instrument!.bands) {
    if (!m.protocol![b.id]) bad(`protocol missing step for band "${b.id}"`);
  }
  if (!m.agent?.globalPrompt) bad('missing agent.globalPrompt');
  if (typeof m.researchTopicTemplate !== 'string') bad('missing researchTopicTemplate');
  if (!Array.isArray(m.expertPanel)) bad('missing expertPanel');
  if (!m.moss?.indexName || !Array.isArray(m.moss?.corpus)) bad('missing moss config');
  return m as ConditionModule;
}

/** Build the PlanDefinition carrier resource for a module. */
export function moduleToPlanDefinition(module: ConditionModule): PlanDefinition {
  return {
    resourceType: 'PlanDefinition',
    status: 'active',
    url: conditionUrl(module.id),
    name: module.id,
    title: module.label,
    type: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/plan-definition-type', code: 'clinical-protocol' }],
      text: 'CareLoop condition module',
    },
    identifier: [{ system: CONDITION_TAG_SYSTEM, value: module.id }],
    meta: { tag: [{ system: CONDITION_TAG_SYSTEM, code: module.id }] },
    extension: [{ url: CONDITION_MODULE_EXT, valueString: JSON.stringify(module) }],
  };
}

/** Parse a PlanDefinition back into a ConditionModule (or null if it isn't a valid carrier). */
export function planDefinitionToModule(pd: PlanDefinition): ConditionModule | null {
  const raw = pd.extension?.find((e) => e.url === CONDITION_MODULE_EXT)?.valueString;
  if (!raw) return null;
  try {
    return validateModule(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Read all stored condition modules from Medplum (empty on any failure). */
export async function readConditionModules(medplum: MedplumClient): Promise<ConditionModule[]> {
  // token search "system|" matches any resource carrying a tag in this system.
  const defs = await medplum.searchResources('PlanDefinition', { _tag: `${CONDITION_TAG_SYSTEM}|`, _count: '100' });
  const out: ConditionModule[] = [];
  for (const pd of defs) {
    const m = planDefinitionToModule(pd);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Create or update the PlanDefinition for a module (idempotent on its canonical
 * url). Returns the resource id.
 */
export async function upsertConditionResource(medplum: MedplumClient, module: ConditionModule): Promise<string> {
  const desired = moduleToPlanDefinition(module);
  const existing = await medplum.searchOne('PlanDefinition', { url: conditionUrl(module.id) });
  const saved = existing
    ? await medplum.updateResource({ ...existing, ...desired, id: existing.id })
    : await medplum.createResource(desired);
  return saved.id!;
}
