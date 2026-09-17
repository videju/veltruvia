// ═══════════════════════════════════════════════════════════════════════
// Crash & error capture for the VELTRUVIA server and every Electron exe.
//
// installErrorHandlers({ logPath, name }) hooks:
//   • process.on('uncaughtException')  — sync crashes
//   • process.on('unhandledRejection') — async failures
// and appends each event as a JSON line to data/error-log.jsonl plus the
// console. It also keeps the last 50 events in memory so the admin UI or
// a support session can read them via recentErrors().
//
// Design rule: logging must never take the app down. Every handler is
// wrapped; writes are best-effort; nothing re-throws.
// ═══════════════════════════════════════════════════════════════════════
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const recent = [];
const MAX_RECENT = 50;

function formatError(err, kind, appName) {
  const e = err || {};
  return {
    ts: new Date().toISOString(),
    app: appName,
    kind,
    message: String(e.message || e || 'unknown'),
    stack: e.stack ? String(e.stack).split('\n').slice(0, 12).join('\n') : null,
    // Common Node system-error fields, when present
    code: e.code || undefined,
    errno: typeof e.errno === 'number' ? e.errno : undefined,
    syscall: e.syscall || undefined,
    pid: process.pid,
    uptime_s: Math.round(process.uptime()),
    version: process.env.npm_package_version || undefined,
  };
}

function writeLog(logPath, entry) {
  if (!logPath) return;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch { /* disk issues must never crash the app */ }
}

let installed = false;

export function installErrorHandlers({ logPath, name = 'veltruvia' } = {}) {
  if (installed) return { recentErrors };
  installed = true;

  const record = (kind) => (err) => {
    const entry = formatError(err, kind, name);
    recent.push(entry);
    if (recent.length > MAX_RECENT) recent.shift();
    // Console first (shows in tray-mode stdout / electron logs)
    try {
      console.error(`[${name}] ${kind}:`, entry.message);
      if (entry.stack) console.error(entry.stack);
    } catch { /* ignore */ }
    writeLog(logPath, entry);
  };

  process.on('uncaughtException', record('uncaughtException'));
  process.on('unhandledRejection', record('unhandledRejection'));

  return { recentErrors };
}

export function recentErrors(limit = 20) {
  return recent.slice(-limit);
}

export function errorsLogPath(dataDir, appName) {
  return join(dataDir, 'error-log.jsonl');
}
