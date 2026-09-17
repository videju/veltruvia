// Doctor account registration and login. Patient and lab logins live in
// routes/sync.js — they authenticate against the synced records.

import { Router } from 'express';
import { z } from 'zod';
import { db, writeAudit } from '../db/index.js';
import {
  hashPassword, verifyPassword, encryptPHI, decryptPHI, randomToken,
  generateTotpSecret, verifyTotp,
} from '../crypto.js';
import {
  createSession, revokeSession, clearSessionCookie, authenticate, requireRole,
} from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { config } from '../config.js';
import { verifyRegistrationToken } from './email-otp.js';

export const authRouter = Router();

// ── Brute-force lockout (DB-backed, survives restarts) ──────────
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const WINDOW_MS = 15 * 60 * 1000;

async function recordFailedLogin(identifier) {
  const now = new Date().toISOString();
  const entry = await db.prepare('SELECT * FROM login_attempts WHERE identifier = ?').get(identifier);
  
  if (!entry || (Date.now() - new Date(entry.first_attempt).getTime()) > WINDOW_MS) {
    // Fresh window or expired — reset
    await db.prepare(`
      INSERT INTO login_attempts (identifier, count, first_attempt, locked_until)
      VALUES (?, 1, ?, NULL)
      ON CONFLICT(identifier) DO UPDATE SET count = 1, first_attempt = excluded.first_attempt, locked_until = NULL
    `).run(identifier, now);
    return { count: 1, lockedUntil: 0 };
  }
  
  const newCount = entry.count + 1;
  let lockedUntil = entry.locked_until;
  if (newCount >= MAX_ATTEMPTS) {
    lockedUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
  }
  await db.prepare('UPDATE login_attempts SET count = ?, locked_until = ? WHERE identifier = ?')
    .run(newCount, lockedUntil, identifier);
  return { count: newCount, lockedUntil: lockedUntil ? new Date(lockedUntil).getTime() : 0 };
}

async function isLockedOut(identifier) {
  const entry = await db.prepare('SELECT * FROM login_attempts WHERE identifier = ?').get(identifier);
  if (!entry) return false;
  if (entry.locked_until && new Date(entry.locked_until).getTime() > Date.now()) return true;
  if (entry.locked_until && new Date(entry.locked_until).getTime() <= Date.now()) {
    await db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(identifier);
  }
  return false;
}

async function clearLoginAttempts(identifier) {
  await db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(identifier);
}

// ── Doctor registration ───────────────────────────────────────────
const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  // Password policy: ≥10 chars with at least one letter and one digit.
  password: z.string().min(10).max(200)
    .refine(p => /[A-Za-z]/.test(p) && /\d/.test(p),
      { message: 'Password must be at least 10 characters and include a letter and a number' }),
  specialty: z.string().max(120).optional(),
  institution: z.string().max(200).optional(),
  emailVerificationToken: z.string().min(1), // required: proves email was verified
});

