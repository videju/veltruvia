// One-shot credential hardening for patient-store.json.
//  - Any `pass` / `password` value that is not a pbkdf2 hash gets hashed
//    with the server's v2 scheme (pbkdf2v2:210000:salt:b64, sha256) so
//    verifyUiPassword() keeps working unchanged.
//  - `passPlain` fields are deleted in every case.
//  - Writes a timestamped backup next to the store before touching it.
// Run: node scripts/migrate-credentials.mjs [path-to-patient-store.json]
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const storePath = process.argv[2] || join(root, 'data', 'patient-store.json');

if (!existsSync(storePath)) {
  console.error(`No store at ${storePath} — nothing to do.`);
  process.exit(1);
}

const V2_ITERATIONS = 210000;
const hashV2 = (pw) => {
  const salt = randomBytes(16).toString('base64url');
  const h = pbkdf2Sync(String(pw), salt, V2_ITERATIONS, 32, 'sha256').toString('base64');
  return `pbkdf2v2:${V2_ITERATIONS}:${salt}:${h}`;
};

// Backup first
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = `${storePath}.pre-migration-${stamp}.bak`;
copyFileSync(storePath, backupPath);
console.log(`Backup written: ${backupPath}`);

const store = JSON.parse(readFileSync(storePath, 'utf-8'));
let hashed = 0, stripped = 0;

for (const [mrn, rec] of Object.entries(store)) {
  if (!rec || typeof rec !== 'object') continue;

  // Patient credential field
  if (rec.pass !== undefined && rec.pass !== null && !String(rec.pass).startsWith('pbkdf2')) {
    rec.pass = hashV2(rec.pass);
    hashed++;
    console.log(`  [${mrn}] plaintext 'pass' → pbkdf2v2 hash`);
  }
  // Lab credential field (same verifier family)
  if (rec.password !== undefined && rec.password !== null && !String(rec.password).startsWith('pbkdf2')) {
    rec.password = hashV2(rec.password);
    hashed++;
    console.log(`  [${mrn}] plaintext 'password' → pbkdf2v2 hash`);
  }
  // Plaintext shadow field goes away in every case
  if (rec.passPlain !== undefined) {
    delete rec.passPlain;
    stripped++;
    console.log(`  [${mrn}] removed passPlain`);
  }
}

writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
console.log(`\nDone. ${hashed} credential(s) hashed, ${stripped} passPlain field(s) removed.`);
console.log('Users log in with the same passwords as before — nothing else changes.');
