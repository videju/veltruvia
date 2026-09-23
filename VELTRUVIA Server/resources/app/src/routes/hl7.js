// ═══════════════════════════════════════════════════════════════════
// HL7 LAB INTERFACE — Receive & Send HL7v2 Messages
// ═══════════════════════════════════════════════════════════════════
// Provides HTTP endpoints for lab instruments to send HL7v2 messages
// (ADT for patient registration, ORU for lab results, ORM for orders).
// Parses HL7 and stores results in the VELTRUVIA database.

import { Router } from 'express';
import { z } from 'zod';
import { db, writeAudit } from '../db/index.js';
import { encryptPHI, decryptPHI, randomToken } from '../crypto.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { notifySubject } from '../push.js';
import { parseHL7, getMSH, getPID, getOBR, getOBX, getAL1, hl7ToLabResult, hl7ToPatient, labResultToHL7 } from '../hl7/parser.js';

export const hl7Router = Router();

// ═══════════════════════════════════════════════════════════════════
// INBOUND: Receive HL7v2 messages from lab instruments
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/hl7/receive
 * Accepts raw HL7v2 messages (Content-Type: text/plain or application/hl7-v2)
 * Parses and stores the data in VELTRUVIA.
 */
const receiveSchema = z.object({
  message: z.string().min(10).max(100000),
  source: z.string().max(100).optional(),
});

hl7Router.post('/receive', authenticate, requireRole('doctor', 'admin', 'lab'),
  asyncHandler(async (req, res) => {
    // Accept both JSON body and raw text
    let rawHL7 = req.body.message || req.body;
    if (typeof rawHL7 !== 'string') {
      return res.status(400).json({ error: 'HL7 message must be a string' });
    }

    const segments = parseHL7(rawHL7);
    const msh = getMSH(segments);
    const pid = getPID(segments);

    if (!msh) {
      return res.status(400).json({ error: 'Invalid HL7 message: no MSH segment' });
    }
    if (!pid) {
      return res.status(400).json({ error: 'Invalid HL7 message: no PID segment' });
    }

    const messageType = msh.messageType || '';
    const [msgType, trigger] = messageType.split('^');
    let result = { messageType, controlId: msh.controlId };

    try {
      if (msgType === 'ORU' && trigger === 'R01') {
        // Lab Result message
        result = await processLabResult(segments, msh, pid, req);
      } else if (msgType === 'ADT') {
        // Patient Registration/Update
        result = await processPatientAdt(segments, msh, pid, trigger, req);
      } else if (msgType === 'ORM' && trigger === 'O01') {
        // Lab Order
        result = await processLabOrder(segments, msh, pid, req);
      } else {
        return res.status(400).json({
          error: `Unsupported message type: ${messageType}`,
          supported: ['ORU^R01', 'ADT^A01', 'ADT^A08', 'ORM^O01'],
        });
      }
    } catch (err) {
      console.error(`[hl7] Error processing ${messageType}:`, err.message);
      return res.status(500).json({ error: `Failed to process HL7 message: ${err.message}` });
    }

    // Acknowledge receipt
    res.json({
      ok: true,
      ack: generateACK(msh, 'AA'), // Application Accept
      ...result,
    });
  })
);

/**
 * POST /api/hl7/receive-batch
 * Accepts multiple HL7 messages separated by blank lines.
 */
hl7Router.post('/receive-batch', authenticate, requireRole('doctor', 'admin', 'lab'),
  asyncHandler(async (req, res) => {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array of HL7 strings' });
    }
    if (messages.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 messages per batch' });
    }

    const results = [];
    for (const msg of messages) {
      try {
        const segments = parseHL7(msg);
        const msh = getMSH(segments);
        const pid = getPID(segments);
        if (!msh || !pid) {
          results.push({ status: 'error', error: 'Missing MSH or PID segment' });
          continue;
        }
        const messageType = msh.messageType || '';
        const [msgType, trigger] = messageType.split('^');

        if (msgType === 'ORU' && trigger === 'R01') {
          results.push(await processLabResult(segments, msh, pid, req));
        } else if (msgType === 'ADT') {
          results.push(await processPatientAdt(segments, msh, pid, trigger, req));
        } else {
          results.push({ status: 'error', error: `Unsupported: ${messageType}` });
        }
      } catch (err) {
        results.push({ status: 'error', error: err.message });
      }
    }

    const successCount = results.filter(r => r.status !== 'error').length;
    res.json({ ok: true, total: messages.length, success: successCount, results });
  })
);

