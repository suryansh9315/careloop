/**
 * Seed the CareLoop demo project (Maria Reyes) and print the created ids in
 * copy-paste .env form.
 *
 *   npm run seed        (or)   node --loader ts-node/esm scripts/seed.ts
 *
 * Requires MEDPLUM_CLIENT_ID + MEDPLUM_CLIENT_SECRET (see config.medplum).
 */
import { medplumEnabled } from '../src/medplum/client.js';
import { seedDemoData } from '../src/medplum/seed.js';

async function main(): Promise<void> {
  if (!medplumEnabled()) {
    console.error(
      'Medplum is not enabled — set MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET before seeding.',
    );
    process.exit(1);
    return;
  }

  const ids = await seedDemoData();

  console.log('\n# CareLoop seed complete — paste into your .env:\n');
  console.log(`SEED_PATIENT_ID=${ids.patientId}`);
  console.log(`SEED_CONDITION_ID=${ids.conditionId}`);
  console.log(`SEED_APPOINTMENT_ID=${ids.appointmentId}`);
  console.log(`SEED_QUESTIONNAIRE_ID=${ids.questionnaireId}`);
  console.log(`# CarePlanId=${ids.carePlanId}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
