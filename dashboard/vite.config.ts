import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone CareLoop dashboard. Runs fully offline in mock mode (VITE_MOCK=1),
// or against a Medplum server when VITE_MEDPLUM_BASE_URL + VITE_MEDPLUM_CLIENT_ID are set.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
  },
});
