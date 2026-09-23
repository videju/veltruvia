# VELTRUVIA — HIPAA Security Rule Technical Safeguards Crosswalk

Maps 45 CFR §164.312 (Technical Safeguards) to what VELTRUVIA implements
today, and what remains an operational (non-software) responsibility.

Status legend: ✅ implemented & verified · 🟡 implemented, needs an operational
step by the clinic · ⬜ administrative responsibility (outside software).

## §164.312(a)(1) Access control

| Requirement | Status | Implementation |
|---|---|---|
| Unique user identification | ✅ | Every account is a named user; demo/seed accounts removed in v2.0.3 |
| Emergency access procedure | 🟡 | Break-glass = admin resets a user's password; documented below |
| Automatic logoff | ✅ | Session tokens expire; lockout after repeated failures |
| Encryption/decryption (addressable) | ✅ | PHI columns encrypted at rest (AES-256-GCM, `PHI_ENCRYPTION_KEY`, key rotation tooling included) |

## §164.312(a)(2)(i)–(iv) Access-control implementations

| Implementation | Status | Notes |
|---|---|---|
| (i) Unique user ID | ✅ | See above |
| (ii) Emergency access | 🟡 | Procedure: admin account → Users → reset password |
| (iii) Automatic logoff | ✅ | Configurable session TTL in `.env` |
| (iv) Encryption & decryption | ✅ | AES-256-GCM for PHI fields; TLS in transit (below) |

## §164.312(b) Audit controls

✅ Append-only audit log (`data/audit-*.jsonl`) — every PHI read/write recorded
with user, action, timestamp. Chain-hashed (tamper-evident, `blockchain.js`),
chain integrity verified at boot and by `npm run verify`.

**Operational duty:** export and review audit logs periodically; retain 6 years.

## §164.312(c)(1)–(2) Integrity

✅ Chain-hashed audit trail; DB integrity check at boot; WAL-mode SQLite
(node:sqlite backend, v2.0.4+) with atomic commits; automatic rotating backups
(`data/backups/`, keep 30) + restore tooling (`scripts/restore-backup.mjs`).

## §164.312(d) Person or entity authentication

✅ Password auth with salted hashing; optional TOTP 2FA (QR rendered **locally**
since v2.0.5 — the otpauth secret never leaves the machine); account lockout;
OTP codes delivered by email once SMTP is configured (`SETUP-EMAIL.md`).

🟡 Until `GMAIL_APP_PASSWORD` is set: OTP fallback is disabled in production
(codes are NOT displayed) — configure email to enable registration/2FA flows.

## §164.312(e)(1) Transmission security

| Channel | Encryption | Status |
|---|---|---|
| Same PC (desktop Doctor → Server) | Loopback — never leaves machine | ✅ |
| Clinic Wi-Fi (phones → Server) | HTTPS on port 3001 (TLS 1.2+, v2.0.5 sidecar) | 🟡 install clinic cert on each phone (see below) |
| Remote (over internet) | Cloudflare tunnel — real TLS, valid cert | ✅ |
| Lab instruments (MLLP :2575) | Plaintext HL7 over TCP | ⬜ isolate instrument VLAN — industry default for MLLP |

### Enabling encrypted Wi-Fi (5 minutes, per phone)
1. On the PC: `http://<server-ip>:3000/certs/veltruvia-lan.crt`
2. Phone: Settings → Security → Install a certificate → CA certificate
3. In the VELTRUVIA app ⚙ → set the address to `https://<server-ip>:3001`
4. Verify: the app loads over HTTPS (lock icon in WebView is expected)

Full guide: `TLS-LAN.md`.

## §164.308/316 (Administrative) — checklist for the clinic

- ⬜ Conduct a risk analysis (this file + a walkthrough of the deployment)
- ⬜ Name a security officer
- ⬜ Workforce training + sanctions policy
- ⬜ Business Associate Agreements (Cloudflare tunnel, GitHub Releases hosting
  artifacts, email provider if SMTP is added)
- ⬜ Contingency plan: backups verified quarterly (restore test), restore drill
- ⬜ Facility access controls: the server PC itself is physical PHI media —
  lock the room, enable disk encryption (BitLocker) on the server PC
- ⬜ Maintain the audit log for 6 years

## Honest gaps (what software cannot do for you)

1. **BitLocker / full-disk encryption** on the server PC — if the PC is stolen, file-
   level encryption of the DB does not protect against off-line attacks.
2. **BAA with Cloudflare/GitHub** — both offer them on paid/business tiers.
3. **Formal attestation** — a signed security assessment by a professional.

---
*Crosswalk last verified against build v2.0.5. Verification evidence:
276/276 feature checks (incl. RBAC privilege-separation), unit tests,
audit-chain checks — see `npm run verify`.*
