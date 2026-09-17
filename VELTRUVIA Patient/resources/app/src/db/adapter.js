// Database adapter. Three backends behind one tiny async interface:
//
//   - libsql (@libsql/client)  — used when TURSO_DATABASE_URL is set. Points
//     at a Turso cloud database (free tier, no disk needed on the host) or a
//     local file via a file: URL.
//   - better-sqlite3           — local file, fast native binding.
//   - node:sqlite              — local file, zero build step (Node >= 22).
//
// The interface every backend exposes:
//   db.prepare(sql) -> { run(...args), get(...args), all(...args) }  (async)
//   db.exec(sql), db.pragma(str)                                     (async)
//
// All methods return promises so the same route code works against both the
// in-process SQLite files and the remote Turso HTTP API.

import { readFileSync, writeFileSync, statSync, openSync, closeSync, writeSync, unlinkSync } from 'node:fs';

let impl = null;

// ── Advisory single-writer lock ────────────────────────────────────
// The sql.js backend keeps the whole database in RAM and snapshots it to
// disk every few seconds — two processes doing that to the same file
// silently clobber each other (Server exe vs Doctor exe). A lock file
// created with O_EXCL (atomic) lets exactly one process claim read-write
// access; everyone else opens READ-ONLY and follows disk changes.
function tryAcquireWriterLock(dbPath) {
  const lockPath = dbPath + '.lock';
  const claim = () => {
    const fd = openSync(lockPath, 'wx');       // atomic create-if-not-exists
    writeSync(fd, String(process.pid));
    closeSync(fd);
  };
  try {
    claim();
    return true;                               // we are the writer
  } catch (err) {
    if (err.code !== 'EEXIST') return true;    // can't enforce here → fail open
    try {
      const pid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
      if (pid === process.pid) return true;    // our own leftover lock
      if (pid) {
        try { process.kill(pid, 0); return false; }  // holder alive → read-only
        catch { /* ESRCH: dead holder, reclaim below */ }
      }
      unlinkSync(lockPath);                    // stale lock from a crashed process
      claim();
      return true;
    } catch {
      return false;                            // lost a reclaim race → read-only
    }
  }
}

function releaseWriterLock(dbPath) {
  try { unlinkSync(dbPath + '.lock'); } catch {}
}

export async function openDatabase(path) {
  const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
  if (tursoUrl) {
    const { createClient } = await import('@libsql/client');
    const client = createClient({
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
    impl = 'libsql';
    return wrapLibsql(client, tursoUrl);
  }

  if (process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.warn('[db] No TURSO_DATABASE_URL set on serverless host — using in-memory database (data will not persist)');
  }

  // Try better-sqlite3 first.
  try {
    const mod = await import('better-sqlite3');
    const db = new mod.default(path);
    impl = 'better-sqlite3';
    return wrapSync(db, (s) => db.pragma(s), path);
  } catch {
    // Try node:sqlite (Node >= 22)
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(path);
      impl = 'node:sqlite';
      return wrapSync(db, (s) => db.exec(`PRAGMA ${s};`), path);
    } catch {
      // Fall back to sql.js (WASM-based, no native build needed)
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs();
      const fs = await import('node:fs');
      let db;
      // Single-writer enforcement BEFORE loading: without this, a second
      // VELTRUVIA process would snapshot over the first one's writes.
      const canWrite = tryAcquireWriterLock(path);
      if (path === ':memory:') {
        db = new SQL.Database();
      } else {
        try {
          const buffer = fs.readFileSync(path);
          db = new SQL.Database(buffer);
        } catch {
          db = new SQL.Database();
        }
      }
      if (!canWrite) {
        console.warn(`[db] ${path} is owned by another VELTRUVIA process (pid in ${path}.lock) — opening READ-ONLY.`);
        console.warn('[db] Start the central Server first, or close this app: it will display data but not save changes.');
      }
      impl = canWrite ? 'sql.js' : 'sql.js (read-only)';
      return wrapSqlJs(SQL, db, path, canWrite);
    }
  }
}

export function activeImpl() { return impl; }

// Promisify a synchronous sqlite handle (both share prepare/exec).
function wrapSync(db, pragma, dbPath) {
  return {
    async exec(sql) { db.exec(sql); },
    async pragma(str) { pragma(str); },
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        async run(...args) { return stmt.run(...args); },
        async get(...args) { return stmt.get(...args); },
        async all(...args) { return stmt.all(...args); },
      };
    },
    close() {
      try { db.close(); } catch {}
    },
    flush() {},
    name: dbPath,
  };
}

