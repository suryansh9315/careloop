import type { MedplumClient } from '@medplum/core';
import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import type { ConditionModule } from './types.js';
import { ASTHMA } from './asthma.js';
import { DEPRESSION } from './depression.js';
import { log } from '../logger.js';

/** Tag system used to stamp which condition module a QuestionnaireResponse belongs to. */
export const CONDITION_TAG_SYSTEM = 'https://careloop.demo/condition';

/**
 * The Condition Registry.
 *
 * Code-defined modules are the seed source + offline fallback. When Medplum is
 * configured, initConditionRegistry() hydrates the in-memory map from stored
 * PlanDefinition resources (see store.ts) so treatments can be created/edited as
 * data from the admin UI. Getters stay synchronous — the whole engine (bridge,
 * tools, bot, workers) reads them without awaiting.
 */
export const CODE_MODULES: ConditionModule[] = [ASTHMA, DEPRESSION];

const BY_ID = new Map(CODE_MODULES.map((m) => [m.id, m]));

export function getCondition(id: string): ConditionModule | undefined {
  return BY_ID.get(id);
}

export function requireCondition(id: string): ConditionModule {
  const m = BY_ID.get(id);
  if (!m) throw new Error(`Unknown condition "${id}". Registered: ${[...BY_ID.keys()].join(', ')}`);
  return m;
}

/** For the intake form's treatment dropdown. */
export function listConditions(): { id: string; label: string }[] {
  return [...BY_ID.values()].map((m) => ({ id: m.id, label: m.label }));
}

/** Whether a module is defined in code (built-in) vs. only stored in Medplum. */
export function isBuiltInCondition(id: string): boolean {
  return CODE_MODULES.some((m) => m.id === id);
}

export const DEFAULT_CONDITION_ID = ASTHMA.id;

/** Resolve the module for a patient context (falls back to the default). */
export function getModuleForPatient(p: { conditionModuleId?: string }): ConditionModule {
  return (p.conditionModuleId ? getCondition(p.conditionModuleId) : undefined) ?? requireCondition(DEFAULT_CONDITION_ID);
}

/** Resolve the module from a QuestionnaireResponse's condition tag. */
export function conditionFromQR(qr: QuestionnaireResponse): ConditionModule {
  const tag = qr.meta?.tag?.find((t) => t.system === CONDITION_TAG_SYSTEM)?.code;
  return (tag ? getCondition(tag) : undefined) ?? requireCondition(DEFAULT_CONDITION_ID);
}

/** Replace/insert a module in the in-memory registry (used after an edit). */
export function upsertLocalModule(module: ConditionModule): void {
  BY_ID.set(module.id, module);
}

/**
 * Hydrate the registry from Medplum-stored condition resources, overlaying them
 * on the code-defined seeds. Best-effort: on any failure the code modules stand.
 */
export async function initConditionRegistry(medplum: MedplumClient): Promise<void> {
  try {
    const { readConditionModules } = await import('./store.js');
    const stored = await readConditionModules(medplum);
    for (const m of stored) BY_ID.set(m.id, m);
    log.info('registry.hydrated', { stored: stored.length, total: BY_ID.size });
  } catch (err) {
    log.warn('registry.hydrate_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Re-read one condition from Medplum after it was created/edited. */
export async function refreshCondition(medplum: MedplumClient, id: string): Promise<ConditionModule | undefined> {
  const { readConditionModules } = await import('./store.js');
  const stored = await readConditionModules(medplum);
  const found = stored.find((m) => m.id === id);
  if (found) BY_ID.set(id, found);
  return found;
}

/**
 * Publish the code-defined modules to Medplum as PlanDefinitions (idempotent).
 * Run from `npm run seed` so a fresh project has the built-in treatments as data.
 */
export async function seedConditionResources(medplum: MedplumClient): Promise<void> {
  const { upsertConditionResource } = await import('./store.js');
  for (const m of CODE_MODULES) {
    const id = await upsertConditionResource(medplum, m);
    log.info('registry.seeded', { condition: m.id, planDefinitionId: id });
  }
}