authRouter.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const { name, email, password, specialty, institution, emailVerificationToken } = req.valid;

  // Verify the email OTP token (one-time use, deleted on success)
  // Skip in Electron desktop mode for easier local registration
  if (!process.env.ELECTRON_RUN && !verifyRegistrationToken(email, emailVerificationToken)) {
    return res.status(400).json({ error: 'Email verification required. Please verify your email first.', code: 'EMAIL_NOT_VERIFIED' });
  }

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account already exists for this email' });

  // With REQUIRE_DOCTOR_APPROVAL=true, new accounts start inactive until an
  // admin flips users.active to 1. The very first account is always approved
  // so the instance owner can't lock themselves out.
  let active = 1;
  if (config.requireDoctorApproval) {
    const anyUser = await db.prepare('SELECT id FROM users LIMIT 1').get();
    if (anyUser) active = 0;
  }

  const id = randomToken(16);
  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, name_enc, meta_enc, active, created_at)
    VALUES (?, ?, ?, 'doctor', ?, ?, ?, ?)
  `).run(
    id, email, hashPassword(password),
    encryptPHI(name), encryptPHI({ specialty, institution }),
    active, new Date().toISOString()
  );

  await writeAudit({ actorId: id, actorRole: 'doctor', action: 'doctor.register', targetId: id, ip: req.ip });
  res.status(201).json({
    ok: true,
    message: active ? 'Account created. You can now sign in.' : 'Account created. An administrator must approve it before you can sign in.',
  });
}));

// ── Doctor / admin / lab login (by email) ─────────────────────────
const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

authRouter.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password, totpCode } = req.valid;

  // Check brute-force lockout (DB-backed)
  if (await isLockedOut('auth:' + email)) {
    return res.status(429).json({ error: 'Too many failed attempts. Please try again in 15 minutes.' });
  }

  // Check if account exists (even if inactive) for better error messages
  const existingUser = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  const user = await db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);

  // Constant-ish behaviour whether or not the user exists.
  const ok = user && verifyPassword(password, user.password_hash);
  if (!ok) {
    // Show specific error for inactive accounts
    if (existingUser && !existingUser.active) {
      return res.status(403).json({ error: 'Account pending admin approval. Please contact your administrator.' });
    }
    const entry = await recordFailedLogin('auth:' + email);
    const remaining = MAX_ATTEMPTS - entry.count;
    const msg = remaining > 0
      ? `Invalid email or password. ${remaining} attempt(s) remaining before lockout.`
      : 'Invalid email or password. Account locked for 15 minutes.';
    await writeAudit({ actorId: email, actorRole: 'unknown', action: 'user.login_failed', targetId: email, detail: { remaining: Math.max(0, remaining) }, ip: req.ip });
    return res.status(401).json({ error: msg });
  }

  // Successful login — clear lockout
  await clearLoginAttempts('auth:' + email);

  // Second factor, if the account has enabled it.
  const totp = decryptPHI(user.totp_enc);
  if (totp?.enabled) {
    if (!totpCode) return res.status(401).json({ error: 'TOTP code required', totpRequired: true });
    if (!verifyTotp(totp.secret, totpCode)) {
      await clearLoginAttempts('auth:' + email); // Valid password but wrong TOTP — don't count as brute force
      return res.status(401).json({ error: 'Invalid TOTP code', totpRequired: true });
    }
  }

  await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), user.id);
  const session = await createSession(res, { subjectId: user.id, subjectType: 'user', role: user.role });
  await writeAudit({ actorId: user.id, actorRole: user.role, action: 'user.login', targetId: user.id, ip: req.ip });

  res.json({
    ok: true,
    // Bearer token ONLY for native clients (mobile APKs) that don't persist
    // cookies — keeps browser responses free of exfiltratable credentials.
    ...(req.headers['x-veltruvia-native'] === '1' ? { token: session.token } : {}),
    user: {
      id: user.id, email: user.email, role: user.role,
      name: decryptPHI(user.name_enc),
      meta: decryptPHI(user.meta_enc),
      labId: user.lab_id,
    },
  });
}));

// ── Two-factor auth (TOTP, RFC 6238) for doctor/admin accounts ────
// Setup: returns a fresh secret + otpauth:// URL for the authenticator app.
authRouter.post('/totp/setup', authenticate, asyncHandler(async (req, res) => {
  if (req.auth.subjectType !== 'user') return res.status(403).json({ error: 'Accounts only' });
  const u = await db.prepare('SELECT email, totp_enc FROM users WHERE id = ?').get(req.auth.subjectId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const existing = decryptPHI(u.totp_enc);
  if (existing?.enabled) return res.status(409).json({ error: '2FA already enabled' });

  const secret = generateTotpSecret();
  await db.prepare('UPDATE users SET totp_enc = ? WHERE id = ?')
    .run(encryptPHI({ secret, enabled: false }), req.auth.subjectId);
  res.json({
    ok: true, secret,
    otpauthUrl: `otpauth://totp/VELTRUVIA:${encodeURIComponent(u.email)}?secret=${secret}&issuer=VELTRUVIA`,
  });
}));