// ═══════════════════════════════════════════════════════════════════
// OUTBOUND: Generate HL7v2 messages from VELTRUVIA data
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/hl7/patient/:mrn
 * Generate ADT^A08 (patient update) HL7 message for a patient.
 */
hl7Router.get('/patient/:mrn', authenticate, requireRole('doctor', 'admin'),
  asyncHandler(async (req, res) => {
    const mrn = req.params.mrn.toUpperCase();
    const kvRow = await db.prepare('SELECT v_enc FROM kv_store WHERE k = ?').get('pat_' + mrn);
    if (!kvRow) return res.status(404).json({ error: 'Patient not found' });

    const patData = decryptPHI(kvRow.v_enc) || {};
    const now = formatHL7Date(new Date());
    const controlId = `MSG${Date.now()}`;

    const hl7 = [
      `MSH|^~\\&|VELTRUVIA|VELTRUVIA|REQUESTING_SYS||${now}||ADT^A08|${controlId}|P|2.5.1`,
      `EVN|A08|${now}`,
      `PID|1||${mrn}^^^VELTRUVIA^MR||${patData.name || 'Unknown'}||${patData.dob || ''}|${patData.gender || 'U'}`,
    ].join('\r');

    res.setHeader('Content-Type', 'application/hl7-v2');
    res.send(hl7);
  })
);

/**
 * GET /api/hl7/lab-result/:mrn
 * Generate ORU^R01 HL7 message for a patient's latest lab results.
 */
hl7Router.get('/lab-result/:mrn', authenticate, requireRole('doctor', 'admin'),
  asyncHandler(async (req, res) => {
    const mrn = req.params.mrn.toUpperCase();
    const bios = await db.prepare('SELECT * FROM biomarker_results WHERE patient_mrn = ? ORDER BY report_date DESC LIMIT 10').all(mrn);

    if (bios.length === 0) {
      return res.status(404).json({ error: 'No lab results found' });
    }

    const now = formatHL7Date(new Date());
    const controlId = `MSG${Date.now()}`;
    const segments = [
      `MSH|^~\\&|VELTRUVIA|VELTRUVIA|REQUESTING_SYS||${now}||ORU^R01|${controlId}|P|2.5.1`,
      `PID|1||${mrn}^^^VELTRUVIA^MR`,
      `OBR|1||${controlId}|LAB_PANEL|||${now}|||||||${now}||||||||F`,
    ];

    bios.forEach((b, i) => {
      segments.push(`OBX|${i + 1}|ST|${b.biomarker}||${b.result}||||||F|||${b.report_date || now}`);
    });

    res.setHeader('Content-Type', 'application/hl7-v2');
    res.send(segments.join('\r'));
  })
);

/**
 * POST /api/hl7/generate
 * Generate HL7 message from structured data.
 */
hl7Router.post('/generate', authenticate, requireRole('doctor', 'admin'),
  asyncHandler(async (req, res) => {
    const { messageType, mrn, labResult } = req.body;
    if (!messageType || !mrn) {
      return res.status(400).json({ error: 'messageType and mrn required' });
    }

    if (messageType === 'ORU^R01' && labResult) {
      const hl7 = labResultToHL7(mrn, labResult);
      res.setHeader('Content-Type', 'application/hl7-v2');
      res.send(hl7);
    } else {
      return res.status(400).json({ error: 'Unsupported messageType or missing data' });
    }
  })
);

// ═══════════════════════════════════════════════════════════════════
// HL7 Processing Helpers
// ═══════════════════════════════════════════════════════════════════

