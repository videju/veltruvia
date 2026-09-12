// ═══════════════════════════════════════════════════════════════════════
// HIPAA CONSENT TRACKING
// ═══════════════════════════════════════════════════════════════════════
// Patient authorization model with granular permissions for PHI access,
// consent management, and authorization tracking per HIPAA §164.508.

import { Router } from 'express';
import { z } from 'zod';
import { db, writeAudit } from '../db/index.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { randomToken } from '../crypto.js';

export const consentRouter = Router();

// ── Consent types (granular permissions) ────────────────────────────
const CONSENT_TYPES = {
  treatment: { description: 'Use PHI for treatment purposes', hipaa: '§164.506 — Treatment, Payment, Operations', required: true },
  payment: { description: 'Use PHI for payment processing', hipaa: '§164.506', required: true },
  operations: { description: 'Use PHI for healthcare operations', hipaa: '§164.506', required: false },
  research: { description: 'Use PHI for research purposes', hipaa: '§164.508 — Authorization required', required: false },
  marketing: { description: 'Use PHI for marketing', hipaa: '§164.508 — Separate authorization required', required: false },
  mental_health: { description: 'Psychotherapy notes access', hipaa: '§164.508 — Separate authorization required', required: false },
  substance_abuse: { description: 'Substance abuse records (42 CFR Part 2)', hipaa: '42 CFR Part 2 — Special protection', required: false },
  hiv_aids: { description: 'HIV/AIDS status information', hipaa: 'State-specific — enhanced protection', required: false },
  genetic: { description: 'Genetic test results', hipaa: 'GINA — Genetic Information Nondiscrimination Act', required: false },
  telehealth: { description: 'Consent to receive telehealth services', hipaa: 'State telehealth consent requirements', required: false },
};

// ── Create consent record ──────────────────────────────────────────
const consentSchema = z.object({
  patientMrn: z.string().min(1).max(40),
  consentType: z.enum(Object.keys(CONSENT_TYPES)),
  status: z.enum(['granted', 'denied', 'revoked', 'pending']).default('granted'),
  scope: z.string().max(500).optional(), // What specific access is being consented
  durationMonths: z.number().int().min(1).max(120).default(12), // Consent duration
  notes: z.string().max(1000).optional(),
});

consentRouter.post('/consent', authenticate, requireRole('doctor', 'admin'),
  validate(consentSchema),
  asyncHandler(async (req, res) => {
    const p = req.valid;
    const id = randomToken(16);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + p.durationMonths);

    // Check if consent already exists
    const existing = await db.prepare(`
      SELECT id, status FROM patient_consents
      WHERE patient_mrn = ? AND consent_type = ? AND status = 'granted'
    `).get(p.patientMrn.toUpperCase(), p.consentType);

    if (existing && p.status === 'granted') {
      return res.status(409).json({
        error: 'Consent already granted',
        existingConsentId: existing.id,
        message: `Patient already has active consent for ${p.consentType}. Revoke first if updating.`,
      });
    }

    await db.prepare(`
      INSERT INTO patient_consents (id, patient_mrn, consent_type, status, scope, granted_by, granted_at, expires_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
    `).run(id, p.patientMrn.toUpperCase(), p.consentType, p.status, p.scope || null,
      req.auth.subjectId, expiresAt.toISOString(), p.notes || null);

    await writeAudit({
      actorId: req.auth.subjectId, actorRole: req.auth.role,
      action: 'hipaa.consent.create', targetId: p.patientMrn,
      detail: { consentType: p.consentType, status: p.status, expiresAt: expiresAt.toISOString() },
      ip: req.ip,
    });

    res.status(201).json({
      ok: true,
      consent: {
        id,
        patientMrn: p.patientMrn.toUpperCase(),
        consentType: p.consentType,
        status: p.status,
        scope: p.scope,
        expiresAt: expiresAt.toISOString(),
        hipaaReference: CONSENT_TYPES[p.consentType]?.hipaa,
      },
    });
  })
);

