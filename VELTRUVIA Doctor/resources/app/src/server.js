// VELTRUVIA secure backend — long-lived server entry point.
// Supports optional TLS (set TLS_KEY and TLS_CERT env vars).
// Includes automated database backup on a configurable interval.

import 'dotenv/config';   // load .env before anything else
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { app } from './app.js';
import { config } from './config.js';
import { startAppointmentReminders } from './push.js';
import { startReminderScheduler } from './reminders.js';
import { closeDb, flushDb } from './db/index.js';
import { attachTelehealthWs } from './routes/telehealth.js';
import { startMllpServer, getMllpStatus } from './hl7/mllp.js';
import blockchain from './blockchain/index.js';

startAppointmentReminders();
startReminderScheduler();

// Activate the audit chain (Hardhat if deployed, otherwise the shared file
// chain in data/chain.json) so audited actions are recorded tamper-evidently.
blockchain.connect().catch(err => console.warn('[blockchain] init failed:', err.message));

// ── TLS / HTTPS support ───────────────────────────────────────────
// If TLS_KEY and TLS_CERT env vars point to PEM files, the server
// starts an HTTPS server instead of plain HTTP.  This is required
// for production deployments that handle PHI over a network.
const tlsKeyPath = process.env.TLS_KEY;
const tlsCertPath = process.env.TLS_CERT;
let server;

if (tlsKeyPath && tlsCertPath && fs.existsSync(tlsKeyPath) && fs.existsSync(tlsCertPath)) {
  const tlsOptions = {
    key: fs.readFileSync(tlsKeyPath),
    cert: fs.readFileSync(tlsCertPath),
    // Modern TLS only
    minVersion: 'TLSv1.2',
    ciphers: [
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES256-GCM-SHA384',
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256',
    ].join(':'),
  };
  server = https.createServer(tlsOptions, app);
  console.log('  🔒 TLS enabled — serving over HTTPS');
} else {
  server = http.createServer(app);
  if (config.isProd) {
    console.warn('  ⚠️  No TLS_CERT/TLS_KEY set — running plain HTTP. NOT safe for PHI in production.');
  }
}

// Attach WebSocket server for telehealth signaling
attachTelehealthWs(server);

// Start MLLP/TCP server for lab instruments (optional)
if (process.env.MLLP_ENABLED !== 'false') {
  startMllpServer();
}

server.listen(config.port, config.host, () => {
  const proto = server instanceof https.Server ? 'https' : 'http';
  console.log(`\n  VELTRUVIA server running on port ${config.port} (${proto})`);
  console.log(`  Environment: ${config.isProd ? 'production' : 'development'}`);
  console.log(`  Health: ${proto}://localhost:${config.port}/health`);
  console.log(`  WebSocket: ${proto}://localhost:${config.port}/ws/telehealth`);
  if (process.env.MLLP_ENABLED !== 'false') {
    const mllp = getMllpStatus();
    console.log(`  MLLP/TCP: tcp://localhost:${mllp.port} (lab instruments)`);
  }
  console.log('');
});

// ── Automated database backups ────────────────────────────────────
// Periodically checkpoint WAL and copy the DB file to a backups/ dir.
const BACKUP_INTERVAL_MS = parseInt(process.env.BACKUP_INTERVAL_MS || '0', 10); // 0 = disabled
const DB_BACKUP_DIR = path.join(path.dirname(config.dbPath || '.'), 'backups');

function backupDatabase() {
  try {
    const dbPath = config.dbPath;
    if (!dbPath || dbPath === ':memory:' || !fs.existsSync(dbPath)) return;

    // Ensure backup directory exists
    fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });

    // WAL checkpoint before copy
    flushDb();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(DB_BACKUP_DIR, `veltruvia-${timestamp}.db`);
    fs.copyFileSync(dbPath, backupPath);

    // Also copy WAL and SHM files if they exist
    try { fs.copyFileSync(dbPath + '-wal', backupPath + '-wal'); } catch {}
    try { fs.copyFileSync(dbPath + '-shm', backupPath + '-shm'); } catch {}

    // Prune old backups (keep last 30)
    const backups = fs.readdirSync(DB_BACKUP_DIR)
      .filter(f => f.startsWith('veltruvia-') && f.endsWith('.db'))
      .sort()
      .reverse();
    while (backups.length > 30) {
      const old = backups.pop();
      try {
        fs.unlinkSync(path.join(DB_BACKUP_DIR, old));
        try { fs.unlinkSync(path.join(DB_BACKUP_DIR, old + '-wal')); } catch {}
        try { fs.unlinkSync(path.join(DB_BACKUP_DIR, old + '-shm')); } catch {}
      } catch {}
    }

    console.log(`[backup] Database backed up to ${backupPath} (${backups.length + 1} total)`);
  } catch (err) {
    console.error('[backup] Failed:', err.message);
  }
}

if (BACKUP_INTERVAL_MS > 0) {
  setInterval(backupDatabase, BACKUP_INTERVAL_MS);
  console.log(`[backup] Automated backups every ${BACKUP_INTERVAL_MS / 1000}s → ${DB_BACKUP_DIR}`);
}

// ── Graceful shutdown ─────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[server] ${signal} received — shutting down gracefully...`);
  flushDb();
  backupDatabase(); // Final backup before exit
  server.close(() => {
    closeDb();
    console.log('[server] Closed. Goodbye.');
    process.exit(0);
  });
  // Force exit after 5 seconds if graceful shutdown stalls
  setTimeout(() => { console.error('[server] Forced exit.'); process.exit(1); }, 5000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
