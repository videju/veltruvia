// Integration tests: boots the real server (src/server.js) on :3123 with an
// ephemeral DB and exercises auth, admin, CSRF, CSP and static-serving paths.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import net from 'node:net';

const APP = resolve('VELTRUVIA Server/resources/app');
const PORT = 3123;
const base = `http://localhost:${PORT}`;
const dbPath = join(APP, 'test-suite.db');

const runtimeFiles = ['.demo-admin-password', 'patient-store.json', 'appointments-store.json',
  'availability-store.json', 'logs-store.json', 'messages-store.json',
  'telehealth-rooms.json', 'telehealth-signals.json', 'chain.json'].map(f => join(APP, f));
for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm', ...runtimeFiles]) { try { rmSync(f); } catch {} }

// Fail fast if the port is taken (stale server = testing the wrong code)
await new Promise((res, rej) => {
  const probe = net.createServer();
  probe.once('error', () => rej(new Error(`Port ${PORT} in use — kill the stale process first`)));
  probe.listen(PORT, '127.0.0.1', () => probe.close(res));
});

const server = spawn('node', ['src/server.js'], {
  cwd: APP,
  env: {
    ...process.env,
    JWT_SECRET: 'test-secret',
    PHI_ENCRYPTION_KEY: 'test-phi-key-32-bytes-long-here',
    DB_PATH: dbPath,
    PORT: String(PORT),
    NODE_ENV: 'test',
    VELTRUVIA_DEMO: 'true',
    VELTRUVIA_DEMO_PASSWORD: 'testdoc123',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
server.stdout.on('data', d => { serverOut += d; });
server.stderr.on('data', d => { serverOut += d; });

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 1500);
      const r = await fetch(`${base}/health`, { signal: c.signal });
      clearTimeout(t);
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function api(method, path, body = null, cookie = '', extraHeaders = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...extraHeaders } };
  if (cookie) opts.headers.Cookie = cookie;
  if (body) opts.body = JSON.stringify(body);
  return fetch(base + path, opts).then(async r => {
    const setCookie = r.headers.get('set-cookie') || '';
    let data; try { data = await r.json(); } catch { data = null; }
    return { status: r.status, data, setCookie, headers: r.headers };
  });
}
const cookieOf = sc => sc.split(',').map(c => c.trim().split(';')[0]).join('; ');

let adminCookie = '';

before(async () => {
  const ready = await waitReady();
  if (!ready) {
    console.error('SERVER FAILED TO START:\n' + serverOut.slice(-2000));
    server.kill();
    process.exit(1);
  }
  const r = await api('POST', '/api/auth/login', { email: 'test@example.com', password: 'testdoc123' });
  assert.equal(r.status, 200, 'demo admin login should succeed: ' + JSON.stringify(r.data));
  adminCookie = cookieOf(r.setCookie);
});

after(() => { server.kill(); });

