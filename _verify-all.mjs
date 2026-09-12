// Run the full 53-check verification against all four app bundles, sequentially.
// Usage: npm run verify  (or: node _verify-all.mjs)
import { spawnSync } from 'node:child_process';

const APPS = [
  ['VELTRUVIA Server/resources/app', 'Server'],
  ['VELTRUVIA Doctor/resources/app', 'Doctor'],
  ['VELTRUVIA Patient/resources/app', 'Patient'],
  ['VELTRUVIA Lab/resources/app', 'Lab'],
];

let failed = 0;
for (const [dir, name] of APPS) {
  const r = spawnSync(process.execPath, ['_verify-app.mjs', dir, name], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log('\n═══════════════════════════════════════════════');
if (failed === 0) console.log('  ✅ ALL 4 APPS: 53/53 feature checks passed');
else console.log(`  ❌ ${failed} of 4 apps had failing checks`);
console.log('═══════════════════════════════════════════════');
process.exit(failed === 0 ? 0 : 1);
