import { config } from '../config.js';
import { log } from '../logger.js';
import type { MossClient, MossSnippet } from '../types.js';

// Moss ships a native binding. Load it only for live-Moss deployments so the
// documented mock/fallback mode can run on hosts whose glibc cannot load that
// optional binary (for example Amazon Linux 2023).
type MossSDKConstructor = typeof import('@moss-dev/moss').MossClient;
type MossSDKInstance = InstanceType<MossSDKConstructor>;
let mossSDKConstructor: MossSDKConstructor | undefined;

async function loadMossSDK(): Promise<MossSDKConstructor> {
  mossSDKConstructor ??= (await import('@moss-dev/moss')).MossClient;
  return mossSDKConstructor;
}

/**
 * Moss = mid-call clinic-knowledge grounding (RAG). Used by the `getCareContext`
 * tool so the voice agent can answer a patient question with a patient-safe,
 * sourced snippet instead of improvising.
 *
 * - Live: POST the query to `config.moss.baseUrl` with the API key, map the
 *   response rows to `MossSnippet[]`.
 * - Mock (default / no key): return canned, patient-safe asthma snippets chosen
 *   by a simple keyword match, so `npm run simulate` grounds with zero secrets.
 */

// ── Canned, patient-safe asthma knowledge (mock corpus) ─────────────────────
// Deliberately conservative, education-only content. No dosing decisions.
type CannedEntry = { keywords: string[]; snippet: MossSnippet };

const CANNED: CannedEntry[] = [
  {
    keywords: ['inhaler technique', 'how to use', 'use my inhaler', 'spacer', 'prime', 'breathe in'],
    snippet: {
      text:
        'Proper inhaler technique: shake the inhaler, breathe out fully, seal your lips around the ' +
        'mouthpiece (or spacer), press once as you begin a slow deep breath in, then hold your breath ' +
        'about 10 seconds. Using a spacer helps more medicine reach your lungs. Rinse your mouth after ' +
        'a steroid (controller) inhaler.',
      source: 'Clinic patient handout: Inhaler Technique (GINA-aligned)',
      score: 0.94,
    },
  },
  {
    keywords: ['act', 'act score', 'control test', 'what does', 'my score mean', 'questionnaire'],
    snippet: {
      text:
        'The Asthma Control Test (ACT) is a 5-question check of how well your asthma has been controlled ' +
        'over the last 4 weeks. Scores range 5–25: 20–25 usually means well-controlled, 16–19 means ' +
        'partly controlled, and 5–15 suggests poor control that your care team may want to act on. It ' +
        'is a conversation starter, not a diagnosis.',
      source: 'Clinic patient handout: Understanding Your ACT Score',
      score: 0.92,
    },
  },
  {
    keywords: ['rescue', 'controller', 'reliever', 'difference', 'which inhaler', 'blue inhaler', 'daily'],
    snippet: {
      text:
        'A reliever (rescue) inhaler works fast to open your airways during symptoms or an attack. A ' +
        'controller inhaler contains a low-dose steroid you take regularly to reduce inflammation and ' +
        'prevent symptoms — it does not give quick relief. Some newer combination inhalers can serve ' +
        'both roles; follow the specific plan your clinician gives you.',
      source: 'Clinic patient handout: Rescue vs Controller Inhalers',
      score: 0.9,
    },
  },
  {
    keywords: ['cat', 'allergen', 'pet', 'dust', 'trigger', 'avoid', 'dander', 'pollen'],
    snippet: {
      text:
        'Reducing exposure to your triggers helps control asthma. For cat or pet dander: keep pets out ' +
        'of the bedroom, wash hands after contact, use a HEPA filter, and vacuum often. For dust mites: ' +
        'use allergen-proof mattress/pillow covers and wash bedding in hot water weekly. Track which ' +
        'triggers set off your symptoms and share the pattern with your care team.',
      source: 'Clinic patient handout: Allergen & Trigger Avoidance',
      score: 0.88,
    },
  },
  {
    keywords: ['night', 'nighttime', 'wake', 'waking', 'sleep', 'cough at night', 'early morning'],
    snippet: {
      text:
        'Waking at night from coughing, wheezing, or chest tightness is a sign your asthma may not be ' +
        'fully controlled. Note how many nights per week it happens — that detail helps your care team ' +
        'adjust your plan. Keep your reliever inhaler nearby, and if nighttime symptoms are frequent or ' +
        'worsening, let your clinician know.',
      source: 'Clinic patient handout: Nighttime Asthma Symptoms',
      score: 0.87,
    },
  },
];

const FALLBACK: MossSnippet = {
  text:
    'Asthma control is best supported by taking your controller medicine as prescribed, knowing your ' +
    'triggers, and using correct inhaler technique. If your symptoms are getting worse, please share ' +
    'that with your care team so your plan can be reviewed.',
  source: 'Clinic patient handout: Asthma Basics',
  score: 0.6,
};

/** The knowledge corpus to index into Moss (reused by `npm run moss:index`). */
export function knowledgeCorpus(): { id: string; text: string }[] {
  return CANNED.map((e, i) => ({ id: `kb-${i + 1}`, text: e.snippet.text }));
}

