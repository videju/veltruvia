#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// VELTRUVIA backup restore — replaces the live veltruvia.db with a backup.
//
//   node scripts/restore-backup.mjs <backup.db> [--data-dir <dir>] [--yes]
//
//   • Stops a running VELTRUVIA Server.exe if present (it holds the DB).
//   • Verifies the backup is itself healthy (integrity_check) before
//     touching the live file.
//   • Keeps a safety copy of the current DB (never destroys data).
//   • Clears the stale writer lock so the next boot opens read-write.
//   • Records the restore in data/restore-history.log.
// ═══════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync,
  statSync, unlinkSync, rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function die(msg) { console.error('✗ ' + msg); process.exit(1); }
function log(msg) { console.log('• ' + msg); }

// ── Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const yes = args.includes('--yes');
const dataDirIdx = args.indexOf('--data-dir');
const dataDir = dataDirIdx !== -1
  ? resolve(args[dataDirIdx + 1])
  : join(REPO_ROOT, 'data');

const backupArg = args.find(a => !a.startsWith('--') && a !== args[dataDirIdx + 1]);
if (!backupArg) {
  console.error('Usage: node scripts/restore-backup.mjs <backup.db> [--data-dir <dir>] [--yes]');
  process.exit(1);
}
const backupPath = resolve(backupArg);
const liveDb = join(dataDir, 'veltruvia.db');
const lockPath = liveDb + '.lock';

if (!existsSync(backupPath)) die(`Backup not found: ${backupPath}`);

// ── 1. Stop the server (it snapshots the DB every 5 s and would clobber us) ──
const tasklist = spawnSync('tasklist', [], { encoding: 'utf8' });
if (/VELTRUVIA Server\.exe/i.test(tasklist.stdout || '')) {
  if (!yes) {
    console.error('\n⚠ VELTRUVIA Server.exe is running. It must be stopped to restore.');
    console.error('  Re-run with --yes to stop it automatically.');
    process.exit(1);
  }
  log('Stopping VELTRUVIA Server.exe…');
  spawnSync('taskkill', ['/IM', 'VELTRUVIA Server.exe', '/F'], { encoding: 'utf8' });
  // Wait for the file handle to be released
  for (let i = 0; i < 10; i++) {
    try { copyFileSync(liveDb, liveDb + '.probe'); unlinkSync(liveDb + '.probe'); break; }
    catch { spawnSync('cmd', ['/c', 'timeout', '/t', '1', '/nobreak'], { stdio: 'ignore' }); }
  }
  log('Server stopped.');
}

// ── 2. Verify the backup is healthy before touching anything ────────────
log('Verifying backup integrity…');
let SQL;
try {
  const sqlJsDir = join(REPO_ROOT, 'VELTRUVIA Server', 'resources', 'app', 'node_modules', 'sql.js');
  SQL = await require(join(sqlJsDir, 'dist', 'sql-wasm.js'))({
    locateFile: f => join(sqlJsDir, 'dist', f),
  });
} catch (e) {
  die(`Could not load sql.js to verify the backup: ${e.message}`);
}
const backupBytes = readFileSync(backupPath);
const check = new SQL.Database(backupBytes);
const integrity = check.exec('PRAGMA integrity_check');
const integrityResult = integrity?.[0]?.values?.[0]?.[0];
check.close();
if (integrityResult !== 'ok') {
  die(`Backup FAILED integrity check (${integrityResult}) — refusing to restore a corrupt file.`);
}
// Count key tables so the user sees what they're getting back
const probe = new SQL.Database(backupBytes);
let tableCount = 0;
try {
  tableCount = probe.exec("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")[0].values[0][0];
} catch { /* empty backup */ }
probe.close();
log(`Backup OK — integrity_check: ok, ${tableCount} tables, ${(backupBytes.length / 1024).toFixed(0)} KB.`);

// ── 3. Safety copy of the current live DB (never destroy data) ──────────
mkdirSync(dataDir, { recursive: true });
if (existsSync(liveDb)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safety = join(dataDir, `veltruvia-pre-restore-${stamp}.db`);
  copyFileSync(liveDb, safety);
  log(`Current DB saved as ${safety}`);
} else {
  log('No current live DB found (fresh restore).');
}

// ── 4. Restore ───────────────────────────────────────────────────────────
copyFileSync(backupPath, liveDb);
log(`Restored ${backupPath} → ${liveDb}`);

// ── 5. Clear any stale writer lock so the next boot opens read-write ────
try { rmSync(lockPath, { force: true }); log('Writer lock cleared.'); }
catch { /* already absent */ }

// ── 6. Record the restore ───────────────────────────────────────────────
const histPath = join(dataDir, 'restore-history.log');
const line = `${new Date().toISOString()}  restored from ${backupPath} (${statSync(backupPath).size} bytes) by scripts/restore-backup.mjs\n`;
try { writeFileSync(histPath, line, { flag: 'a' }); } catch { /* best-effort */ }

console.log('\n✅ Restore complete. Start the VELTRUVIA Server and verify /health?deep=1 reports db:true.');
console.log('   All users were signed out by the restart — they can simply sign in again.');
