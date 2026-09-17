// One-shot credential cleanup (dev machine, server stopped):
//  1. Rotate the demo admin (test@example.com) to a NEW random password —
//     kills the well-known seeded value; new password lands in
//     data/.demo-admin-password (0600, gitignored) like the app's own flow.
//  2. Delete demo-seeded accounts from patient-store.json: patient '12345'
//     (testpat123) and lab 'lab_testlab' (testlab123).
//  3. TEST001 is intentionally kept — it is the active phone-test account.
// Run: node scripts/cleanup-credentials.mjs
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync } from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require2 = createRequire(import.meta.url);
const initSqlJs = require2('C:/Users/Sara/Desktop/ve/VELTRUVIA Server/resources/app/node_modules/sql.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
const dbPath = join(dataDir, 'veltruvia.db');
const storePath = join(dataDir, 'patient-store.json');

if (!existsSync(dbPath)) { console.error('No DB at', dbPath); process.exit(1); }

// ── Backup first ──────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
for (const f of [dbPath, storePath]) {
  if (existsSync(f)) copyFileSync(f, `${f}.pre-cleanup-${stamp}.bak`);
}
console.log('Backups written (.pre-cleanup-*.bak)');

// ── 1. Rotate demo admin password (users table, pbkdf2/sha512 format) ──
const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(dbPath));
const newAdminPw = 'vlt-' + randomBytes(15).toString('base64url');
const salt = randomBytes(16);
const hash = pbkdf2Sync(newAdminPw, salt, 210000, 64, 'sha512');
const ph = `pbkdf2$210000$${salt.toString('hex')}$${hash.toString('hex')}`;
db.run('UPDATE users SET password_hash = ? WHERE email = ?', [ph, 'test@example.com']);
// Persist to the same one-time file the app itself uses
const pwFile = join(dataDir, '.demo-admin-password');
{
  const data = Buffer.from(newAdminPw + '\n', 'utf8');
  try { mkdirSync(dataDir, { recursive: true }); } catch {}
  try { unlinkSync(pwFile); } catch {}
  const fd = openSync(pwFile, 'wx', 0o600);
  writeSync(fd, data); closeSync(fd);
}
console.log('Admin (test@example.com) password ROTATED → data/.demo-admin-password');

// ── 2. Remove demo-seeded accounts from the shared patient store ──
let removed = [];
if (existsSync(storePath)) {
  const store = JSON.parse(readFileSync(storePath, 'utf-8'));
  for (const mrn of ['12345', 'lab_testlab']) {   // seeded in db/index.js initTestData
    if (store[mrn]) { delete store[mrn]; removed.push(mrn); }
  }
  writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
}
console.log(`Demo accounts removed from store: ${removed.join(', ') || '(none found)'}`);
console.log('TEST001 kept (phone-test account).');

// ── 3. Write DB back ──────────────────────────────────────────────
writeFileSync(dbPath, Buffer.from(db.export()));
console.log('DB written back. Done.');
