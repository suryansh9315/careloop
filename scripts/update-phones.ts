/**
 * One-off: set every Patient's phone to a single number (for live-call testing).
 * Usage: npx tsx scripts/update-phones.ts  [+E164number]
 */
import { getMedplum, medplumEnabled } from '../src/medplum/client.js';

const NEW_PHONE = process.argv[2]?.trim() || '+919315566594';

async function main() {
  if (!medplumEnabled()) {
    console.error('Medplum not configured (set MEDPLUM_CLIENT_ID/SECRET).');
    process.exit(1);
  }
  const medplum = await getMedplum();
  const patients = await medplum.searchResources('Patient', { _count: '1000' });
  console.log(`Found ${patients.length} patient(s). Setting phone → ${NEW_PHONE}`);

  let updated = 0;
  for (const p of patients) {
    const telecom = (p.telecom ?? []).filter((t) => t.system !== 'phone');
    telecom.push({ system: 'phone', value: NEW_PHONE, use: 'mobile' });
    await medplum.updateResource({ ...p, telecom });
    updated++;
    const name = `${p.name?.[0]?.given?.[0] ?? ''} ${p.name?.[0]?.family ?? ''}`.trim() || '(no name)';
    console.log(`  ✓ ${name} — Patient/${p.id}`);
  }
  console.log(`Done. Updated ${updated} patient(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