async function processLabResult(segments, msh, pid, req) {
  const obr = getOBR(segments);
  const obxList = getOBX(segments);

  // Find the owning doctor for this MRN
  const mrn = pid.mrn;
  const kvRow = await db.prepare("SELECT owner_id FROM kv_store WHERE k = ?").get('pat_' + mrn);
  const ownerId = kvRow?.owner_id;

  // Store each OBX as a biomarker result
  let stored = 0;
  for (const obx of obxList) {
    if (!obx.resultText && !obx.resultCode) continue;

    const id = randomToken(12);
    try {
      await db.prepare(`
        INSERT INTO biomarker_results (id, doctor_id, patient_mrn, biomarker, result, numeric_value, method, lab_name, report_date, clinical_significance, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        ownerId || req.auth.subjectId,
        mrn,
        obx.resultText || obx.resultCode,
        obx.value,
        obx.numericValue,
        obr?.orderingProvider || null,
        msh?.sendingFacility || '',
        obx.dateObserved || new Date().toISOString(),
        '', // clinical significance to be determined by CDS
        `HL7 import from ${msh?.sendingApp || 'unknown'}`,
        new Date().toISOString()
      );
      stored++;
      // v2.1 delta-check on HL7-ingested results too
      try {
        const { computeDeltaCheck } = await import('./enhancements.js');
        const dc = await computeDeltaCheck({ patientMrn: mrn, biomarker: obx.resultText || obx.resultCode, numericValue: obx.numericValue, reportDate: obx.dateObserved });
        if (dc?.critical) {
          notifySubject(ownerId || req.auth.subjectId, {
            title: '🚨 Critical lab change',
            body: dc.flags.map(f => f.message).join('; '),
            url: '/',
          }).catch(() => {});
        }
      } catch {}
    } catch (err) {
      console.error(`[hl7] Failed to store OBX:`, err.message);
    }
  }

  // Notify doctor of new lab results
  if (ownerId && stored > 0) {
    notifySubject(ownerId, {
      title: '🔬 New Lab Results',
      body: `Lab uploaded ${stored} result(s) for patient ${mrn}`,
      url: '/',
    }).catch(() => {});
  }

  // Write audit
  writeAudit({
    actorId: req.auth.subjectId,
    actorRole: req.auth.role,
    action: 'hl7.lab_result_receive',
    targetId: mrn,
    detail: { messageId: msh.controlId, resultCount: stored },
    ip: req.ip,
  });

  return {
    status: 'processed',
    messageType: 'ORU^R01',
    mrn,
    resultsStored: stored,
  };
}

async function processPatientAdt(segments, msh, pid, trigger, req) {
  // hl7ToPatient expects a raw HL7 string — rebuild it from the parsed segments
  const rawFromSegments = segments.map(s => s.type + '|' + s.fields.join('|')).join('\r');
  const patient = hl7ToPatient(rawFromSegments);

  // Store patient in shared store if not exists
  const mrn = pid.mrn;
  const existing = await db.prepare("SELECT k FROM kv_store WHERE k = ?").get('pat_' + mrn);

  if (!existing) {
    // Create patient record
    const id = randomToken(16);
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO kv_store (owner_id, k, v_enc, updated_at) VALUES (?, ?, ?, ?)
    `).run(req.auth.subjectId, 'pat_' + mrn, encryptPHI({
      mrn,
      name: patient.name,
      dob: patient.dateOfBirth,
      gender: patient.gender,
      phone: patient.phone,
      address: patient.address?.full || '',
      docId: req.auth.subjectId,
      source: 'HL7',
      importedAt: now,
    }), now);

    // Store allergies
    if (patient.allergies?.length) {
      for (const allergy of patient.allergies) {
        try {
          await db.prepare(`
            INSERT OR REPLACE INTO patient_allergies (id, patient_mrn, drug_name, reaction, severity)
            VALUES (?, ?, ?, ?, ?)
          `).run(randomToken(12), mrn, allergy.name.toLowerCase(), allergy.reaction, allergy.severity || 'moderate');
        } catch {}
      }
    }
  }

  writeAudit({
    actorId: req.auth.subjectId,
    actorRole: req.auth.role,
    action: `hl7.adt_${trigger?.toLowerCase() || 'unknown'}`,
    targetId: mrn,
    detail: { messageId: msh.controlId },
    ip: req.ip,
  });

  return {
    status: 'processed',
    messageType: `ADT^${trigger}`,
    mrn,
    patientCreated: !existing,
  };
}

async function processLabOrder(segments, msh, pid, req) {
  const obr = getOBR(segments);
  const mrn = pid.mrn;

  writeAudit({
    actorId: req.auth.subjectId,
    actorRole: req.auth.role,
    action: 'hl7.orm_order',
    targetId: mrn,
    detail: { messageId: msh.controlId, orderCode: obr?.universalServiceId },
    ip: req.ip,
  });

  return {
    status: 'acknowledged',
    messageType: 'ORM^O01',
    mrn,
    orderCode: obr?.universalServiceId,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ACK Generation
// ═══════════════════════════════════════════════════════════════════

function generateACK(originalMSH, ackCode) {
  const now = formatHL7Date(new Date());
  return [
    `MSH|^~\\&|VELTRUVIA|VELTRUVIA|${originalMSH.sendingApp}|${originalMSH.sendingFacility}|${now}||ACK|ACK${Date.now()}|P|2.5.1`,
    `MSA|${ackCode}|${originalMSH.controlId}|${ackCode === 'AA' ? 'Application Accept' : 'Application Error'}`,
  ].join('\r');
}

function formatHL7Date(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const H = String(date.getHours()).padStart(2, '0');
  const M = String(date.getMinutes()).padStart(2, '0');
  const S = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}${H}${M}${S}`;
}
