// Read-only spot check: confirms every v1.* PHI blob in the database
// decrypts with the PHI_ENCRYPTION_KEY currently in .env.
// Never prints key material or plaintext — only counts.
// Run: node scripts/verify-phi.mjs [--db path] [--env path]
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecipheriv } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.argv.includes('--db')
  ? resolve(process.argv[process.argv.indexOf('--db') + 1])
  : join(root, 'data', 'veltruvia.db');
const envPath = process.argv.includes('--env')
  ? resolve(process.argv[process.argv.indexOf('--env') + 1])
  : join(root, '.env');

const getEnv = (k) => {
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find(l => l.startsWith(k + '='));
  return line ? line.slice(k.length + 1).trim() : null;
};
const keyHex = getEnv('PHI_ENCRYPTION_KEY');
if (!keyHex || !/^[0-9a-fA-F]{64}$/.test(keyHex)) { console.error('❌ PHI_ENCRYPTION_KEY missing/invalid in .env'); process.exit(1); }

const appDir = join(root, 'VELTRUVIA Server', 'resources', 'app');
const initSqlJs = (await import(pathToFileURL(join(appDir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js')).href)).default;
const SQL = await initSqlJs({ locateFile: f => join(appDir, 'node_modules', 'sql.js', 'dist', f) });
const db = new SQL.Database(readFileSync(dbPath));

function decrypt(blob) {
  const [v, ivB64, tagB64, ctB64] = String(blob).split('.');
  if (v !== 'v1') throw new Error('bad version');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ctB64, 'base64')), d.final()]);
}

const TARGETS = [
  ['users', 'name_enc'], ['users', 'meta_enc'], ['users', 'totp_enc'],
  ['audit_log', 'detail_enc'], ['kv_store', 'v_enc'], ['clinical_audit_log', 'detail_enc'],
];
let total = 0, good = 0, bad = 0;
for (const [table, col] of TARGETS) {
  const stmt = db.prepare(`SELECT ${col} AS blob FROM ${table} WHERE ${col} LIKE 'v1.%'`);
  while (stmt.step()) {
    total++;
    try { decrypt(stmt.getAsObject().blob); good++; } catch { bad++; }
  }
  stmt.free();
}
console.log(`PHI blobs: ${total} total · ${good} decrypt with the CURRENT .env key · ${bad} failures`);
process.exit(bad === 0 && total > 0 ? 0 : bad === 0 ? 0 : 1);
