import { describe, expect, it } from 'vitest';
import {
  instrumentMeta,
  itemMeta,
  itemSeverity,
  itemSeverityLevel,
} from './instrumentItems';

describe('instrumentMeta', () => {
  it('resolves the shipped modules', () => {
    expect(instrumentMeta('asthma')?.label).toBe('ACT');
    expect(instrumentMeta('depression')?.label).toBe('PHQ-9');
  });

  it('returns null for unknown or missing modules', () => {
    expect(instrumentMeta('copd')).toBeNull();
    expect(instrumentMeta(undefined)).toBeNull();
  });

  it('matches the authoring modules item-for-item', () => {
    expect(instrumentMeta('asthma')!.items.map((i) => i.linkId)).toEqual([
      'act1',
      'act2',
      'act3',
      'act4',
      'act5',
    ]);
    expect(instrumentMeta('depression')!.items).toHaveLength(9);
  });

  it('encodes each instrument’s direction and response range', () => {
    const act = instrumentMeta('asthma')!;
    expect(act.higherIsBetter).toBe(true);
    expect(act.items.every((i) => i.min === 1 && i.max === 5)).toBe(true);

    const phq = instrumentMeta('depression')!;
    expect(phq.higherIsBetter).toBe(false);
    expect(phq.items.every((i) => i.min === 0 && i.max === 3)).toBe(true);
  });

  it('marks PHQ-9 item 9 as a sentinel and nothing else', () => {
    const phq = instrumentMeta('depression')!;
    expect(phq.items.filter((i) => i.sentinel).map((i) => i.linkId)).toEqual(['q9']);
    expect(instrumentMeta('asthma')!.items.some((i) => i.sentinel)).toBe(false);
  });
});

describe('itemMeta', () => {
  it('finds an item by linkId', () => {
    expect(itemMeta('asthma', 'act4')?.short).toBe('Rescue inhaler use');
    expect(itemMeta('depression', 'q9')?.short).toBe('Self-harm thoughts');
  });

  it('returns null for an unknown linkId or module', () => {
    expect(itemMeta('asthma', 'q1')).toBeNull();
    expect(itemMeta('copd', 'act1')).toBeNull();
  });
});

describe('itemSeverity', () => {
  const act = itemMeta('asthma', 'act1')!;
  const phq = itemMeta('depression', 'q1')!;

  it('reads 0 = best and 1 = worst for a higher-is-better item', () => {
    expect(itemSeverity(act, 5, true)).toBe(0);
    expect(itemSeverity(act, 1, true)).toBe(1);
    expect(itemSeverity(act, 3, true)).toBeCloseTo(0.5);
  });

  it('inverts for a higher-is-worse item', () => {
    expect(itemSeverity(phq, 0, false)).toBe(0);
    expect(itemSeverity(phq, 3, false)).toBe(1);
  });

  it('clamps out-of-range responses', () => {
    expect(itemSeverity(act, 99, true)).toBe(0);
    expect(itemSeverity(act, -4, true)).toBe(1);
    expect(itemSeverity(phq, 99, false)).toBe(1);
    expect(itemSeverity(phq, -4, false)).toBe(0);
  });
});

describe('itemSeverityLevel', () => {
  const act = itemMeta('asthma', 'act1')!;
  const phq = itemMeta('depression', 'q1')!;

  it('buckets ACT responses the way clinicians read them', () => {
    expect(itemSeverityLevel(act, 5, true)).toBe('ok');
    expect(itemSeverityLevel(act, 4, true)).toBe('ok');
    expect(itemSeverityLevel(act, 3, true)).toBe('mild');
    expect(itemSeverityLevel(act, 2, true)).toBe('concern');
    expect(itemSeverityLevel(act, 1, true)).toBe('concern');
  });

  it('treats a PHQ-9 response of 2+ as a concern, matching the item threshold', () => {
    expect(itemSeverityLevel(phq, 0, false)).toBe('ok');
    expect(itemSeverityLevel(phq, 1, false)).toBe('ok');
    expect(itemSeverityLevel(phq, 2, false)).toBe('concern');
    expect(itemSeverityLevel(phq, 3, false)).toBe('concern');
  });
});