function mockRetrieve(query: string, k: number): MossSnippet[] {
  const q = query.toLowerCase();
  const scored = CANNED
    .map((e) => {
      const hits = e.keywords.reduce((n, kw) => (q.includes(kw) ? n + 1 : n), 0);
      return { hits, snippet: e.snippet };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.snippet.score - a.snippet.score)
    .map((s) => s.snippet);

  const results = (scored.length > 0 ? scored : [FALLBACK]).slice(0, Math.max(1, k));
  return results;
}

/** A per-condition corpus entry the mock client can retrieve over. */
export type MossCorpusEntry = { id: string; text: string; source: string };

/**
 * Retrieve over an arbitrary condition corpus with a simple keyword/substring
 * scorer: count how many query tokens appear in the entry text, breaking ties by
 * total substring overlap. Falls back to the highest-scoring entry when nothing
 * matches, so retrieval never returns empty for a non-empty corpus.
 */
function corpusRetrieve(corpus: MossCorpusEntry[], query: string, k: number): MossSnippet[] {
  const q = query.toLowerCase();
  const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const scored = corpus
    .map((e) => {
      const text = e.text.toLowerCase();
      const hits = tokens.reduce((n, t) => (text.includes(t) ? n + 1 : n), 0);
      const score = tokens.length ? hits / tokens.length : 0;
      return { hits, score, entry: e };
    })
    .sort((a, b) => b.hits - a.hits || b.score - a.score);

  const matched = scored.filter((s) => s.hits > 0);
  const chosen = (matched.length > 0 ? matched : scored).slice(0, Math.max(1, k));
  return chosen.map((s) => ({
    text: s.entry.text,
    source: s.entry.source,
    score: matched.length > 0 ? Math.max(0.5, Math.min(0.99, 0.5 + s.score / 2)) : 0.6,
  }));
}

class MockMossClient implements MossClient {
  constructor(private readonly corpus?: MossCorpusEntry[]) {}

  async retrieve(query: string, opts?: { k?: number }): Promise<MossSnippet[]> {
    const k = opts?.k ?? 3;
    const results =
      this.corpus && this.corpus.length > 0
        ? corpusRetrieve(this.corpus, query, k)
        : mockRetrieve(query, k);
    log.info('moss.mock', { query, k, returned: results.length });
    return results;
  }
}

/**
 * Live client backed by the official Moss SDK (`@moss-dev/moss`). The SDK points
 * at Moss Cloud using the project id + key (no base URL needed). We `loadIndex`
 * once, then `query` per call. Any error degrades to the canned corpus so a live
 * call never fails on retrieval. Index it first with `npm run moss:index`.
 */
class LiveMossClient implements MossClient {
  private sdk?: MossSDKInstance;
  private loaded = false;

  constructor(
    private readonly indexName: string,
    /** used for the fallback path when live retrieval fails or is empty */
    private readonly corpus?: MossCorpusEntry[],
  ) {}

  private async getSDK(): Promise<MossSDKInstance> {
    if (!this.sdk) {
      const MossSDK = await loadMossSDK();
      this.sdk = new MossSDK(config.moss.projectId, config.moss.projectKey);
    }
    return this.sdk;
  }

  private fallback(query: string, k: number): MossSnippet[] {
    return this.corpus && this.corpus.length > 0
      ? corpusRetrieve(this.corpus, query, k)
      : mockRetrieve(query, k);
  }

  async retrieve(query: string, opts?: { k?: number }): Promise<MossSnippet[]> {
    const k = opts?.k ?? 3;
    try {
      const sdk = await this.getSDK();
      if (!this.loaded) {
        await sdk.loadIndex(this.indexName);
        this.loaded = true;
      }
      const results = (await sdk.query(this.indexName, query, { topK: k })) as {
        docs?: Array<{ id?: string; text?: string; score?: number }>;
        timeTakenInMs?: number;
      };
      const rows = results.docs ?? [];
      const mapped: MossSnippet[] = rows
        .filter((r) => typeof r.text === 'string' && r.text.length > 0)
        .map((r) => ({
          text: r.text as string,
          source: `Moss index: ${this.indexName}`,
          score: typeof r.score === 'number' ? r.score : 0.5,
        }))
        .slice(0, k);
      if (mapped.length === 0) throw new Error('moss returned no usable rows');
      log.info('moss.live', { query, k, ms: results.timeTakenInMs, returned: mapped.length });
      return mapped;
    } catch (err) {
      log.warn('moss.live.fallback', { error: (err as Error).message });
      return this.fallback(query, k);
    }
  }
}

/**
 * Build a Moss client. Pass a condition module's `moss.indexName` + `moss.corpus`
 * to make retrieval condition-specific:
 *   getMossClient({ indexName: module.moss.indexName, corpus: module.moss.corpus })
 *
 * - Live (Moss configured): queries `opts.indexName ?? config.moss.indexName`,
 *   falling back to the provided corpus (or the built-in asthma corpus) on error.
 * - Mock: retrieves over `opts.corpus` when provided, else the built-in asthma
 *   canned corpus.
 */
export function getMossClient(opts?: {
  indexName?: string;
  corpus?: MossCorpusEntry[];
}): MossClient {
  if (config.moss.enabled) {
    return new LiveMossClient(opts?.indexName ?? config.moss.indexName, opts?.corpus);
  }
  return new MockMossClient(opts?.corpus);
}
