import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = join(__dirname, 'resources', 'app');
const dbPath = join(appDir, 'test.db');

// Clean old DB
if (existsSync(dbPath)) unlinkSync(dbPath);

const env = {
  ...process.env,
  JWT_SECRET: 'test-secret',
  PHI_ENCRYPTION_KEY: 'test-phi-key-32-bytes-long-here',
  DB_PATH: dbPath,
  PORT: '3000',
};

const child = spawn('node', ['src/server.js'], {
  cwd: appDir,
  env,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.unref();

let output = '';
child.stdout.on('data', d => { output += d; process.stdout.write(d); });
child.stderr.on('data', d => { output += d; process.stderr.write(d); });

// Wait for server to be ready, then test
setTimeout(async () => {
  try {
    const res = await fetch('http://localhost:3000/health');
    const data = await res.json();
    console.log('\n✅ Server health:', JSON.stringify(data));
    
    // Run all tests
    await runTests();
    
    // Kill server
    child.kill();
    process.exit(0);
  } catch (e) {
    console.error('❌ Server not ready:', e.message);
    console.error('Output:', output.slice(-500));
    child.kill();
    process.exit(1);
  }
}, 8000);

async function api(method, path, body = null, cookie = '') {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (cookie) opts.headers.Cookie = cookie;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`http://localhost:3000${path}`, opts);
  const setCookie = res.headers.get('set-cookie') || '';
  const data = await res.json().catch(() => null);
  return { status: res.status, data, setCookie };
}

function extractCookie(setCookie) {
  return setCookie.split(',').map(c => c.trim().split(';')[0]).join('; ');
}

let pass = 0, fail = 0;
function check(name, condition) {
  if (condition) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}

async function runTests() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  VELTRUVIA COMPREHENSIVE FEATURE TEST');
  console.log('═══════════════════════════════════════════════════\n');

  // ── AUTH ──
  console.log('📋 Authentication');
  let r = await api('POST', '/api/auth/login', { email: 'test@example.com', password: 'testdoc123' });
  check('Doctor login', r.data?.ok === true);
  const docCookie = extractCookie(r.setCookie);

  r = await api('POST', '/api/auth/login', { email: 'test@example.com', password: 'wrong' });
  check('Wrong password rejected', r.status === 401);

  r = await api('GET', '/api/admin/users', null, docCookie);
  check('Admin users list', r.data?.users?.length > 0);

  r = await api('POST', '/api/auth/logout', null, docCookie);
  check('Logout', r.data?.ok === true);

  r = await api('GET', '/api/admin/users', null, docCookie);
  check('Revoked session rejected', r.status === 401);

  // Re-login
  r = await api('POST', '/api/auth/login', { email: 'test@example.com', password: 'testdoc123' });
  const cookie = extractCookie(r.setCookie);

  r = await api('POST', '/api/sync/store-login', { mrn: '12345', password: 'testpat123' });
  check('Patient login', r.data?.ok === true);

  r = await api('POST', '/api/sync/lab-store-login', { username: 'testlab', password: 'testlab123' });
  check('Lab login', r.data?.ok === true);

  // ── CDS ──
  console.log('\n💊 Clinical Decision Support');
  r = await api('POST', '/api/cds/interactions', { medications: ['temozolomide', 'valproic acid'] }, cookie);
  check('Drug interactions (TMZ+VPA)', r.data?.interactions?.length > 0 && r.data.interactions[0].severity === 'severe');

  r = await api('POST', '/api/cds/dosage-check', { medication: 'temozolomide', dosage: '300 mg/m2', frequency: 'daily' }, cookie);
  check('Dosage overdose detection', r.data?.alerts?.length > 0);

  r = await api('POST', '/api/cds/allergies', { mrn: 'TEST001', drugName: 'penicillin', reaction: 'Rash', severity: 'moderate' }, cookie);
  check('Add allergy', r.data?.ok === true);

  r = await api('POST', '/api/cds/allergy-check', { patientMrn: 'TEST001', medications: ['amoxicillin'] }, cookie);
  check('Allergy cross-reactivity', r.data?.alerts?.length > 0);

  r = await api('GET', '/api/cds/drug-info/cisplatin', null, cookie);
  check('Drug info (new drug)', r.data?.info?.brand === 'Platinol');

  r = await api('GET', '/api/cds/drug-info/bevacizumab', null, cookie);
  check('Drug info (existing)', r.data?.info?.brand === 'Avastin');

  // ── CLINICAL FEATURES ──
  console.log('\n🏥 Clinical Features');
  r = await api('POST', '/api/features/notes', { patientMrn: 'TEST001', noteType: 'soap', subjective: 'Headache', objective: 'Normal', assessment: 'GBM', plan: 'Continue TMZ' }, cookie);
  check('Create note', r.data?.ok === true);

  r = await api('GET', '/api/features/notes/TEST001', null, cookie);
  check('List notes', r.data?.notes?.length > 0);

  r = await api('GET', '/api/features/protocols', null, cookie);
  check('Protocols (4 seeded)', r.data?.protocols?.length >= 4);

  r = await api('POST', '/api/features/outcomes', { patientMrn: 'TEST001', outcomeType: 'response', date: '2024-01-01', value: 'Partial' }, cookie);
  check('Create outcome (valid)', r.data?.ok === true);

  r = await api('POST', '/api/features/outcomes', { patientMrn: 'TEST001', outcomeType: 'INVALID', date: '2024-01-01', value: 'test' }, cookie);
  check('Invalid outcome rejected (400)', r.status === 400);

  r = await api('POST', '/api/features/adherence', { patientMrn: 'TEST001', medication: 'temozolomide', scheduledDate: '2024-01-15', status: 'taken' }, cookie);
  check('Create adherence', r.data?.ok === true);

  r = await api('POST', '/api/features/chemo', { patientMrn: 'TEST001', protocolName: 'Stupp Protocol', startDate: '2024-01-01', totalCycles: 6 }, cookie);
  check('Create chemo cycle', r.data?.ok === true);

  r = await api('POST', '/api/features/referrals', { patientMrn: 'TEST001', toSpecialty: 'Radiation Oncology', reason: 'RT planning' }, cookie);
  check('Create referral', r.data?.ok === true);

  r = await api('GET', '/api/features/audit/TEST001', null, cookie);
  check('Audit trail', r.data?.entries?.length > 0);

  r = await api('GET', '/api/features/export/TEST001', null, cookie);
  check('Patient data export', r.status === 200 && !r.data?.error);

  // ── TELEHEALTH ──
  console.log('\n📹 Telehealth');
  r = await api('POST', '/api/telehealth/rooms', { patientMrn: 'TEST001' }, cookie);
  check('Create room', r.data?.ok === true && r.data?.roomCode);
  const roomCode = r.data?.roomCode;

  r = await api('GET', '/api/telehealth/rooms', null, cookie);
  check('List rooms', r.data?.rooms?.length > 0);

  r = await api('POST', `/api/telehealth/rooms/${roomCode}/end`, null, cookie);
  check('End room', r.data?.ok === true);

  // ── BILLING ──
  console.log('\n💰 Billing');
  r = await api('POST', '/api/billing/invoices', { patientMrn: 'TEST001', items: [{ description: 'Office visit', unitPrice: 150, quantity: 1 }] }, cookie);
  check('Create invoice', r.data?.invoiceNumber && r.data?.total === 150);

  r = await api('GET', '/api/billing/invoices?patientMrn=TEST001', null, cookie);
  check('List invoices', Array.isArray(r.data) && r.data.length > 0);

  r = await api('GET', '/api/billing/stats', null, cookie);
  check('Billing stats', r.data?.totalRevenue !== undefined);

  r = await api('GET', '/api/billing/codes/icd10?q=brain', null, cookie);
  check('ICD-10 lookup', Array.isArray(r.data) && r.data.length > 0);

  r = await api('GET', '/api/billing/codes/cpt?q=mri', null, cookie);
  check('CPT lookup', Array.isArray(r.data) && r.data.length > 0);

  // ── HL7 ──
  console.log('\n🔬 HL7 Lab Interface');
  const hl7Msg = `MSH|^~\\&|LAB_SYSTEM|TEST_HOSP|VELTRUVIA|VELTRUVIA|20240115120000||ORU^R01|MSG001|P|2.5.1\rPID|1||MRN-99999^^^TEST_HOSP^MR||John Doe||19800101|M\rOBR|1||ORD001|CBC|||20240115|||||||20240115||||||||F\rOBX|1|NM|WBC^White Blood Cell||7.5|10*3/uL|4.0-11.0|||F|||20240115`;
  r = await api('POST', '/api/hl7/receive', { message: hl7Msg }, cookie);
  check('Receive HL7 ORU (lab result)', r.data?.ok === true && r.data?.resultsStored > 0);

  const adtMsg = `MSH|^~\\&|ADT_SYSTEM|TEST_HOSP|VELTRUVIA|VELTRUVIA|20240115120000||ADT^A01|MSG002|P|2.5.1\rPID|1||MRN-88888^^^TEST_HOSP^MR||Jane Smith||19900515|F`;
  r = await api('POST', '/api/hl7/receive', { message: adtMsg }, cookie);
  check('Receive HL7 ADT (patient)', r.data?.ok === true);

  r = await api('GET', '/api/hl7/patient/MRN-99999', null, cookie);
  check('Generate HL7 patient', r.status === 200);

  // ── FHIR ──
  console.log('\n🔗 FHIR Endpoints');
  r = await api('GET', '/api/fhir/Patient/12345', null, cookie);
  check('FHIR Patient', r.data?.resourceType === 'Patient');

  r = await api('GET', '/api/fhir/Condition/12345', null, cookie);
  check('FHIR Condition', r.data?.resourceType === 'Bundle');

  r = await api('GET', '/api/fhir/Bundle/12345', null, cookie);
  check('FHIR Bundle', r.data?.resourceType === 'Bundle' && r.data?.entry?.length > 0);

  // ── HIPAA ──
  console.log('\n🔒 HIPAA');
  r = await api('GET', '/api/hipaa/retention', null, cookie);
  check('Retention policies', Array.isArray(r.data));

  // ── REPORTS ──
  console.log('\n📊 Reports');
  r = await api('GET', '/api/reports/panel-health', null, cookie);
  check('Panel health', r.data?.totalPatients !== undefined);

  r = await api('GET', '/api/reports/financial', null, cookie);
  check('Financial report', r.data?.totalRevenue !== undefined);

  r = await api('GET', '/api/reports/operational', null, cookie);
  check('Operational report', r.data?.totalNotes !== undefined);

  r = await api('GET', '/api/reports/quality', null, cookie);
  check('Quality report', r.data?.measures?.length > 0);

  r = await api('GET', '/api/reports/cancer-registry', null, cookie);
  check('Cancer registry', r.data?.totalPatients !== undefined);

  // ── SECURITY ──
  console.log('\n🛡️ Security');
  r = await api('GET', '/api/nonexistent');
  check('404 for unknown API routes', r.status === 404);

  r = await api('GET', '/health?deep=1');
  check('Deep health check', r.data?.ok === true && r.data?.db === true);

  r = await api('GET', '/api/health');
  check('API health check', r.data?.ok === true);

  // ── FRONTEND ──
  console.log('\n🖥️ Frontend');
  r = await api('GET', '/');
  check('index.html loads', r.status === 200);

  r = await api('GET', '/patient.html');
  check('patient.html loads', r.status === 200);

  r = await api('GET', '/lab.html');
  check('lab.html loads', r.status === 200);

  r = await api('GET', '/admin.html');
  check('admin.html loads', r.status === 200);

  // ── SUMMARY ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  RESULTS: ${pass} passed, ${fail} failed, ${pass + fail} total`);
  console.log('═══════════════════════════════════════════════════');
  if (fail > 0) process.exit(1);
}
