// ═══════════════════════════════════════════════════════════════════════
// FHIR R4 COMPATIBLE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════
// FHIR R4 (4.0.1) compatible resource endpoints for interoperability.
// Includes CapabilityStatement for endpoint discovery.

import { Router } from 'express';
import { z } from 'zod';
import { db, writeAudit } from '../db/index.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/validate.js';

export const fhirRouter = Router();

// All FHIR routes require authentication
fhirRouter.use(authenticate);
fhirRouter.use(requireRole('doctor', 'admin'));

// ── CapabilityStatement (metadata) ─────────────────────────────────
// GET /api/fhir/metadata — required by FHIR spec for endpoint discovery
fhirRouter.get('/metadata', asyncHandler(async (req, res) => {
  const capability = {
    resourceType: 'CapabilityStatement',
    id: 'veltruvia',
    url: `${req.protocol}://${req.get('host')}/api/fhir/metadata`,
    version: '4.0.1',
    name: 'VELTRUVIA',
    title: 'VELTRUVIA Neuro-Oncology EMR — FHIR Interface',
    status: 'active',
    experimental: false,
    kind: 'instance',
    software: {
      name: 'VELTRUVIA',
      version: '1.0.0',
    },
    implementation: {
      description: 'VELTRUVIA Neuro-Oncology EMR — FHIR R4 Interface',
      url: `${req.protocol}://${req.get('host')}/api/fhir`,
    },
    fhirVersion: '4.0.1',
    format: ['json'],
    rest: [{
      mode: 'server',
      security: {
        cors: true,
        service: [{
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/restful-security-service', code: 'SMART-on-FHIR' }],
          text: 'JWT Bearer token authentication',
        }],
        description: 'JWT bearer token authentication via Authorization header',
      },
      resource: [
        {
          type: 'Patient',
          interaction: [
            { code: 'read' },
            { code: 'search-type' },
          ],
          versioning: 'no-version',
          readHistory: false,
          searchParam: [
            { name: 'identifier', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'family', type: 'string' },
            { name: 'given', type: 'string' },
            { name: 'birthdate', type: 'date' },
            { name: 'gender', type: 'token' },
          ],
        },
        {
          type: 'Condition',
          interaction: [
            { code: 'read' },
            { code: 'search-type' },
          ],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'code', type: 'token' },
            { name: 'clinical-status', type: 'token' },
          ],
        },
        {
          type: 'MedicationRequest',
          interaction: [
            { code: 'read' },
            { code: 'search-type' },
          ],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'status', type: 'token' },
            { name: 'intent', type: 'token' },
          ],
        },
        {
          type: 'Observation',
          interaction: [
            { code: 'read' },
            { code: 'search-type' },
          ],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'code', type: 'token' },
            { name: 'category', type: 'token' },
          ],
        },
        {
          type: 'AllergyIntolerance',
          interaction: [
            { code: 'read' },
            { code: 'search-type' },
          ],
          searchParam: [
            { name: 'patient', type: 'reference' },
          ],
        },
        {
          type: 'Bundle',
          interaction: [
            { code: 'read' },
          ],
        },
      ],
    }],
  };

  res.json(capability);
}));

// ── Patient resource ───────────────────────────────────────────────
fhirRouter.get('/Patient/:mrn', asyncHandler(async (req, res) => {
  const mrn = req.params.mrn.toUpperCase();
  const patientData = await db.prepare(`SELECT v_enc FROM kv_store WHERE k = ?`).get(`pat_${mrn}`);

  if (!patientData) {
    return res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'not-found', diagnostics: `Patient ${mrn} not found` }],
    });
  }

  let patient;
  try {
    let raw = patientData.v_enc;
    try { const { decryptPHI } = await import('../crypto.js'); raw = decryptPHI(raw); } catch {}
    patient = JSON.parse(raw);
  } catch { patient = {}; }

  const fhirPatient = {
    resourceType: 'Patient',
    id: mrn,
    identifier: [{ system: 'http://veltruvia.local/mrn', value: mrn }],
    name: patient.name ? [{ use: 'official', text: patient.name }] : [],
    gender: patient.sex || patient.gender || 'unknown',
    birthDate: patient.dob || patient.birthDate || undefined,
    active: true,
    meta: {
      lastUpdated: new Date().toISOString(),
      profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'],
    },
  };

  await writeAudit({
    actorId: req.auth.subjectId, actorRole: req.auth.role,
    action: 'fhir.patient.read', targetId: mrn, ip: req.ip,
  });

  res.json(fhirPatient);
}));

