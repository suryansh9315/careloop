/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MEDPLUM_BASE_URL?: string;
  readonly VITE_MEDPLUM_CLIENT_ID?: string;
  readonly VITE_MEDPLUM_PROJECT_ID?: string;
  /** patient to load */
  readonly VITE_PATIENT_ID?: string;
  /** CareLoop bridge backend (intake + calling); defaults to http://localhost:8080 */
  readonly VITE_BRIDGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
