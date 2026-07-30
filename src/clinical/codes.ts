/**
 * Terminology constants. Code SYSTEM URIs are stable/verified. Specific codes
 * that we write are validated at runtime against Medplum's terminology service
 * (`$validate-code`); the values here are the source list + offline fallback.
 *
 * ⚠️ The 5 ACT item LOINC codes and the med RxCUIs are best-known values — the
 * pipeline resolves/validates them via Medplum ($lookup / $validate-code) and
 * logs a warning if any fails, so a wrong constant degrades gracefully.
 */

export const SYSTEM = {
  LOINC: 'http://loinc.org',
  RXNORM: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  ICD10: 'http://hl7.org/fhir/sid/icd-10-cm',
  SNOMED: 'http://snomed.info/sct',
  CPT: 'http://www.ama-assn.org/go/cpt',
} as const;

/** Anchor condition: moderate persistent asthma, uncomplicated. */
export const CONDITION = {
  icd10: { system: SYSTEM.ICD10, code: 'J45.40', display: 'Moderate persistent asthma, uncomplicated' },
  snomed: { system: SYSTEM.SNOMED, code: '195967001', display: 'Asthma' },
} as const;

/** Asthma Control Test LOINC codes (panel 82674-3). */
export const ACT_LOINC = {
  panel: '82674-3',
  total: '82668-5', // Total score [ACT] — verified
  items: {
    // linkId → { code, text }  (item codes best-known; validated at runtime)
    act1: { code: '82669-3', text: 'Asthma limited activity at work/school/home (past 4 wk)' },
    act2: { code: '82670-1', text: 'Shortness of breath (past 4 wk)' },
    act3: { code: '82671-9', text: 'Night/early symptoms (past 4 wk)' },
    act4: { code: '82672-7', text: 'Rescue inhaler/nebulizer use (past 4 wk)' },
    act5: { code: '82673-5', text: 'Self-rated asthma control (past 4 wk)' }, // verified
  },
} as const;

/**
 * RxNorm fallback codes for asthma medications used by the protocol.
 * These are resolved/validated via Medplum `$lookup` at runtime; treat as
 * fallback only. Displays are reliable; RxCUIs marked TODO to verify.
 */
export const MED = {
  // Rescue / MART reliever
  albuterolHfa: { rxcui: '745679', display: 'Albuterol 90 mcg/actuation inhaler (rescue)' }, // TODO verify rxcui
  // Low-dose controller (seed patient's current med)
  budesonideLow: { rxcui: '745750', display: 'Budesonide 90 mcg/actuation inhaler (low-dose ICS)' }, // TODO verify
  // Step-up: ICS-formoterol MART (medium dose)
  budesonideFormoterolMed: {
    rxcui: '745752',
    display: 'Budesonide 160 mcg / formoterol 4.5 mcg per actuation inhaler (ICS-formoterol MART)',
  }, // TODO verify rxcui
  // Short oral corticosteroid course
  prednisone: { rxcui: '312615', display: 'Prednisone 20 mg oral tablet' }, // TODO verify
} as const;
