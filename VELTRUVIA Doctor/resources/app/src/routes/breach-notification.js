// ═══════════════════════════════════════════════════════════════════════
// BREACH NOTIFICATION & INCIDENT RESPONSE
// ═══════════════════════════════════════════════════════════════════════
// HIPAA Breach Notification Rule (45 CFR §§164.400–414) compliance.
// Incident tracking, severity classification, notification workflows,
// and OCR (Office for Civil Rights) reporting.

import { Router } from 'express';
import { z } from 'zod';
import { db, writeAudit } from '../db/index.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { randomToken } from '../crypto.js';

export const breachRouter = Router();

// ── Breach severity classification ─────────────────────────────────
const BREACH_CLASSES = {
  low: {
    notificationDays: 60, // Can notify within 60 days
    requiresOCR: false,   // Under 500 individuals
    requiresMedia: false,
    description: 'Breach affecting fewer than 500 individuals — annual log to HHS sufficient',
  },
  high: {
    notificationDays: 60,
    requiresOCR: true,    // Must notify HHS within 60 days
    requiresMedia: false, // Under 500 individuals in a state
    description: 'Breach affecting 500+ individuals — notify HHS within 60 days',
  },
  critical: {
    notificationDays: 60,
    requiresOCR: true,
    requiresMedia: true,  // Must notify prominent media outlets
    description: 'Breach affecting 500+ individuals in a state/jurisdiction — notify HHS, media, and individuals',
  },
};

// ── Incident types ─────────────────────────────────────────────────
const INCIDENT_TYPES = {
  unauthorized_access: 'Unauthorized access to PHI',
  data_leak: 'Unintentional disclosure or data leak',
  ransomware: 'Ransomware or malware attack',
  theft: 'Theft of device or media containing PHI',
  hacking: 'Hacking or unauthorized system access',
  insider_threat: 'Intentional unauthorized access by workforce member',
  lost_device: 'Lost or stolen device with unencrypted PHI',
  fax_error: 'Fax sent to wrong recipient',
  email_error: 'Email with PHI sent to wrong recipient',
  misdirected_mail: 'Mail containing PHI misdirected',
  improper_disposal: 'Improper disposal of PHI media',
  other: 'Other breach type',
};

// ── Report a breach ────────────────────────────────────────────────
const breachSchema = z.object({
  incidentType: z.enum(Object.keys(INCIDENT_TYPES)),
  description: z.string().min(10).max(5000),
  affectedPatientMrns: z.array(z.string()).max(10000).default([]),
  individualsCount: z.number().int().min(1).max(100000),
  dataTypes: z.array(z.enum([
    'name', 'dob', 'ssn', 'mrn', 'diagnosis', 'treatment',
    'medications', 'lab_results', 'insurance', 'financial',
    'biometric', 'genetic', 'mental_health', 'substance_abuse',
  ])).min(1),
  breachClass: z.enum(['low', 'high', 'critical']).default('low'),
  discoveredAt: z.string().optional(), // ISO date
  containmentActions: z.string().max(2000).optional(),
  rootCause: z.string().max(2000).optional(),
  reporterContact: z.string().max(200).optional(),
});

breachRouter.post('/incidents', authenticate, requireRole('admin'),
  validate(breachSchema),
  asyncHandler(async (req, res) => {
    const p = req.valid;
    const id = randomToken(16);
    const classInfo = BREACH_CLASSES[p.breachClass];
    const discoveredAt = p.discoveredAt || new Date().toISOString();
    const notificationDeadline = new Date(discoveredAt);
    notificationDeadline.setDate(notificationDeadline.getDate() + classInfo.notificationDays);

    // Auto-classify based on count
    let autoClass = p.breachClass;
    if (p.individualsCount >= 500) {
      autoClass = p.breachClass === 'low' ? 'high' : p.breachClass;
    }

    await db.prepare(`
      INSERT INTO security_incidents (id, incident_type, severity, status, description, affected_count, discovered_at, reported_at, reported_by, notification_deadline, containment_actions, root_cause, metadata)
      VALUES (?, ?, ?, 'open', ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
    `).run(
      id, p.incidentType, autoClass, p.description, p.individualsCount,
      discoveredAt, req.auth.subjectId, notificationDeadline.toISOString(),
      p.containmentActions || null, p.rootCause || null,
      JSON.stringify({
        dataTypes: p.dataTypes,
        affectedPatientMrns: p.affectedPatientMrns.slice(0, 100), // Store first 100 for audit
        classInfo,
        reporterContact: p.reporterContact,
      })
    );

    await writeAudit({
      actorId: req.auth.subjectId, actorRole: 'admin',
      action: 'breach.incident.create', targetId: id,
      detail: {
        incidentType: p.incidentType,
        severity: autoClass,
        individualsCount: p.individualsCount,
        notificationDeadline: notificationDeadline.toISOString(),
        requiresOCR: classInfo.requiresOCR,
        requiresMedia: classInfo.requiresMedia,
      },
      ip: req.ip,
    });

    res.status(201).json({
      ok: true,
      incident: {
        id,
        incidentType: p.incidentType,
        severity: autoClass,
        individualsCount: p.individualsCount,
        notificationDeadline: notificationDeadline.toISOString(),
        requiresOCR: classInfo.requiresOCR,
        requiresMedia: classInfo.requiresMedia,
        notificationDays: classInfo.notificationDays,
        description: classInfo.description,
      },
      nextSteps: [
        classInfo.requiresOCR ? '⚠️ File breach report with HHS at https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf' : null,
        classInfo.requiresMedia ? '⚠️ Notify prominent media outlets in affected jurisdiction' : null,
        '📧 Send individual notification letters to affected patients',
        '📝 Document all remediation actions',
        '🔒 Implement additional security controls to prevent recurrence',
        '📞 Consult legal counsel for potential regulatory exposure',
        '📊 Conduct post-incident review within 30 days',
      ].filter(Boolean),
    });
  })
);