// ── Condition resource ─────────────────────────────────────────────
fhirRouter.get('/Condition', asyncHandler(async (req, res) => {
  const patientMrn = req.query.patient;
  if (!patientMrn) {
    return res.status(400).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'required', diagnostics: 'patient parameter is required' }],
    });
  }

  // Try to get conditions from clinical notes
  const notes = await db.prepare(`
    SELECT * FROM clinical_notes WHERE patient_mrn = ?
  `).all(patientMrn.toUpperCase());

  const conditions = notes.map(n => ({
    resourceType: 'Condition',
    id: n.id,
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
    verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
    subject: { reference: `Patient/${patientMrn}` },
    code: { text: n.note_type || 'Clinical condition' },
    note: [{ text: n.assessment || n.free_text || n.subjective || '' }],
    recordedDate: n.created_at,
  }));

  const bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    total: conditions.length,
    entry: conditions.map(c => ({ resource: c })),
  };

  res.json(bundle);
}));

// ── MedicationRequest resource ─────────────────────────────────────
fhirRouter.get('/MedicationRequest', asyncHandler(async (req, res) => {
  const patientMrn = req.query.patient;
  if (!patientMrn) {
    return res.status(400).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'required', diagnostics: 'patient parameter is required' }],
    });
  }

  const prescriptions = await db.prepare(`
    SELECT * FROM prescriptions WHERE patient_mrn = ? ORDER BY created_at DESC
  `).all(patientMrn.toUpperCase());

  const medicationRequests = prescriptions.map(rx => ({
    resourceType: 'MedicationRequest',
    id: rx.id,
    status: rx.status === 'active' ? 'active' : rx.status === 'cancelled' ? 'cancelled' : 'completed',
    intent: 'order',
    medicationCodeableConcept: { text: rx.medication },
    dosageInstruction: [{
      text: `${rx.dosage} ${rx.frequency}`,
      timing: { code: { text: rx.frequency } },
      doseAndRate: [{ doseQuantity: { value: parseFloat(rx.dosage) || 0, unit: 'mg' } }],
    }],
    dispenseRequest: {
      numberOfRepeatsAllowed: rx.refills || 0,
      quantity: { value: rx.quantity, unit: 'tablets' },
    },
    subject: { reference: `Patient/${patientMrn}` },
    authoredOn: rx.created_at,
    requester: { reference: `Practitioner/${rx.doctor_id}` },
  }));

  const bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    total: medicationRequests.length,
    entry: medicationRequests.map(m => ({ resource: m })),
  };

  res.json(bundle);
}));

// ── Observation resource (lab results) ─────────────────────────────
fhirRouter.get('/Observation', asyncHandler(async (req, res) => {
  const patientMrn = req.query.patient;
  if (!patientMrn) {
    return res.status(400).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'required', diagnostics: 'patient parameter is required' }],
    });
  }

  const results = await db.prepare(`
    SELECT * FROM biomarker_results WHERE patient_mrn = ? ORDER BY report_date DESC
  `).all(patientMrn.toUpperCase());

  const observations = results.map(r => ({
    resourceType: 'Observation',
    id: r.id,
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: r.biomarker },
    subject: { reference: `Patient/${patientMrn}` },
    effectiveDateTime: r.report_date,
    valueQuantity: r.numeric_value && !isNaN(parseFloat(r.numeric_value))
      ? { value: parseFloat(r.numeric_value), unit: r.method || '' }
      : undefined,
    valueString: r.result || undefined,
    note: r.notes ? [{ text: r.notes }] : [],
  }));

  const bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    total: observations.length,
    entry: observations.map(o => ({ resource: o })),
  };

  res.json(bundle);
}));

