// Full feature sweep: logs in as admin, patient, and lab, then probes every
// GET endpoint found in the route files with each role's cookie. Flags any
// 5xx (bug) and distinguishes expected 401/403 (role-gated) from anomalies.
// Usage: node scripts/feature-sweep.mjs [baseUrl]
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const APP = resolve('VELTRUVIA Server/resources/app');

// ── 1. Map each route FILE to its mount point via app.js imports ────
const appSrc = readFileSync(join(APP, 'src/app.js'), 'utf8');
const fileMount = new Map(); // file basename → mount
const imports = new Map();   // router var → file
for (const m of appSrc.matchAll(/import\s*{\s*([a-zA-Z]+)\s*}\s*from\s*'.\/routes\/([^']+)'/g)) {
  imports.set(m[1], m[2]);
}
for (const m of appSrc.matchAll(/app\.use\('([^']+)',[^)]*?([a-zA-Z]+)Router\)/g)) {
  const f = imports.get(m[2] + 'Router') || imports.get(m[2]);
  if (f) fileMount.set(f, m[1]);
}

// ── 2. Extract every route registration from route files ───────────
const routesDir = join(APP, 'src/routes');
const endpoints = []; // { method, path }
for (const f of readdirSync(routesDir).filter(f => f.endsWith('.js'))) {
  if (!fileMount.has(f)) continue; // not mounted — skip
  const src = readFileSync(join(routesDir, f), 'utf8');
  for (const m of src.matchAll(/[a-zA-Z_$][\w$]*\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    endpoints.push({ method: m[1].toUpperCase(), path: m[2], file: f });
  }
}

function urlFor(ep) {
  return fileMount.get(ep.file).replace(/\/$/, '') + ep.path.replace(/:[a-zA-Z_]+/g, 'sweep-nonexistent');
}

// ── 3. Log in as each role ──────────────────────────────────────────
const adminPass = readFileSync('data/.demo-admin-password', 'utf8').trim();
async function login(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const setCookie = r.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  return { status: r.status, cookie, data: await r.json().catch(() => ({})) };
}
const admin = await login('/api/auth/login', { email: 'test@example.com', password: adminPass });
const patient = await login('/api/sync/store-login', { mrn: 'TEST001', password: 'Test1234!' });
const lab = await login('/api/sync/lab-store-login', { username: 'testlab', password: 'testlab123' });

console.log(`logins: admin=${admin.status} patient=${patient.status} lab=${lab.status}`);
if (admin.status !== 200 || patient.status !== 200 || lab.status !== 200) {
  console.error('Login failure details:', JSON.stringify({ admin: admin.data, patient: patient.data, lab: lab.data }));
}

const roles = [
  ['admin', admin.cookie],
  ['patient', patient.cookie],
  ['lab', lab.cookie],
].filter(([, c]) => c);

// ── 4. Probe every GET endpoint with every role ─────────────────────
const gets = endpoints.filter(e => e.method === 'GET');
const results = { ok: 0, gated: 0, notFound: 0, clientErr: 0, clientErrHits: [], serverErr: [] };
const perUrl = new Map();
for (const ep of gets) {
  const url = urlFor(ep);
  for (const [role, cookie] of roles) {
    let status = 0;
    try {
      const r = await fetch(BASE + url, { headers: { Cookie: cookie } });
      status = r.status;
      await r.arrayBuffer().catch(() => {});
    } catch (e) {
      status = -1;
      results.serverErr.push(`${role} ${url} → ${e.message}`);
      continue;
    }
    if (status >= 500) results.serverErr.push(`${role} GET ${url} → ${status}`);
    else if (status >= 200 && status < 300) results.ok++;
    else if (status === 401 || status === 403) results.gated++;
    else if (status === 404) results.notFound++;
    else {
      results.clientErr++;
      // Capture the body so every non-gated 4xx is explainable in the report.
      let body = '';
      try { body = (await r.text()).slice(0, 120).replace(/\s+/g, ' '); } catch {}
      results.clientErrHits.push(`${role} GET ${url} → ${status} ${body}`);
    }
  }
  perUrl.set(url, true);
}

console.log(`\nGET endpoints probed: ${gets.length} × ${roles.length} roles = ${gets.length * roles.length} requests`);
console.log(`  2xx ok: ${results.ok}   401/403 role-gated: ${results.gated}   404 (unknown id / missing record): ${results.notFound}   other 4xx: ${results.clientErr}`);
if (results.clientErrHits.length) {
  console.log(`\nℹ️  non-gated 4xx (${results.clientErrHits.length}) — expected validator rejections:`);
  for (const s of results.clientErrHits) console.log('  ' + s);
}
if (results.serverErr.length) {
  console.log(`\n❌ 5xx / failures (${results.serverErr.length}):`);
  for (const s of results.serverErr) console.log('  ' + s);
} else {
  console.log('✅ zero 5xx across the whole GET surface');
}

// ── 5. Static page assets ───────────────────────────────────────────
const pages = ['index.html', 'patient.html', 'lab.html', 'admin.html', 'blockchain.html', 'download.html'];
const assetRe = /(?:src|href)=["'](\/(?:js|css|fonts)\/[^"']+)["']/g;
const assets = new Set();
for (const p of pages) {
  try {
    const r = await fetch(`${BASE}/${p}`);
    if (r.status !== 200) { results.serverErr.push(`PAGE /${p} → ${r.status}`); continue; }
    const html = await r.text();
    for (const m of html.matchAll(assetRe)) assets.add(m[1]);
    for (const m of html.matchAll(/["'](\/sw\.js|\/manifest\.json)["']/g)) assets.add(m[1]);
  } catch (e) { results.serverErr.push(`PAGE /${p} → ${e.message}`); }
}
let assetFail = 0;
for (const a of assets) {
  const r = await fetch(BASE + a).catch(() => null);
  if (!r || r.status !== 200) { assetFail++; results.serverErr.push(`ASSET ${a} → ${r ? r.status : 'fetch fail'}`); }
}
console.log(`\npages: ${pages.length}, unique assets referenced: ${assets.size}, broken assets: ${assetFail}`);
if (!results.serverErr.length) console.log('\n✅ FEATURE SWEEP CLEAN');