// ── List consents for a patient ────────────────────────────────────
consentRouter.get('/consent/:mrn', authenticate, requireRole('doctor', 'admin'),
  asyncHandler(async (req, res) => {
    const mrn = req.params.mrn.toUpperCase();
    const consents = await db.prepare(`
      SELECT * FROM patient_consents WHERE patient_mrn = ? ORDER BY granted_at DESC
    `).all(mrn);

    // Enrich with consent type info
    const enriched = consents.map(c => ({
      ...c,
      consentTypeInfo: CONSENT_TYPES[c.consent_type] || null,
      isExpired: c.expires_at ? new Date(c.expires_at) < new Date() : false,
    }));

    res.json({ ok: true, consents: enriched });
  })
);

// ── Revoke consent ─────────────────────────────────────────────────
consentRouter.post('/consent/:id/revoke', authenticate, requireRole('doctor', 'admin', 'patient'),
  asyncHandler(async (req, res) => {
    const result = await db.prepare(`
      UPDATE patient_consents SET status = 'revoked', revoked_at = datetime('now'), revoked_by = ?
      WHERE id = ? AND status = 'granted'
    `).run(req.auth.subjectId, req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Active consent not found' });
    }

    await writeAudit({
      actorId: req.auth.subjectId, actorRole: req.auth.role,
      action: 'hipaa.consent.revoke', targetId: req.params.id,
      detail: { reason: req.body.reason || 'Patient request' },
      ip: req.ip,
    });

    res.json({ ok: true, message: 'Consent revoked' });
  })
);

// ── Get all consent types (for UI display) ─────────────────────────
consentRouter.get('/consent-types', authenticate,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, types: CONSENT_TYPES });
  })
);

// ── Check if specific consent is granted ────────────────────────────
consentRouter.get('/consent-check/:mrn/:type', authenticate,
  asyncHandler(async (req, res) => {
    const mrn = req.params.mrn.toUpperCase();
    const type = req.params.type;

    const consent = await db.prepare(`
      SELECT * FROM patient_consents
      WHERE patient_mrn = ? AND consent_type = ? AND status = 'granted'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(mrn, type);

    res.json({
      ok: true,
      hasConsent: !!consent,
      consent: consent || null,
      consentTypeInfo: CONSENT_TYPES[type] || null,
    });
  })
);

// ── Bulk consent for treatment relationship ────────────────────────
const bulkConsentSchema = z.object({
  patientMrn: z.string().min(1).max(40),
  durationMonths: z.number().int().min(1).max(120).default(12),
});

consentRouter.post('/consent-bulk', authenticate, requireRole('doctor', 'admin'),
  validate(bulkConsentSchema),
  asyncHandler(async (req, res) => {
    const { patientMrn, durationMonths } = req.valid;
    const id = randomToken(16);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + durationMonths);

    // Grant treatment + payment + operations (standard HIPAA treatment relationship)
    const bulkTypes = ['treatment', 'payment', 'operations', 'telehealth'];
    const granted = [];

    for (const type of bulkTypes) {
      const existing = await db.prepare(`
        SELECT id FROM patient_consents
        WHERE patient_mrn = ? AND consent_type = ? AND status = 'granted'
      `).get(patientMrn.toUpperCase(), type);

      if (!existing) {
        const consentId = randomToken(16);
        await db.prepare(`
          INSERT INTO patient_consents (id, patient_mrn, consent_type, status, granted_by, granted_at, expires_at)
          VALUES (?, ?, ?, 'granted', ?, datetime('now'), ?)
        `).run(consentId, patientMrn.toUpperCase(), type, req.auth.subjectId, expiresAt.toISOString());
        granted.push(type);
      }
    }

    if (granted.length > 0) {
      await writeAudit({
        actorId: req.auth.subjectId, actorRole: req.auth.role,
        action: 'hipaa.consent.bulk_grant', targetId: patientMrn,
        detail: { types: granted, expiresAt: expiresAt.toISOString() },
        ip: req.ip,
      });
    }

    res.json({
      ok: true,
      granted,
      alreadyActive: bulkTypes.filter(t => !granted.includes(t)),
      expiresAt: expiresAt.toISOString(),
    });
  })
);
