// Shared corrupt-database self-heal — standalone module with ZERO imports
// from the app, so electron/ can load it even when the Express bundle is
// exactly the thing that fails to import (e.g. a corrupt DB crashing
// app.js → db/index.js at module-eval time).
//
// What counts as corrupt: any file missing the 16-byte SQLite magic
// "SQLite format 3\0" (zeroed by a torn write, truncated, wrong file).
//
// What happens: the corrupt file is quarantined beside itself with a
// timestamp suffix (nothing is ever deleted), then the newest valid backup
// from <dataDir>/backups/*.db is restored. The automated backup job
// (src/db/backup.js) and the boot-time restore point (initSchema in
// src/db/index.js) both write there, so a fresh backup always exists.
//
// Also proactively cleans stale single-writer locks (`.lock`, WAL/SHM
// sidecars) that a killed process left behind.

import { readdirSync, renameSync, copyFileSync, existsSync, openSync, readSync, closeSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQLITE_MAGIC = Buffer.from('SQLite format 3\x00', 'latin1');

export function looksLikeSqliteFile(p) {
  try {
    const fd = openSync(p, 'r');
    try {
      const buf = Buffer.alloc(16);
      const n = readSync(fd, buf, 0, 16, 0);
      return n === 16 && buf.equals(SQLITE_MAGIC);
    } finally { closeSync(fd); }
  } catch { return false; }
}

// Repair `dbPath` if it lacks the SQLite header. Safe to call on a healthy
// database — it does nothing unless corruption is detected. `dataDir`
// defaults to the directory containing dbPath (where backups/ lives).
export function repairCorruptDb(dbPath, dataDir) {
  if (!dbPath || !existsSync(dbPath) || looksLikeSqliteFile(dbPath)) return false;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantine = `${dbPath}.corrupt-${stamp}`;
  try {
    renameSync(dbPath, quarantine);
    console.warn(`[db-repair] CORRUPT DATABASE: header invalid — quarantined as ${quarantine}`);
  } catch (e) {
    console.warn(`[db-repair] corrupt database detected but could not be quarantined: ${e.message}`);
    return false;
  }

  const dir = dataDir || join(dbPath, '..');
  const backupsDir = join(dir, 'backups');
  let restored = false;
  try {
    const candidates = readdirSync(backupsDir)
      .filter(f => f.endsWith('.db'))
      .sort()                          // timestamped names sort chronologically
      .reverse();                      // newest first
    for (const f of candidates) {
      const candidate = join(backupsDir, f);
      if (!looksLikeSqliteFile(candidate)) continue;
      copyFileSync(candidate, dbPath);
      if (looksLikeSqliteFile(dbPath)) {
        console.warn(`[db-repair] ✅ restored database from backup: ${f}`);
        restored = true;
        break;
      }
    }
  } catch {}

  if (!restored) console.warn('[db-repair] no valid backup found — a fresh database will be created');

  // Stale sidecar/lock cleanup — only when no LIVE process owns the writer
  // lock (a running owner keeps its lock; a dead holder's lock is stale).
  let lockHeld = false;
  try {
    const lockPid = parseInt(readFileSync(dbPath + '.lock', 'utf-8').trim().split(/\s+/)[0], 10);
    if (lockPid && lockPid !== process.pid) { process.kill(lockPid, 0); lockHeld = true; } // alive
  } catch (e) { lockHeld = e && e.code === 'EPERM'; } // EPERM = alive but not ours
  if (!lockHeld) {
    for (const side of [dbPath + '.lock', dbPath + '-wal', dbPath + '-shm']) {
      try { unlinkSync(side); } catch {}
    }
  }
  return restored;
}
