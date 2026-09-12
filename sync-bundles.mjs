// Sync tool: VELTRUVIA Server bundle is the canonical source.
// Propagates src/, electron/, public/, and package.json into the other three
// bundles, then restores each app's correct package.json "main" entry
// (Server → main-server.js, clients → their own portal entry).
// Run after ANY edit to the Server bundle:  npm run sync-bundles
import { cpSync, readFileSync, writeFileSync } from 'node:fs';

const CLIENTS = ['VELTRUVIA Doctor', 'VELTRUVIA Patient', 'VELTRUVIA Lab'];
const MAINS = {
  'VELTRUVIA Doctor': 'electron/main-doctor.js',
  'VELTRUVIA Patient': 'electron/main-patient.js',
  'VELTRUVIA Lab': 'electron/main-lab.js',
};
const TREES = ['src', 'electron', 'public'];

for (const client of CLIENTS) {
  for (const tree of TREES) {
    cpSync(`VELTRUVIA Server/resources/app/${tree}`, `${client}/resources/app/${tree}`, { recursive: true, force: true });
  }
  // Keep each client's own entry point (never overwrite with the Server's main)
  const pkg = JSON.parse(readFileSync(`${client}/resources/app/package.json`, 'utf8'));
  const expected = MAINS[client];
  if (pkg.main !== expected) {
    pkg.main = expected;
    writeFileSync(`${client}/resources/app/package.json`, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`${client}: package.json main → ${expected}`);
  }
  console.log(`${client}: synced src/ electron/ public/`);
}
console.log('✅ Bundle sync complete (VELTRUVIA Server is canonical)');
