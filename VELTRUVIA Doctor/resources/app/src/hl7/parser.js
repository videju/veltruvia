// ═══════════════════════════════════════════════════════════════════
// HL7v2 Message Parser
// Parses HL7v2 ADT (patient registration), ORU (lab results),
// and ORM (orders) messages into internal VELTRUVIA format.
//
// HL7v2 format: MSH|...\\rEVN|...\\rPID|...\\r
// Fields are separated by |, components by ^
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse a raw HL7v2 message string into segments.
 * @param {string} raw - The raw HL7 message (with \\r, \\n, or \\r\\n separators)
 * @returns {Object[]} Array of parsed segments
 */
export function parseHL7(raw) {
  if (!raw || typeof raw !== 'string') return [];

  // Normalize line endings: HL7 uses \r, but allow \n and \r\n
  const normalized = raw.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
  const lines = normalized.split('\r').filter(l => l.trim());

  const segments = [];
  for (const line of lines) {
    const fields = line.split('|');
    const segment = {
      type: fields[0],
      fields: fields.slice(1),
    };
    segments.push(segment);
  }
  return segments;
}

/**
 * Extract the MSH (Message Header) segment.
 */
export function getMSH(segments) {
  const msh = segments.find(s => s.type === 'MSH');
  if (!msh) return null;

  // MSH is special: field separator is MSH-1, so fields shift by 1.
  // fields[0] = encoding characters (^~\&), i.e. MSH-2, because MSH-1 is
  // the '|' separator itself which split() consumed.
  return {
    fieldType: '|',                       // MSH-1: field separator
    encodingChars: msh.fields[0] || '^~\\&', // MSH-2: encoding characters
    messageType: msh.fields[7] || '',     // MSH-9: message type (e.g., ADT^A01)
    controlId: msh.fields[8] || '',       // MSH-10: message control ID
    processingId: msh.fields[9] || '',    // MSH-11: processing ID
    versionId: msh.fields[10] || '',      // MSH-12: HL7 version (e.g., 2.5.1)
    sendingApp: msh.fields[1] || '',      // MSH-3: sending application
    sendingFacility: msh.fields[3] || '', // MSH-5: sending facility
    receivingApp: msh.fields[2] || '',    // MSH-4: receiving application
    timestamp: msh.fields[5] || '',       // MSH-7: date/time of message
  };
}

/**
 * Extract the PID (Patient Identification) segment.
 */
export function getPID(segments) {
  const pid = segments.find(s => s.type === 'PID');
  if (!pid) return null;

  const f = pid.fields;
  return {
    setId: f[0] || '',                          // PID-1: set ID
    patientId: f[2] || '',                       // PID-2: patient ID (external)
    patientIdList: f[3] || '',                   // PID-3: patient ID list
    name: parseHL7Name(f[4] || ''),              // PID-4: patient name
    dateOfBirth: parseHL7Date(f[6] || ''),       // PID-7: DOB (YYYYMMDD)
    gender: parseHL7Gender(f[7] || ''),          // PID-8: sex
    address: parseHL7Address(f[10] || ''),       // PID-11: address
    phone: parseHL7Phone(f[13] || ''),           // PID-13: phone
    mrn: extractMRN(f[3] || f[2] || ''),        // PID-3 or PID-2: MRN
  };
}

/**
 * Extract the OBR (Observation Request) segment (lab order info).
 */
export function getOBR(segments) {
  const obr = segments.find(s => s.type === 'OBR');
  if (!obr) return null;

  const f = obr.fields;
  return {
    setId: f[0] || '',
    orderNumber: f[1] || '',
    universalServiceId: f[2] || '',         // OBR-4: test code
    priority: f[5] || '',                   // OBR-7: priority
    specimenReceivedTime: parseHL7Date(f[13] || ''), // OBR-14
    observationEnd: parseHL7Date(f[14] || ''),        // OBR-15
    orderingProvider: parseHL7Name(f[15] || ''),      // OBR-16
    resultStatus: f[24] || '',              // OBR-25: result status
  };
}

/**
 * Extract OBX (Observation Result) segments — individual lab values.
 */
export function getOBX(segments) {
  return segments
    .filter(s => s.type === 'OBX')
    .map(obx => {
      const f = obx.fields;
      const valueType = f[1] || 'NM'; // NM=numeric, ST=string, etc.
      const value = f[4] || '';
      const unit = f[5] || '';
      const refRange = f[6] || '';
      const abnormalFlag = f[7] || '';
      const resultCode = f[2] || '';
      // OBX-3 is CWE: identifier^text^codesystem — prefer the human-readable text
      const idParts = (f[2] || '').split('^');
      const resultText = idParts[1] || idParts[0] || '';

      // Parse numeric values
      let numericValue = null;
      if (valueType === 'NM') {
        numericValue = parseFloat(value);
        if (isNaN(numericValue)) numericValue = null;
      }

      return {
        setId: f[0] || '',
        valueType,
        resultCode,                    // OBX-3: test code (e.g., LOINC)
        resultText,                    // OBX-3.1: test name
        value,
        numericValue,
        unit,
        refRange,
        abnormalFlag,                  // H=high, L=low, HH=critical high, etc.
        status: f[10] || '',           // OBX-11: result status
        dateObserved: parseHL7Date(f[13] || ''), // OBX-14
        performingOrg: f[23] || '',    // OBX-24
      };
    });
}