// ── List all incidents ─────────────────────────────────────────────
breachRouter.get('/incidents', authenticate, requireRole('admin'),
  asyncHandler(async (req, res) => {
    const status = req.query.status || 'all';
    const query = status === 'all'
      ? 'SELECT * FROM security_incidents ORDER BY discovered_at DESC'
      : 'SELECT * FROM security_incidents WHERE status = ? ORDER BY discovered_at DESC';
    const params = status === 'all' ? [] : [status];

    const incidents = await db.prepare(query).all(...params);

    const enriched = incidents.map(i => {
      let meta = {};
      try { meta = JSON.parse(i.metadata || '{}'); } catch {}
      return {
        ...i,
        isOverdue: new Date(i.notification_deadline) < new Date(),
        daysUntilDeadline: Math.max(0, Math.ceil((new Date(i.notification_deadline) - new Date()) / 86400000)),
        dataTypes: meta.dataTypes || [],
      };
    });

    res.json({ ok: true, incidents: enriched });
  })
);

// ── Update incident status ─────────────────────────────────────────
const updateSchema = z.object({
  status: z.enum(['open', 'investigating', 'contained', 'remediated', 'closed']),
  containmentActions: z.string().max(2000).optional(),
  rootCause: z.string().max(2000).optional(),
  notificationSent: z.boolean().optional(),
  notificationSentAt: z.string().optional(),
  hhsReported: z.boolean().optional(),
  hhsReportedAt: z.string().optional(),
  mediaNotified: z.boolean().optional(),
  mediaNotifiedAt: z.string().optional(),
});

breachRouter.patch('/incidents/:id', authenticate, requireRole('admin'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const updates = [];
    const params = [];

    for (const [key, value] of Object.entries(req.valid)) {
      if (value !== undefined) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        updates.push(`${dbKey} = ?`);
        params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
      }
    }

    if (updates.length === 0) return res.json({ ok: true, message: 'No updates' });

    params.push(req.params.id);
    await db.prepare(`UPDATE security_incidents SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    await writeAudit({
      actorId: req.auth.subjectId, actorRole: 'admin',
      action: 'breach.incident.update', targetId: req.params.id,
      detail: req.valid, ip: req.ip,
    });

    res.json({ ok: true, message: 'Incident updated' });
  })
);

// ── Breach risk assessment tool ────────────────────────────────────
const assessSchema = z.object({
  dataTypes: z.array(z.string()),
  individualsCount: z.number().int().min(1),
  encryptionUsed: z.boolean().default(false),
  unauthorizedAccess: z.boolean().default(true),
  PhiExposed: z.boolean().default(true),
});

breachRouter.post('/risk-assessment', authenticate, requireRole('admin'),
  validate(assessSchema),
  asyncHandler(async (req, res) => {
    const { dataTypes, individualsCount, encryptionUsed, unauthorizedAccess, PhiExposed } = req.valid;

    // HIPAA 4-factor risk assessment (45 CFR §164.402)
    const riskFactors = {
      natureAndExtent: {
        score: Math.min(dataTypes.length * 10, 100),
        factors: dataTypes,
        assessment: dataTypes.includes('ssn') || dataTypes.includes('genetic') ? 'high' : 'moderate',
      },
      unauthorizedPerson: {
        score: unauthorizedAccess ? 70 : 0,
        assessment: unauthorizedAccess ? 'unauthorized access occurred' : 'no unauthorized access',
      },
      phiActuallyAcquired: {
        score: PhiExposed ? 80 : 20,
        assessment: PhiExposed ? 'PHI was actually acquired or viewed' : 'PHI was offered but not acquired',
      },
      mitigationExtent: {
        score: encryptionUsed ? 10 : 60,
        assessment: encryptionUsed
          ? 'Encryption rendered PHI unreadable (safe harbor under §164.402(2)(iv))'
          : 'No encryption — full risk exposure',
      },
    };

    const overallScore = Math.round(
      Object.values(riskFactors).reduce((sum, f) => sum + f.score, 0) / 4
    );

    const overallRisk = overallScore >= 70 ? 'high' : overallScore >= 40 ? 'moderate' : 'low';

    // If encryption safe harbor applies, breach may not need notification
    const safeHarbor = encryptionUsed && riskFactors.phiActuallyAcquired.score < 50;

    res.json({
      ok: true,
      assessment: {
        overallScore,
        overallRisk,
        safeHarbor,
        safeHarborMessage: safeHarbor
          ? '✅ Encryption safe harbor applies — PHI was encrypted per NIST standards. This may not constitute a reportable breach under HIPAA §164.402.'
          : '⚠️ No safe harbor — determine if notification is required based on 4-factor test.',
        factors: riskFactors,
        recommendation: overallRisk === 'high'
          ? 'Breach notification likely required. Consult legal counsel and begin notification process.'
          : overallRisk === 'moderate'
          ? 'Breach notification may be required. Document risk assessment and consult legal.'
          : 'Low risk — document and monitor. Annual log to HHS may suffice.',
        affectedIndividuals: individualsCount,
        notificationDeadline: individualsCount >= 500 ? '60 days from discovery' : 'Annual log',
      },
    });
  })
);

// ── Get incident types (for UI) ────────────────────────────────────
breachRouter.get('/incident-types', authenticate,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, types: INCIDENT_TYPES, classes: BREACH_CLASSES });
  })
);
