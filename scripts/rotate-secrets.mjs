// One-shot PHI_ENCRYPTION_KEY + JWT_SECRET rotation.
// Re-encrypts every v1.* PHI blob in data/veltruvia.db with a fresh key,
// swaps both secrets in .env, then verifies 100% decryptability with the
// new key AND failure with the old one.
//
// Safety design:
//   - Refuses to run while a live process holds the DB writer lock.
//   - Old key is read from .env, used only in memory, then replaced.
//   - Never logs key material or plaintext.
//   - Aborts before writing if ANY blob fails to decrypt with the old key.
//
// Run: node scripts/rotate-secrets.mjs [--db path] [--env path]
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, createDecipheriv, createCipheriv } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.argv.includes('--db')
  ? resolve(process.argv[process.argv.indexOf('--db') + 1])
  : join(root, 'data', 'veltruvia.db');
const envPath = process.argv.includes('--env')
  ? resolve(process.argv[process.argv.indexOf('--env') + 1])
  : join(root, '.env');

const die = (msg) => { console.error('❌ ' + msg); process.exit(1); };
const ok = (msg) => console.log('  ✅ ' + msg);

// ── Load .env (simple KEY=VALUE parser, no dependency) ────────────
if (!existsSync(envPath)) die(`.env not found at ${envPath}`);
const envLines = readFileSync(envPath, 'utf8').split(/\r?\n/);
const getEnv = (k) => {
  const line = envLines.find(l => l.startsWith(k + '='));
  return line ? line.slice(k.length + 1).trim() : null;
};

const oldKeyHex = getEnv('PHI_ENCRYPTION_KEY');
if (!oldKeyHex || !/^[0-9a-fA-F]{64}$/.test(oldKeyHex)) die('PHI_ENCRYPTION_KEY missing or not 64-hex in .env');
const oldJwt = getEnv('JWT_SECRET');
if (!oldJwt) die('JWT_SECRET missing in .env');

// ── Refuse to touch a locked (live) database ──────────────────────
const lockPath = dbPath + '.lock';
if (existsSync(lockPath)) {
  die(`Writer lock present (${lockPath}) — the server appears to be running. Stop VELTRUVIA Server first.`);
}

// ── Open DB via the app bundle's sql.js (WASM, no native build) ───
const appDir = join(root, 'VELTRUVIA Server', 'resources', 'app');
const initSqlJs = (await import(pathToFileURL(join(appDir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js')).href)).default;
const SQL = await initSqlJs({
  locateFile: f => join(appDir, 'node_modules', 'sql.js', 'dist', f),
});
const db = new SQL.Database(readFileSync(dbPath));

const q = (sql, params = []) => {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
};
const run = (sql, params = []) => { const s = db.prepare(sql); s.bind(params); s.step(); s.free(); };

// ── Crypto helpers (mirror src/crypto.js v1 format exactly) ───────
const keyOf = (hex) => Buffer.from(hex, 'hex');
function decrypt(blob, key) {
  const [v, ivB64, tagB64, ctB64] = String(blob).split('.');
  if (v !== 'v1') throw new Error('bad version');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ctB64, 'base64')), d.final()]);
}
function encrypt(plaintextBuf, key) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintextBuf), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

const oldKey = keyOf(oldKeyHex);
const TARGETS = [
  { table: 'users', col: 'name_enc' },
  { table: 'users', col: 'meta_enc' },
  { table: 'users', col: 'totp_enc' },
  { table: 'audit_log', col: 'detail_enc' },
  { table: 'kv_store', col: 'v_enc' },
  { table: 'clinical_audit_log', col: 'detail_enc' },
];

// ── Pass 1: decrypt EVERYTHING with the old key (no writes yet) ───
console.log('Pass 1: decrypting all blobs with the OLD key…');
const plan = [];
let total = 0;
for (const { table, col } of TARGETS) {
  const rows = q(`SELECT rowid AS rid, ${col} AS blob FROM ${table} WHERE ${col} LIKE 'v1.%'`);
  for (const r of rows) {
    let plain;
    try { plain = decrypt(r.blob, oldKey); }
    catch { die(`${table}.${col} rowid=${r.rid} does NOT decrypt with the old key — aborting, nothing written.`); }
    plan.push({ table, col, rid: r.rid, plain });
    total++;
  }
}
ok(`${total} blobs decrypted cleanly with the old key`);
if (total === 0) { console.log('Nothing to rotate — all done.'); process.exit(0); }

// ── Generate the new secrets ──────────────────────────────────────
const newKeyHex = randomBytes(32).toString('hex');
const newJwt = randomBytes(32).toString('hex');
const newKey = keyOf(newKeyHex);
console.log('Pass 2: re-encrypting with a FRESH key (in memory)…');

// ── Pass 2 + 3: write new blobs, then verify by reading back ──────
let written = 0;
for (const { table, col, rid, plain } of plan) {
  run(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`, [encrypt(plain, newKey), rid]);
  written++;
}
ok(`${written}/${total} blobs re-encrypted`);

let verified = 0;
for (const { table, col, rid, plain } of plan) {
  const row = q(`SELECT ${col} AS blob FROM ${table} WHERE rowid = ?`, [rid])[0];
  const back = decrypt(row.blob, newKey);
  if (!back.equals(plain)) die(`Verify failed at ${table}.${col} rowid=${rid} — aborting WITHOUT saving.`);
  verified++;
}
ok(`${verified}/${total} verified byte-identical under the new key`);

// Prove the old key is now useless against the live data.
let oldStillOpens = 0;
for (const { table, col } of TARGETS) {
  const rows = q(`SELECT rowid AS rid, ${col} AS blob FROM ${table} WHERE ${col} LIKE 'v1.%'`);
  for (const r of rows) { try { decrypt(r.blob, oldKey); oldStillOpens++; } catch {} }
}
if (oldStillOpens > 0) die(`${oldStillOpens} blobs still open with the OLD key — refusing to save.`);
ok('old key opens 0 blobs — rotation is real');

// ── Persist: DB + .env swap ───────────────────────────────────────
const dbStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
copyFileSync(dbPath, `${dbPath}.pre-rotation-${dbStamp}`);
writeFileSync(dbPath, Buffer.from(db.export()));
ok(`DB saved (pre-rotation copy: ${dbPath}.pre-rotation-${dbStamp})`);

const envStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
copyFileSync(envPath, `${envPath}.pre-rotation-${envStamp}`);
const swap = (lines, key, val) => {
  const i = lines.findIndex(l => l.startsWith(key + '='));
  if (i >= 0) lines[i] = `${key}=${val}`;
  else lines.push(`${key}=${val}`);
};
const newLines = [...envLines];
swap(newLines, 'PHI_ENCRYPTION_KEY', newKeyHex);
swap(newLines, 'JWT_SECRET', newJwt);
writeFileSync(envPath, newLines.join('\n'));
ok('.env updated (old copy kept: .env.pre-rotation-' + envStamp + ')');

console.log('\n🎉 Rotation complete. Start the VELTRUVIA Server and confirm /health.');
console.log('   Keep the .pre-rotation-* copies until you have verified logins + patient data.');
