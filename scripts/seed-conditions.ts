/**
 * Push the code-defined ConditionModules to Medplum as PlanDefinitions.
 *
 * The bridge hydrates its registry from Medplum at startup, so Medplum-stored
 * treatments OVERRIDE the code modules. After editing a module in src/conditions/
 * (questions, KB, prompt, protocol), run this + restart the bridge so the live
 * call uses your changes.
 *
 * Run: npm run seed:conditions
 */
import { getMedplum } from '../src/medplum/client.js';
import { seedConditionResources } from '../src/conditions/registry.js';
import { readConditionModules } from '../src/conditions/store.js';

async function main() {
  const medplum = await getMedplum();
  await seedConditionResources(medplum);
  const stored = await readConditionModules(medplum);
  console.log('Pushed. Stored modules now:');
  for (const m of stored) {
    console.log(`  ${m.id}: ${m.instrument.items.length} instrument items · ${(m.riskQuestions ?? []).length} risk questions · ${m.moss.corpus.length} KB snippets`);
  }
  console.log('\n⚠️  Restart the bridge (npm run bridge) so it re-hydrates from Medplum.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
