/**
 * Deterministic medication-safety checks over a drafted regimen. Pure, no I/O.
 *
 * ⚠️ This is a DEMO-GRADE stub. In production the interaction / duplicate /
 * allergy logic MUST be delegated to a real clinical drug-knowledge service
 * (e.g. First Databank (FDB), Medi-Span, or the NLM RxNav interaction API).
 * The hardcoded tables below are intentionally tiny and illustrative only.
 */

import type { MedOrder, SafetyFlag } from '../types.js';

/**
 * Map a med (by display/ingredient text) to a coarse ingredient/class token.
 * Used for allergy substring matching + duplicate-therapy grouping. A real
 * implementation would resolve the RxCUI to its ingredient(s)/ATC class.
 */
type Classified = { med: MedOrder; ingredients: string[] };

/** Tiny display→ingredient/class lexicon. Placeholder for RxNorm ingredient resolution. */
const INGREDIENT_LEXICON: { match: string; ingredients: string[] }[] = [
  { match: 'budesonide', ingredients: ['budesonide', 'corticosteroid', 'inhaled-corticosteroid'] },
  { match: 'formoterol', ingredients: ['formoterol', 'laba'] },
  { match: 'prednisone', ingredients: ['prednisone', 'corticosteroid', 'systemic-corticosteroid'] },
  { match: 'methylprednisolone', ingredients: ['methylprednisolone', 'corticosteroid', 'systemic-corticosteroid'] },
  { match: 'albuterol', ingredients: ['albuterol', 'saba'] },
  { match: 'sertraline', ingredients: ['sertraline', 'ssri', 'serotonergic'] },
  { match: 'fluoxetine', ingredients: ['fluoxetine', 'ssri', 'serotonergic'] },
  { match: 'tramadol', ingredients: ['tramadol', 'opioid', 'serotonergic'] },
  { match: 'linezolid', ingredients: ['linezolid', 'maoi', 'serotonergic'] },
  { match: 'phenelzine', ingredients: ['phenelzine', 'maoi', 'serotonergic'] },
];

/** Resolve a free-text drug string into ingredient/class tokens. */
function classify(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = new Set<string>();
  for (const entry of INGREDIENT_LEXICON) {
    if (lower.includes(entry.match)) {
      for (const ing of entry.ingredients) tokens.add(ing);
    }
  }
  return [...tokens];
}

/**
 * Known pairwise interaction rules keyed by class/ingredient token. STUB — a
 * production system replaces this with a real interaction service call.
 */
const INTERACTION_RULES: { a: string; b: string; message: string }[] = [
  {
    a: 'serotonergic',
    b: 'maoi',
    message: 'Serotonin syndrome risk: a serotonergic agent (e.g. SSRI) combined with an MAOI. Contraindicated — separate by the required washout.',
  },
  {
    a: 'ssri',
    b: 'tramadol',
    message: 'Serotonin syndrome risk: SSRI combined with tramadol. Monitor for serotonergic toxicity and consider an alternative analgesic.',
  },
  {
    a: 'systemic-corticosteroid',
    b: 'systemic-corticosteroid',
    message: 'Multiple systemic corticosteroids: additive corticosteroid exposure. Confirm this is an intentional single course.',
  },
];

/**
 * Run allergy, duplicate-therapy, and interaction checks over a drafted
 * regimen combined with the patient's current medications. Returns a possibly
 * empty list of SafetyFlags; a `critical` flag should gate one-click approval.
 */
export function checkRegimenSafety(input: {
  medications: MedOrder[];
  allergies: string[];
  currentMedications: string[];
}): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  const allergies = input.allergies.map((a) => a.trim().toLowerCase()).filter(Boolean);

  const drafted: Classified[] = input.medications.map((med) => ({
    med,
    ingredients: classify(`${med.display} ${med.doseText ?? ''}`),
  }));

  // ── allergy (critical) ────────────────────────────────────────────────────
  // A patient allergy string matches a med's display or a resolved ingredient
  // (case-insensitive substring, either direction).
  for (const { med, ingredients } of drafted) {
    const display = med.display.toLowerCase();
    for (const allergy of allergies) {
      const hit =
        display.includes(allergy) ||
        allergy.includes(display) ||
        ingredients.some((ing) => ing.includes(allergy) || allergy.includes(ing));
      if (hit) {
        flags.push({
          severity: 'critical',
          kind: 'allergy',
          message: `Patient reports an allergy to "${allergy}" which matches drafted medication "${med.display}". Do not prescribe without review.`,
        });
      }
    }
  }

  // ── duplicate therapy (warning) ───────────────────────────────────────────
  // Two drafted meds sharing a specific ingredient/class token.
  const IGNORE_CLASSES = new Set(['serotonergic', 'corticosteroid']); // too coarse to flag as dup
  for (let i = 0; i < drafted.length; i++) {
    for (let j = i + 1; j < drafted.length; j++) {
      const shared = drafted[i]!.ingredients.filter(
        (ing) => !IGNORE_CLASSES.has(ing) && drafted[j]!.ingredients.includes(ing),
      );
      if (shared.length) {
        flags.push({
          severity: 'warning',
          kind: 'duplicate',
          message: `Possible duplicate therapy: "${drafted[i]!.med.display}" and "${drafted[j]!.med.display}" share ${shared.join(', ')}. Confirm this is intentional (e.g. MART + reliever using the same inhaler).`,
        });
      }
    }
  }

  // ── interactions (warning) ────────────────────────────────────────────────
  // Check drafted meds against each other AND against current medications.
  const currentTokens = input.currentMedications.flatMap((m) => classify(m));
  const allTokens: string[][] = [...drafted.map((d) => d.ingredients)];
  if (currentTokens.length) allTokens.push(currentTokens);

  const seenRules = new Set<string>();
  for (const rule of INTERACTION_RULES) {
    // Same-class interactions (e.g. two systemic corticosteroids) need two
    // distinct sources carrying the token.
    if (rule.a === rule.b) {
      const carriers = allTokens.filter((toks) => toks.includes(rule.a)).length;
      if (carriers >= 2) {
        flags.push({ severity: 'warning', kind: 'interaction', message: rule.message });
      }
      continue;
    }
    const hasA = allTokens.some((toks) => toks.includes(rule.a));
    const hasB = allTokens.some((toks) => toks.includes(rule.b));
    const key = [rule.a, rule.b].sort().join('|');
    if (hasA && hasB && !seenRules.has(key)) {
      seenRules.add(key);
      flags.push({ severity: 'warning', kind: 'interaction', message: rule.message });
    }
  }

  return flags;
}
