/**
 * Index every registered condition's knowledge corpus into Moss Cloud so live
 * `getCareContext` queries return real, sourced snippets per condition.
 *
 * Run once after setting MOSS_PROJECT_ID / MOSS_PROJECT_KEY:  npm run moss:index
 */
import { MossClient as MossSDK } from '@moss-dev/moss';
import { config } from '../src/config.js';
import { getCondition, listConditions } from '../src/conditions/registry.js';

async function main() {
  if (!config.moss.enabled) {
    console.error('Set MOSS_PROJECT_ID and MOSS_PROJECT_KEY in .env first.');
    process.exit(1);
  }
  const client = new MossSDK(config.moss.projectId, config.moss.projectKey);

  for (const { id, label } of listConditions()) {
    const module = getCondition(id);
    if (!module) continue;
    const { indexName, corpus } = module.moss;
    const docs = corpus.map((c) => ({ id: c.id, text: c.text }));
    console.log(`Indexing ${docs.length} docs for "${label}" into "${indexName}"…`);
    await client.createIndex(indexName, docs);
    console.log(`Done. Index "${indexName}" is ready for queries.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