// Enable: prove possession of the authenticator by echoing a valid code.
const totpCodeSchema = z.object({ code: z.string().min(6).max(6) });
authRouter.post('/totp/enable', authenticate, validate(totpCodeSchema), asyncHandler(async (req, res) => {
  if (req.auth.subjectType !== 'user') return res.status(403).json({ error: 'Accounts only' });
  const u = await db.prepare('SELECT totp_enc FROM users WHERE id = ?').get(req.auth.subjectId);
  const totp = decryptPHI(u?.totp_enc);
  if (!totp?.secret) return res.status(400).json({ error: 'Run /totp/setup first' });
  if (!verifyTotp(totp.secret, req.valid.code)) return res.status(401).json({ error: 'Invalid code' });

  await db.prepare('UPDATE users SET totp_enc = ? WHERE id = ?')
    .run(encryptPHI({ secret: totp.secret, enabled: true }), req.auth.subjectId);
  await writeAudit({ actorId: req.auth.subjectId, actorRole: req.auth.role, action: 'totp.enable', targetId: req.auth.subjectId, ip: req.ip });
  res.json({ ok: true, message: '2FA enabled. Codes will be required at login.' });
}));

// Disable (requires a valid current code).
authRouter.post('/totp/disable', authenticate, validate(totpCodeSchema), asyncHandler(async (req, res) => {
  if (req.auth.subjectType !== 'user') return res.status(403).json({ error: 'Accounts only' });
  const u = await db.prepare('SELECT totp_enc FROM users WHERE id = ?').get(req.auth.subjectId);
  const totp = decryptPHI(u?.totp_enc);
  if (!totp?.enabled) return res.status(400).json({ error: '2FA not enabled' });
  if (!verifyTotp(totp.secret, req.valid.code)) return res.status(401).json({ error: 'Invalid code' });

  await db.prepare('UPDATE users SET totp_enc = NULL WHERE id = ?').run(req.auth.subjectId);
  await writeAudit({ actorId: req.auth.subjectId, actorRole: req.auth.role, action: 'totp.disable', targetId: req.auth.subjectId, ip: req.ip });
  res.json({ ok: true });
}));

// ── Logout: revoke the session server-side, not just client-side ──
authRouter.post('/logout', authenticate, asyncHandler(async (req, res) => {
  await revokeSession(req.auth.jti);
  clearSessionCookie(res);
  await writeAudit({ actorId: req.auth.subjectId, actorRole: req.auth.role, action: 'user.logout', ip: req.ip });
  res.json({ ok: true });
}));

// ── Search patients by MRN or name (for doctors) ──────────────────
authRouter.get('/search-patients', authenticate, requireRole('doctor', 'admin'),
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 1) return res.json({ ok: true, patients: [] });

    // Search in kv_store for patient records
    const rows = await db.prepare(
      `SELECT DISTINCT owner_id, k, v_enc FROM kv_store
       WHERE k LIKE 'pat_%' AND k NOT LIKE '%::appts_%'`
    ).all();

    const patients = [];
    for (const row of rows) {
      const data = decryptPHI(row.v_enc);
      if (!data) continue;
      const mrn = data.mrn || row.owner_id.split('::')[1] || '';
      const name = data.name || '';
      const diag = data.diag || data.diagnosis || '';
      const lowerQ = q.toLowerCase();
      if (
        mrn.toLowerCase().includes(lowerQ) ||
        name.toLowerCase().includes(lowerQ)
      ) {
        patients.push({ mrn, name, diag });
      }
    }

    // Also search the patients table if it exists
    try {
      const dbPatients = await db.prepare(
        `SELECT mrn, name, diagnosis FROM patients WHERE mrn LIKE ? OR name LIKE ? LIMIT 10`
      ).all(`%${q}%`, `%${q}%`);
      const seenM = new Set(patients.map(p => p.mrn));
      for (const p of dbPatients) {
        if (!seenM.has(p.mrn)) {
          patients.push({ mrn: p.mrn, name: p.name, diag: p.diagnosis || '' });
          seenM.add(p.mrn);
        }
      }
    } catch (_) { /* patients table may not exist */ }

    res.json({ ok: true, patients: patients.slice(0, 20) });
  })
);
