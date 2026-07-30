import type { ActBand, ProtocolStep } from '../types.js';
import { MED } from './codes.js';

/**
 * GINA-based step protocol (simplified, deterministic). The Bot instantiates the
 * step for the computed ACT band — this is the only place treatment logic lives.
 * The voice agent never sees or computes this.
 *
 * Reliever is as-needed ICS-formoterol (GINA Track 1) at every band.
 */
export const ASTHMA_PROTOCOL: Record<ActBand, ProtocolStep> = {
  well: {
    band: 'well',
    // Structured regimen is attached per-band by the asthma module (withRegimen);
    // the base protocol carries none of its own.
    medications: [],
    summary:
      'Well controlled. Continue current controller; reliever = as-needed ICS-formoterol. Consider step-down after 3 months of sustained control.',
    medRxcui: MED.budesonideLow.rxcui,
    medDisplay: MED.budesonideLow.display,
    addOralSteroid: false,
    specialistReferral: false,
    followUpWeeks: 12,
    escalate: false,
    goal: 'Maintain ACT ≥ 20 and no night-time symptoms.',
  },
  partial: {
    band: 'partial',
    medications: [],
    summary:
      'Not well controlled. Step up controller one level after confirming adherence and inhaler technique; reliever = as-needed ICS-formoterol.',
    medRxcui: MED.budesonideFormoterolMed.rxcui,
    medDisplay: MED.budesonideFormoterolMed.display,
    addOralSteroid: false,
    specialistReferral: false,
    followUpWeeks: 5,
    escalate: false,
    goal: 'Reach ACT ≥ 20 within 4–6 weeks.',
  },
  poor: {
    band: 'poor',
    medications: [],
    summary:
      'Very poorly controlled. Step up to ICS-formoterol MART plus a short oral-corticosteroid course; refer to pulmonology. Close follow-up.',
    medRxcui: MED.budesonideFormoterolMed.rxcui,
    medDisplay: MED.budesonideFormoterolMed.display,
    addOralSteroid: true,
    specialistReferral: true,
    followUpWeeks: 1.5,
    escalate: true,
    goal: 'Stabilize symptoms, then reach ACT ≥ 20; urgent care-team review.',
  },
};

export function stepForBand(band: ActBand): ProtocolStep {
  return ASTHMA_PROTOCOL[band];
}