/**
 * Extract AL1 (Allergy) segments.
 */
export function getAL1(segments) {
  return segments
    .filter(s => s.type === 'AL1')
    .map(al1 => {
      const f = al1.fields;
      return {
        setId: f[0] || '',
        allergenType: f[1] || '',        // AL1-2: allergen type code
        allergenCode: f[2] || '',        // AL1-3: allergen code
        allergenName: f[3] || '',        // AL1-3.1: allergen name
        reaction: f[4] || '',            // AL1-4: reaction
        severity: parseHL7Severity(f[5] || ''), // AL1-5: severity
        identificationDate: parseHL7Date(f[6] || ''), // AL1-6
      };
    });
}

// ═══════════════════════════════════════════════════════════════════
// HL7 → VELTRUVIA Format Converters
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert parsed HL7 message to VELTRUVIA lab result format.
 */
export function hl7ToLabResult(rawHL7) {
  const segments = parseHL7(rawHL7);
  const msh = getMSH(segments);
  const pid = getPID(segments);
  const obr = getOBR(segments);
  const obxList = getOBX(segments);

  if (!pid) throw new Error('No PID segment found in HL7 message');

  const results = obxList.map(obx => ({
    testName: obx.resultText || obx.resultCode,
    testCode: obx.resultCode,
    value: obx.value,
    numericValue: obx.numericValue,
    unit: obx.unit,
    referenceRange: obx.refRange,
    abnormalFlag: obx.abnormalFlag,
    status: obx.status,
    dateObserved: obx.dateObserved,
    valueType: obx.valueType,
  }));

  return {
    patient: {
      mrn: pid.mrn,
      name: pid.name?.full || '',
      dateOfBirth: pid.dateOfBirth,
      gender: pid.gender,
    },
    order: obr ? {
      orderNumber: obr.orderNumber,
      testCode: obr.universalServiceId,
      priority: obr.priority,
      orderingProvider: obr.orderingProvider?.full || '',
      resultStatus: obr.resultStatus,
    } : null,
    results,
    metadata: {
      source: msh?.sendingApp || 'HL7',
      facility: msh?.sendingFacility || '',
      messageType: msh?.messageType || '',
      controlId: msh?.controlId || '',
      receivedAt: new Date().toISOString(),
    },
  };
}

/**
 * Convert parsed HL7 ADT message to VELTRUVIA patient format.
 */
export function hl7ToPatient(rawHL7) {
  const segments = parseHL7(rawHL7);
  const pid = getPID(segments);
  const al1List = getAL1(segments);

  if (!pid) throw new Error('No PID segment found in HL7 message');

  return {
    mrn: pid.mrn,
    name: pid.name?.full || '',
    firstName: pid.name?.given || '',
    lastName: pid.name?.family || '',
    dateOfBirth: pid.dateOfBirth,
    gender: pid.gender,
    address: pid.address,
    phone: pid.phone,
    allergies: al1List.map(a => ({
      name: a.allergenName,
      reaction: a.reaction,
      severity: a.severity,
    })),
    demographics: {
      firstName: pid.name?.given || '',
      lastName: pid.name?.family || '',
      gender: pid.gender,
      dob: pid.dateOfBirth,
      phone: pid.phone,
      address: pid.address?.full || '',
    },
  };
}

/**
 * Convert VELTRUVIA lab result to HL7v2 ORU^R01 message.
 */
export function labResultToHL7(mrn, labResult, facilityName = 'VELTRUVIA') {
  const now = formatHL7Date(new Date());
  const controlId = `MSG${Date.now()}`;

  const segments = [
    // MSH - Message Header
    `MSH|^~\\&|${facilityName}|VELTRUVIA|LAB_SYSTEM|LAB|${now}||ORU^R01|${ controlId }|P|2.5.1`,
    // PID - Patient Identification
    `PID|1||${mrn}^^^${facilityName}^MR||${labResult.patientName || 'Unknown'}||${labResult.dateOfBirth || ''}|${labResult.gender || 'U'}`,
    // OBR - Observation Request
    `OBR|1||${controlId}|${labResult.testCode || labResult.testName}|||${now}|||||||${now}||||||||F`,
    // OBX - Observation Result
    `OBX|1|${labResult.valueType || 'NM'}|${labResult.testCode || labResult.testName}^${labResult.testName}||${labResult.value}|${labResult.unit || ''}|${labResult.referenceRange || ''}|${labResult.abnormalFlag || ''}|||F|||${now}`,
  ];

  return segments.join('\r') + '\r';
}