// ── AllergyIntolerance resource ────────────────────────────────────
fhirRouter.get('/AllergyIntolerance', asyncHandler(async (req, res) => {
  const patientMrn = req.query.patient;
  if (!patientMrn) {
    return res.status(400).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'required', diagnostics: 'patient parameter is required' }],
    });
  }

  const allergies = await db.prepare(`
    SELECT * FROM patient_allergies WHERE patient_mrn = ?
  `).all(patientMrn.toUpperCase());

  const fhirAllergies = allergies.map(a => ({
    resourceType: 'AllergyIntolerance',
    id: a.id,
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
    verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'confirmed' }] },
    type: 'drug',
    category: ['medication'],
    criticality: a.severity === 'anaphylaxis' || a.severity === 'severe' ? 'high' : 'low',
    code: { text: a.drug_name },
    patient: { reference: `Patient/${patientMrn}` },
    reaction: a.reaction ? [{ manifestation: [{ text: a.reaction }], severity: a.severity }] : [],
  }));

  const bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    total: fhirAllergies.length,
    entry: fhirAllergies.map(a => ({ resource: a })),
  };

  res.json(bundle);
}));

// ── Bundle resource (aggregate patient data) ───────────────────────
fhirRouter.get('/Bundle/:mrn', asyncHandler(async (req, res) => {
  const mrn = req.params.mrn.toUpperCase();

  // Fetch all resources for this patient
  const patientData = await db.prepare(`SELECT v_enc FROM kv_store WHERE k = ?`).get(`pat_${mrn}`);
  const notes = await db.prepare(`SELECT * FROM clinical_notes WHERE patient_mrn = ?`).all(mrn);
  const prescriptions = await db.prepare(`SELECT * FROM prescriptions WHERE patient_mrn = ?`).all(mrn);
  const results = await db.prepare(`SELECT * FROM biomarker_results WHERE patient_mrn = ?`).all(mrn);
  const allergies = await db.prepare(`SELECT * FROM patient_allergies WHERE patient_mrn = ?`).all(mrn);

  const entries = [];

  // Patient
  if (patientData) {
    try {
      let raw = patientData.v_enc;
      // Decrypt if encrypted (try-catch for plaintext fallback)
      try { const { decryptPHI } = await import('../crypto.js'); raw = decryptPHI(raw); } catch {}
      const patient = JSON.parse(raw);
      entries.push({
        resource: {
          resourceType: 'Patient',
          id: mrn,
          identifier: [{ system: 'http://veltruvia.local/mrn', value: mrn }],
          name: patient.name ? [{ use: 'official', text: patient.name }] : [],
          gender: patient.sex || 'unknown',
          birthDate: patient.dob || undefined,
        },
      });
    } catch {}
  }

  // Allergies
  for (const a of allergies) {
    entries.push({
      resource: {
        resourceType: 'AllergyIntolerance',
        id: a.id,
        code: { text: a.drug_name },
        patient: { reference: `Patient/${mrn}` },
        criticality: a.severity === 'severe' || a.severity === 'anaphylaxis' ? 'high' : 'low',
      },
    });
  }

  // Prescriptions
  for (const rx of prescriptions) {
    entries.push({
      resource: {
        resourceType: 'MedicationRequest',
        id: rx.id,
        status: rx.status === 'active' ? 'active' : 'completed',
        medicationCodeableConcept: { text: rx.medication },
        subject: { reference: `Patient/${mrn}` },
      },
    });
  }

  // Lab results
  for (const r of results) {
    entries.push({
      resource: {
        resourceType: 'Observation',
        id: r.id,
        status: 'final',
        code: { text: r.biomarker },
        subject: { reference: `Patient/${mrn}` },
        valueString: r.value,
      },
    });
  }

  const bundle = {
    resourceType: 'Bundle',
    type: 'collection',
    total: entries.length,
    entry: entries,
  };

  await writeAudit({
    actorId: req.auth.subjectId, actorRole: req.auth.role,
    action: 'fhir.bundle.read', targetId: mrn,
    detail: { totalResources: entries.length },
    ip: req.ip,
  });

  res.json(bundle);
}));