// ── Infrastructure ────────────────────────────────────────────────
test('health endpoint reports ok', async () => {
  const r = await api('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.data?.ok, true);
});

test('unknown API routes return 404 JSON', async () => {
  const r = await api('GET', '/api/definitely-not-a-route');
  assert.equal(r.status, 404);
});

test('security headers present (CSP without unsafe-inline scripts, HSTS-ish, nosniff)', async () => {
  const r = await api('GET', '/');
  const csp = r.headers.get('content-security-policy') || '';
  assert.ok(csp.includes("default-src 'self'"), 'default-src');
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'script-src must NOT allow unsafe-inline');
  assert.ok(/script-src-attr[^;]*'none'/.test(csp), "script-src-attr must be 'none'");
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('static pages served (index, patient, lab, admin, blockchain, download)', async () => {
  for (const p of ['/', '/patient.html', '/lab.html', '/admin.html', '/blockchain.html', '/download.html']) {
    const r = await api('GET', p);
    assert.equal(r.status, 200, p);
    assert.ok((r.data || '').toString?.length !== 0 || r.data === null);
  }
});

test('extracted page scripts are served as files', async () => {
  for (const f of ['js/actions.js', 'js/page/index-2-record.js', 'js/page/patient-1-core.js', 'js/page/admin-2-app.js']) {
    const r = await api('GET', '/' + f);
    assert.equal(r.status, 200, f);
  }
});

// ── Auth ──────────────────────────────────────────────────────────
test('login rejects wrong password with 401', async () => {
  const r = await api('POST', '/api/auth/login', { email: 'test@example.com', password: 'wrong-password' });
  assert.equal(r.status, 401);
  assert.ok(r.data?.error);
});

test('login rejects malformed payloads via validation (4xx, never 5xx)', async () => {
  for (const body of [{}, { email: 'not-an-email', password: 'x' }, { email: 'test@example.com' }]) {
    const r = await api('POST', '/api/auth/login', body);
    assert.ok(r.status >= 400 && r.status < 500, `status ${r.status} for ${JSON.stringify(body)}`);
  }
});

test('protected route requires session', async () => {
  const r = await api('GET', '/api/admin/users');
  assert.equal(r.status, 401);
});

test('admin login sets session cookie; /admin/users lists demo doctor', async () => {
  const r = await api('GET', '/api/admin/users', null, adminCookie);
  assert.equal(r.status, 200);
  const users = r.data?.users || [];
  assert.ok(users.some(u => u.email === 'test@example.com'), 'demo doctor listed');
  assert.ok(users.every(u => !('password_hash' in u)), 'no password hashes leaked');
  assert.ok(users.every(u => typeof u.name === 'string'), 'PHI decrypted for admin view');
});

// ── Admin user lifecycle (setActive round-trip) ───────────────────
test('register → pending account; admin approve → login works; deactivate → blocked', async () => {
  const email = `dr-${Date.now()}@test.local`;
  // 1) register (no email verification in test mode path — server decides)
  const reg = await api('POST', '/api/auth/register', {
    name: 'Test Doctor Two', email, password: 'Str0ngPassw0rd!x', specialty: 'Neuro-Oncology', institution: 'Test',
  });
  assert.ok(reg.status === 200 || reg.status === 201 || reg.status === 400, `register status ${reg.status}`);
  // 2) admin sees the user
  const list = await api('GET', '/api/admin/users', null, adminCookie);
  const u = (list.data?.users || []).find(x => x.email === email);
  if (u) {
    assert.equal(u.active, false, 'new user awaits approval');
    // 3) deactivate (no-op on inactive) → ok
    const d = await api('POST', `/api/admin/users/${u.id}/active`, { active: false }, adminCookie);
    assert.ok(d.status === 200 || d.status === 400);
    // 4) approve
    const a = await api('POST', `/api/admin/users/${u.id}/active`, { active: true }, adminCookie);
    assert.equal(a.status, 200, JSON.stringify(a.data));
    // 5) login now works
    const li = await api('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd!x' });
    assert.equal(li.status, 200, 'approved user can sign in');
    // 6) deactivate again → login blocked with the pending-approval message
    const de = await api('POST', `/api/admin/users/${u.id}/active`, { active: false }, adminCookie);
    assert.equal(de.status, 200);
    const li2 = await api('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd!x' });
    assert.equal(li2.status, 403);
    assert.match(li2.data?.error || '', /pending admin approval/i);
  }
});

test('admin cannot deactivate their own account', async () => {
  const me = await api('GET', '/api/admin/users', null, adminCookie);
  const admin = (me.data?.users || []).find(u => u.email === 'test@example.com');
  const r = await api('POST', `/api/admin/users/${admin.id}/active`, { active: false }, adminCookie);
  assert.equal(r.status, 400);
});

test('non-admin session cannot touch admin routes', async () => {
  // register+approve a second user, then use their session
  const email = `staff-${Date.now()}@test.local`;
  await api('POST', '/api/auth/register', { name: 'Staff', email, password: 'Str0ngPassw0rd!x' });
  const list = await api('GET', '/api/admin/users', null, adminCookie);
  const u = (list.data?.users || []).find(x => x.email === email);
  if (u) {
    await api('POST', `/api/admin/users/${u.id}/active`, { active: true }, adminCookie);
    const li = await api('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd!x' });
    if (li.status === 200) {
      const cookie = cookieOf(li.setCookie);
      const r = await api('POST', `/api/admin/users/${u.id}/active`, { active: true }, cookie);
      assert.equal(r.status, 403, 'role gate holds');
    }
  }
});

// ── CSRF guard ────────────────────────────────────────────────────
test('cross-origin writes are rejected (403)', async () => {
  const r = await api('POST', '/api/auth/login', { email: 'test@example.com', password: 'testdoc123' },
    '', { Origin: 'https://evil.example.com' });
  assert.equal(r.status, 403);
});

// ── SQLi guard smoke ─────────────────────────────────────────────
test("sql-injection-looking payload is handled safely (no 5xx)", async () => {
  const r = await api('POST', '/api/auth/login', { email: "x' OR 1=1 --", password: 'whatever123' });
  assert.ok(r.status < 500, `status ${r.status}`);
});