// ═══════════════════════════════════════════════════════════════════
// HL7 Parsing Helpers
// ═══════════════════════════════════════════════════════════════════

function parseHL7Name(field) {
  if (!field) return null;
  const parts = field.split('^');
  return {
    family: parts[0] || '',
    given: parts[1] || '',
    middle: parts[2] || '',
    prefix: parts[4] || '',
    full: `${parts[4] ? parts[4] + ' ' : ''}${parts[1] || ''} ${parts[0] || ''}`.trim(),
  };
}

function parseHL7Address(field) {
  if (!field) return null;
  const parts = field.split('^');
  return {
    street: parts[0] || '',
    other: parts[1] || '',
    city: parts[2] || '',
    state: parts[3] || '',
    zip: parts[4] || '',
    country: parts[5] || '',
    full: `${parts[0] || ''}, ${parts[2] || ''}, ${parts[3] || ''} ${parts[4] || ''}`.trim(),
  };
}

function parseHL7Phone(field) {
  if (!field) return null;
  const parts = field.split('^');
  return parts[0] || field;
}

function parseHL7Date(hl7Date) {
  if (!hl7Date) return null;
  // HL7 date format: YYYYMMDD or YYYYMMDDHHmmss
  const match = hl7Date.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/);
  if (!match) return hl7Date; // return as-is if not standard format

  const [, y, m, d, H, M, S] = match;
  if (H) return `${y}-${m}-${d}T${H}:${M}:${S}`;
  return `${y}-${m}-${d}`;
}

function parseHL7Gender(genderCode) {
  const map = { 'M': 'male', 'F': 'female', 'O': 'other', 'U': 'unknown' };
  return map[genderCode] || 'unknown';
}

function parseHL7Severity(severityCode) {
  const map = { 'SV': 'severe', 'MO': 'moderate', 'MI': 'mild', 'PN': 'life-threatening' };
  return map[severityCode] || severityCode || 'moderate';
}

function extractMRN(pidField3) {
  // PID-3 format: MRN^^^FACILITY^MR
  const parts = pidField3.split('^');
  return parts[0] || pidField3;
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

// ═══════════════════════════════════════════════════════════════════════
// HL7 ACK Generation (used by MLLP server)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse an HL7 message and return structured data for the MLLP handler.
 */
export function parseHL7Message(rawHL7) {
  const segments = parseHL7(rawHL7);
  const msh = getMSH(segments);
  const pid = getPID(segments);
  const obr = getOBR(segments);
  const obxList = getOBX(segments);

  const eventType = msh?.messageType || '';
  const patientId = pid?.mrn || '';
  const patientName = pid?.name?.full || '';
  const dob = pid?.dateOfBirth || '';
  const sex = pid?.gender || '';
  const orderId = obr?.orderNumber || '';
  const orderingProvider = obr?.orderingProvider?.full || '';

  const observations = obxList.map(obx => ({
    testName: obx.resultText || obx.resultCode,
    identifier: obx.resultCode,
    value: obx.value || String(obx.numericValue || ''),
    units: obx.unit || '',
    referenceRange: obx.refRange || '',
    abnormalFlag: obx.abnormalFlag || null,
  }));

  return {
    eventType,
    patientId,
    patientMrn: patientId,
    patientName,
    dob,
    sex,
    orderId,
    orderingProvider,
    observations,
    header: msh || {},
    controlId: msh?.controlId || `msg-${Date.now()}`,
  };
}

/**
 * Generate an HL7 ACK (acknowledgment) message.
 * @param {Object} parsed - Parsed message (from parseHL7Message)
 * @param {string} ackCode - AA (accept), AE (error), or AR (reject)
 * @param {string} [errorMessage] - Optional error text for ACK-7
 * @returns {string} ACK message string
 */
export function generateAck(parsed, ackCode = 'AA', errorMessage = '') {
  const now = formatHL7Date(new Date());
  const controlId = parsed?.controlId || parsed?.header?.controlId || `msg-${Date.now()}`;

  // ACK segment format: MSH-9 = ACK, MSH-10 = new control ID, MSH-11-12 = same as original
  const ackControlId = `ACK-${controlId}-${Date.now()}`;

  return [
    `MSH|^~\&|VELTRUVIA|VELTRUVIA|UNKNOWN|UNKNOWN|${now}||ACK^${ackCode}|${ackControlId}|P|2.5.1`,
    `MSA|${ackCode}|${controlId}|${errorMessage}`,
  ].join('\r');
}
