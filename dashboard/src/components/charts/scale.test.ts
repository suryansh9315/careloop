import { describe, expect, it } from 'vitest';
import { bandForScore, scaleForModule, type ScaleSpec } from './scale';

describe('scaleForModule', () => {
  it('returns the asthma (ACT) scale', () => {
    const s = scaleForModule('asthma');
    expect(s.instrument).toBe('ACT');
    expect(s.instrumentLong).toBe('Asthma Control Test');
    expect(s.min).toBe(5);
    expect(s.max).toBe(25);
    expect(s.higherIsBetter).toBe(true);
    expect(s.target).toBe(20);
    expect(s.mcid).toBe(3);
    expect(s.bands.map((b) => [b.id, b.min, b.max, b.tone])).toEqual([
      ['poor', 5, 15, 'red'],
      ['partial', 16, 19, 'amber'],
      ['well', 20, 25, 'green'],
    ]);
  });

  it('returns the depression (PHQ-9) scale', () => {
    const s = scaleForModule('depression');
    expect(s.instrument).toBe('PHQ-9');
    expect(s.instrumentLong).toBe('Patient Health Questionnaire-9');
    expect(s.min).toBe(0);
    expect(s.max).toBe(27);
    expect(s.higherIsBetter).toBe(false);
    expect(s.target).toBe(5);
    expect(s.mcid).toBe(5);
    expect(s.bands.map((b) => [b.id, b.min, b.max, b.tone])).toEqual([
      ['minimal', 0, 4, 'green'],
      ['mild', 5, 9, 'green'],
      ['moderate', 10, 14, 'amber'],
      ['moderately-severe', 15, 19, 'red'],
      ['severe', 20, 27, 'red'],
    ]);
  });

  it('falls back to a neutral gray scale for an unknown module', () => {
    const s = scaleForModule('unknown-condition');
    expect(s.min).toBe(0);
    expect(s.max).toBe(25);
    expect(s.higherIsBetter).toBe(true);
    expect(s.target).toBe(20);
    expect(s.bands).toHaveLength(1);
    expect(s.bands[0].tone).toBe('gray');
  });
});

describe('bandForScore', () => {
  const act = scaleForModule('asthma');
  const phq9 = scaleForModule('depression');

  it('ACT: covers every band boundary inclusively', () => {
    expect(bandForScore(act, 5).id).toBe('poor');
    expect(bandForScore(act, 15).id).toBe('poor');
    expect(bandForScore(act, 16).id).toBe('partial');
    expect(bandForScore(act, 19).id).toBe('partial');
    expect(bandForScore(act, 20).id).toBe('well');
    expect(bandForScore(act, 25).id).toBe('well');
  });

  it('ACT: clamps out-of-range scores to the nearest edge band', () => {
    expect(bandForScore(act, 0).id).toBe('poor');
    expect(bandForScore(act, -100).id).toBe('poor');
    expect(bandForScore(act, 30).id).toBe('well');
    expect(bandForScore(act, 1000).id).toBe('well');
  });

  it('PHQ-9: covers every band boundary inclusively', () => {
    expect(bandForScore(phq9, 0).id).toBe('minimal');
    expect(bandForScore(phq9, 4).id).toBe('minimal');
    expect(bandForScore(phq9, 5).id).toBe('mild');
    expect(bandForScore(phq9, 9).id).toBe('mild');
    expect(bandForScore(phq9, 10).id).toBe('moderate');
    expect(bandForScore(phq9, 14).id).toBe('moderate');
    expect(bandForScore(phq9, 15).id).toBe('moderately-severe');
    expect(bandForScore(phq9, 19).id).toBe('moderately-severe');
    expect(bandForScore(phq9, 20).id).toBe('severe');
    expect(bandForScore(phq9, 27).id).toBe('severe');
  });

  it('PHQ-9: clamps out-of-range scores to the nearest edge band', () => {
    expect(bandForScore(phq9, -5).id).toBe('minimal');
    expect(bandForScore(phq9, 100).id).toBe('severe');
  });
});

describe('delta / MCID direction logic (used by DeltaBadge)', () => {
  function isImprovement(scale: ScaleSpec, delta: number): boolean {
    return scale.higherIsBetter ? delta > 0 : delta < 0;
  }
  function isMeaningful(scale: ScaleSpec, delta: number): boolean {
    return Math.abs(delta) >= scale.mcid;
  }

  const act = scaleForModule('asthma'); // higherIsBetter: true, mcid 3
  const phq9 = scaleForModule('depression'); // higherIsBetter: false, mcid 5

  it('higher-is-better (ACT): an increase is an improvement', () => {
    expect(isImprovement(act, 4)).toBe(true);
    expect(isImprovement(act, -4)).toBe(false);
    expect(isImprovement(act, 0)).toBe(false);
  });

  it('higher-is-worse (PHQ-9): a decrease is an improvement', () => {
    expect(isImprovement(phq9, -6)).toBe(true);
    expect(isImprovement(phq9, 6)).toBe(false);
    expect(isImprovement(phq9, 0)).toBe(false);
  });

  it('flags clinically meaningful change at/above the instrument MCID', () => {
    expect(isMeaningful(act, 3)).toBe(true);
    expect(isMeaningful(act, -3)).toBe(true);
    expect(isMeaningful(act, 2)).toBe(false);

    expect(isMeaningful(phq9, 5)).toBe(true);
    expect(isMeaningful(phq9, -5)).toBe(true);
    expect(isMeaningful(phq9, 4)).toBe(false);
  });
});
