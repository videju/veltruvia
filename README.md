# VELTRUVIA — Neuro-Oncology EMR Desktop Suite

Four self-contained desktop apps sharing one encrypted backend:

| App | Entry | Purpose |
|---|---|---|
| **VELTRUVIA Server** | `electron/main-server.js` | Headless backend + status window; binds `127.0.0.1:3000` |
| **VELTRUVIA Doctor** | `electron/main-doctor.js` | EMR & patient management (auto-connects to Server, falls back to local DB) |
| **VELTRUVIA Patient** | `electron/main-patient.js` | Patient symptom tracker & care portal |
| **VELTRUVIA Lab** | `electron/main-lab.js` | Lab portal with HL7 intake |

## Daily workflow

```bash
npm run check      # fast quality gate: syntax, await-audit, bundle drift, icons
npm run verify     # full 53-check feature verification × 4 apps (~2 min)
npm run sync-bundles   # propagate edits from the Server bundle to the 3 clients
node scripts/feature-sweep.mjs   # live-surface probe: every GET × every role (needs a running server)
```

**The `VELTRUVIA Server` bundle is the canonical source.** Edit code there, then run
`npm run sync-bundles` — never edit the client bundles directly. `npm run check`
fails if bundles drift or a new un-awaited `db.prepare(...)` sneaks in.

## First run (fresh install)

By default **no accounts exist** and no known credentials are seeded. Register the
first admin through the Doctor app (or `POST /api/auth/register`).

For demos/trials, set `VELTRUVIA_DEMO=true` (see `VELTRUVIA Server/start-test.bat`).
This seeds the classic demo accounts — doctor `test@example.com`, patient MRN
`12345`, lab `testlab` — with hashed passwords only. The demo admin's password is
generated randomly on first run, printed once to the console, and saved to
`.demo-admin-password` next to the database (git-ignored).

## Configuration

All secrets come from the shared `.env` at the install root (never committed):

- `JWT_SECRET`, `PHI_ENCRYPTION_KEY` — required in production; dev auto-generates
- `HOST` — defaults to `127.0.0.1` (data stays local); set `0.0.0.0` only to deliberately share on a LAN
- `TLS_KEY` / `TLS_CERT` — enables HTTPS (required for real PHI in production)
- `VELTRUVIA_DEMO` — seeds demo accounts (`true` only for trials)
- `DB_PATH`, `PORT`, `BACKUP_INTERVAL_MS`, `MLLP_ENABLED` — operational

## Shared data locations

- Database: `<install root>/data/veltruvia.db` (SQLite, WAL mode, auto-backups)
- Shared audit chain: `<install root>/data/chain.json` — one tamper-evident chain all four apps append to
- Server discovery: `<install root>/config/server-config.json`

## CI

`.github/workflows/ci.yml` runs the API test suite on Node 20/22 and validates the
app imports. Run `npm run precommit` locally before committing.

## Resilience

The database is protected against the corruption class observed in the wild
(a process killed mid-snapshot used to zero the file):

- **Atomic snapshots** — the sql.js writer exports → validates → writes a
  temp file → renames it over the DB. The on-disk file is always a complete
  database, never a torn write.
- **Boot-time integrity check** — if the DB file lacks the SQLite header at
  startup, it is quarantined (`*.corrupt-<timestamp>`, never deleted) and the
  newest valid backup from `data/backups/` is restored automatically.
- **Boot restore point** — every healthy boot snapshots the DB to
  `data/backups/` (newest 30 kept) so a fresh backup always exists.
- **Boot watchdog** — the Server exe retries a failed API load and, if a
  corrupt database was the cause, self-heals before surfacing a visible error.

## Known limitations

- Exes are not code-signed; Windows SmartScreen will warn on first launch
- HL7 MLLP TCP listener binds broadly when enabled — restrict with a firewall in production
