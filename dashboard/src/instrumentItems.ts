/**
 * Per-item metadata for the shipped instruments (ACT, PHQ-9) — a self-contained
 * mirror of the authoring modules in the root project's `src/conditions/`, kept
 * dependency-free so the dashboard package stands alone (same pattern as
 * `types.ts`).
 *
 * This is what lets the review surfaces answer "*which questions* drove this
 * score?" rather than only showing the total. `ActResult.answers` carries the
 * raw `linkId` → value pairs; everything needed to render them lives here.
 *
 * ⚠️ Keep `linkId`, `min` and `max` in sync with:
 *   - ACT   → `src/clinical/act.ts` (ACT_ITEMS), 1–5, higher = better
 *   - PHQ-9 → `src/conditions/depression.ts` (PHQ9), 0–3, higher = worse
 */

export type InstrumentItemMeta = {
  linkId: string;
  /** Short label for dense chart axes (≤ ~24 chars). */
  short: string;
  /** The question as the voice agent asks it. */
  prompt: string;
  /** What the scale's endpoints mean, low → high. */
  scale: string;
  /** Inclusive response range. */
  min: number;
  max: number;
  /**
   * A response at the worst end of this item triggers a distinct clinical
   * protocol on its own, independent of the total (PHQ-9 item 9 → 988).
   */
  sentinel?: boolean;
};

export type InstrumentMeta = {
  /** Short instrument name, e.g. 'ACT'. */
  label: string;
  /** Full instrument name for tooltips and aria labels. */
  longLabel: string;
  /** True when a HIGHER per-item response is the better outcome (ACT). */
  higherIsBetter: boolean;
  items: InstrumentItemMeta[];
};

const ACT: InstrumentMeta = {
  label: 'ACT',
  longLabel: 'Asthma Control Test',
  higherIsBetter: true,
  items: [
    {
      linkId: 'act1',
      short: 'Activity limitation',
      prompt:
        'In the past 4 weeks, how much of the time did your asthma keep you from getting as much done at work, school, or at home?',
      scale: '1 = all of the time … 5 = none of the time',
      min: 1,
      max: 5,
    },
    {
      linkId: 'act2',
      short: 'Shortness of breath',
      prompt: 'During the past 4 weeks, how often have you had shortness of breath?',
      scale: '1 = more than once a day … 5 = not at all',
      min: 1,
      max: 5,
    },
    {
      linkId: 'act3',
      short: 'Night-time waking',
      prompt:
        'During the past 4 weeks, how often did your asthma symptoms wake you up at night or earlier than usual in the morning?',
      scale: '1 = 4+ nights a week … 5 = not at all',
      min: 1,
      max: 5,
    },
    {
      linkId: 'act4',
      short: 'Rescue inhaler use',
      prompt: 'During the past 4 weeks, how often have you used your rescue inhaler or nebulizer?',
      scale: '1 = 3+ times per day … 5 = not at all',
      min: 1,
      max: 5,
    },
    {
      linkId: 'act5',
      short: 'Self-rated control',
      prompt: 'How would you rate your asthma control during the past 4 weeks?',
      scale: '1 = not controlled at all … 5 = completely controlled',
      min: 1,
      max: 5,
    },
  ],
};

const PHQ9_SCALE =
  '0 = not at all … 3 = nearly every day';

const PHQ9: InstrumentMeta = {
  label: 'PHQ-9',
  longLabel: 'Patient Health Questionnaire-9',
  higherIsBetter: false,
  items: (
    [
      ['q1', 'Interest / pleasure', 'Little interest or pleasure in doing things'],
      ['q2', 'Depressed mood', 'Feeling down, depressed, or hopeless'],
      ['q3', 'Sleep', 'Trouble falling or staying asleep, or sleeping too much'],
      ['q4', 'Energy', 'Feeling tired or having little energy'],
      ['q5', 'Appetite', 'Poor appetite or overeating'],
      [
        'q6',
        'Self-worth',
        'Feeling bad about yourself, or that you are a failure or have let people down',
      ],
      [
        'q7',
        'Concentration',
        'Trouble concentrating on things, such as reading or watching television',
      ],
      [
        'q8',
        'Psychomotor',
        'Moving or speaking so slowly that others could notice — or being fidgety/restless',
      ],
      [
        'q9',
        'Self-harm thoughts',
        'Thoughts that you would be better off dead, or of hurting yourself',
      ],
    ] as const
  ).map(([linkId, short, stem]) => ({
    linkId,
    short,
    prompt: `Over the last 2 weeks, how often have you been bothered by: ${stem}?`,
    scale: PHQ9_SCALE,
    min: 0,
    max: 3,
    // Any endorsement of item 9 escalates on its own, regardless of the total.
    ...(linkId === 'q9' ? { sentinel: true as const } : {}),
  })),
};

const BY_MODULE: Record<string, InstrumentMeta> = {
  asthma: ACT,
  depression: PHQ9,
};

/** Instrument metadata for a condition module id, or null when unknown. */
export function instrumentMeta(moduleId: string | undefined): InstrumentMeta | null {
  if (!moduleId) return null;
  return BY_MODULE[moduleId] ?? null;
}

/** Item metadata by linkId within a module, or null when unknown. */
export function itemMeta(
  moduleId: string | undefined,
  linkId: string,
): InstrumentItemMeta | null {
  return instrumentMeta(moduleId)?.items.find((i) => i.linkId === linkId) ?? null;
}

/**
 * How bad a single response is, normalised to 0 (best) … 1 (worst), so items
 * measured on different scales and directions can share one severity ramp.
 * Values outside the item's range are clamped.
 */
export function itemSeverity(item: InstrumentItemMeta, value: number, higherIsBetter: boolean): number {
  const span = item.max - item.min;
  if (span <= 0) return 0;
  const clamped = Math.max(item.min, Math.min(item.max, value));
  const fraction = (clamped - item.min) / span;
  return higherIsBetter ? 1 - fraction : fraction;
}

/** Coarse severity bucket for an item response, for status colouring + labels. */
export function itemSeverityLevel(
  item: InstrumentItemMeta,
  value: number,
  higherIsBetter: boolean,
): 'ok' | 'mild' | 'concern' {
  const s = itemSeverity(item, value, higherIsBetter);
  if (s >= 0.66) return 'concern';
  if (s >= 0.34) return 'mild';
  return 'ok';
}