function wrapSqlJs(SQL, initialDb, dbPath, readOnly = false) {
  // Use a reference object so we can swap the db pointer on reload
  const ref = { db: initialDb };
  let lastMtime = 0;
  try { lastMtime = statSync(dbPath).mtimeMs; } catch {}

  const save = () => {
    if (readOnly) return;                      // readers never write the file
    try {
      const data = ref.db.export();
      writeFileSync(dbPath, Buffer.from(data));
      lastMtime = Date.now();
    } catch {}
  };

  // Reload from disk if another process wrote to it
  const reloadIfChanged = () => {
    try {
      const st = statSync(dbPath);
      if (st.mtimeMs > lastMtime + 100) {
        const buf = readFileSync(dbPath);
        const newDb = new SQL.Database(buf);
        ref.db.close();
        ref.db = newDb;
        lastMtime = st.mtimeMs;
      }
    } catch {}
  };

  // Writers snapshot the full DB to disk every 5 s and also follow external
  // reloads; READ-ONLY instances only follow the file the writer publishes.
  const intervalId = readOnly ? setInterval(reloadIfChanged, 5000) : setInterval(save, 5000);
  const reloadId = readOnly ? null : setInterval(reloadIfChanged, 2000);

  process.on('exit', save);
  process.on('SIGINT', () => { save(); process.exit(); });

  return {
    async exec(sql) {
      ref.db.exec(sql);
    },
    async pragma(str) {
      try { ref.db.run(`PRAGMA ${str}`); } catch {}
    },
    prepare(sql) {
      return {
        async run(...args) {
          const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
          ref.db.run(sql, params);
          return { changes: ref.db.getRowsModified() };
        },
        async get(...args) {
          // Reload from disk before reads to see other apps' writes
          reloadIfChanged();
          const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
          const stmt = ref.db.prepare(sql);
          try {
            stmt.bind(params);
            if (stmt.step()) {
              const cols = stmt.getColumnNames();
              const vals = stmt.get();
              const row = {};
              cols.forEach((c, i) => row[c] = vals[i]);
              return row;
            }
            return undefined;
          } finally {
            stmt.free();
          }
        },
        async all(...args) {
          // Reload from disk before reads to see other apps' writes
          reloadIfChanged();
          const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
          const stmt = ref.db.prepare(sql);
          try {
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) {
              const cols = stmt.getColumnNames();
              const vals = stmt.get();
              const row = {};
              cols.forEach((c, i) => row[c] = vals[i]);
              rows.push(row);
            }
            return rows;
          } finally {
            stmt.free();
          }
        },
      };
    },
    close() {
      clearInterval(intervalId);
      if (reloadId) clearInterval(reloadId);
      save();
      if (!readOnly) releaseWriterLock(dbPath);
      ref.db.close();
    },
    flush() { save(); },
    name: dbPath,
  };
}

function wrapLibsql(client, url) {
  return {
    async exec(sql) {
      const script = sql.split('\n').filter(l => !/^\s*PRAGMA\b/i.test(l)).join('\n');
      await client.executeMultiple(script);
    },
    async pragma() { /* not applicable to a remote database */ },
    prepare(sql) {
      return {
        async run(...args) {
          const r = await client.execute({ sql, args });
          return { changes: r.rowsAffected };
        },
        async get(...args) {
          const r = await client.execute({ sql, args });
          return r.rows[0] ? { ...r.rows[0] } : undefined;
        },
        async all(...args) {
          const r = await client.execute({ sql, args });
          return r.rows.map(row => ({ ...row }));
        },
      };
    },
    close() { /* libsql client has no close method */ },
    name: url,
  };
}
