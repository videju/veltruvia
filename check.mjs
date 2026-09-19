// VELTRUVIA code-quality gate — run: node check.mjs
// 1. Syntax-parses every JS file in every bundle (src/ + electron/)
// 2. Static await-audit: flags db.prepare( calls missing `await`
// 3. Bundle-drift check: src/, electron/, public/ must be identical across all 4 apps
// 4. Icon sanity: dimensions must match filenames (192/512), maskable variants exist
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

// vm.SourceTextModule (ESM syntax parsing) needs --experimental-vm-modules;
// re-exec self with the flag if it was not passed.
if (typeof vm.SourceTextModule !== 'function') {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const APPS = ['VELTRUVIA Server', 'VELTRUVIA Doctor', 'VELTRUVIA Patient', 'VELTRUVIA Lab'];
let problems = 0;
const fail = msg => { problems++; console.log('  ❌ ' + msg); };
const ok = msg => console.log('  ✅ ' + msg);

// ── 1. Syntax parse ──────────────────────────────────────────────
console.log('\n🔍 Syntax check (src/ + electron/ per bundle)');
for (const app of APPS) {
  let parsed = 0, bad = 0;
  for (const sub of ['src', 'electron']) {
    const walk = dir => {
      let entries = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = dir + '/' + e.name;
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js')) {
          parsed++;
          try { new vm.SourceTextModule(readFileSync(p, 'utf8')); }
          catch (err) { bad++; fail(`${app}/${sub}: ${e.name} → ${err.message.split('\n')[0]}`); }
        }
      }
    };
    walk(`${app}/resources/app/${sub}`);
  }
  if (bad === 0) ok(`${app}: ${parsed} JS files parse cleanly`);
}

// ── 2. Static await audit ────────────────────────────────────────
console.log('\n🔍 Await audit (db.prepare usage)');
for (const app of APPS) {
  const routesDir = `${app}/resources/app/src/routes`;
  let files = [];
  try { files = readdirSync(routesDir).filter(f => f.endsWith('.js')); } catch { continue; }
  let unawaited = 0, promiseProp = 0;
  for (const f of files) {
    const src = readFileSync(`${routesDir}/${f}`, 'utf8');
    const re = /db\.prepare\(/g; let m;
    while ((m = re.exec(src))) {
      if (src.slice(Math.max(0, m.index - 6), m.index) !== 'await ') {
        // Fire-and-forget chains (.then/.catch) are acceptable without await
        const stmtEnd = src.indexOf(';', m.index);
        const stmt = src.slice(m.index, stmtEnd === -1 ? m.index + 300 : stmtEnd);
        if (!/\.then\s*\(/.test(stmt)) unawaited++;
      }
    }
    // BAD:  await db.prepare(SQL).get(args).prop   (prop read off a Promise)
    // GOOD: (await db.prepare(SQL).get(args)).prop — the '(' before 'await' saves it
    const reBad = /(\(\s*)?(await)\s+db\.prepare\([^;\n]*?\)\.(get|all)\([^;\n]*?\)\.[A-Za-z_$][\w$]*/g;
    for (const mm of src.matchAll(reBad)) {
      if (!mm[1]) promiseProp++;   // no opening paren before await → bug
    }
  }
  if (unawaited === 0 && promiseProp === 0) ok(`${app}: all db calls properly awaited`);
  else fail(`${app}: ${unawaited} un-awaited db.prepare, ${promiseProp} promise-property bugs`);
}

// ── 3. Bundle drift ──────────────────────────────────────────────
console.log('\n🔍 Bundle drift (src/, electron/, public/ identical across apps)');
import { createHash } from 'node:crypto';
function hashTree(dir) {
  const h = createHash('sha256');
  const walk = d => {
    // public/downloads is a machine-local offline mirror of release binaries
    // (never synced to clients, never packaged) — it must not count as drift.
    if (d.endsWith('/public/downloads')) return;
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const e of entries) {
      const p = d + '/' + e.name;
      if (e.isDirectory()) walk(p);
      else {
        try { h.update(e.name + '\0' + readFileSync(p)); } catch {}
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}
const trees = ['src', 'electron', 'public'];
for (const t of trees) {
  const hashes = APPS.map(a => hashTree(`${a}/resources/app/${t}`));
  const unique = new Set(hashes);
  if (unique.size === 1) ok(`${t}/ identical across all 4 apps`);
  else fail(`${t}/ drifted: ${unique.size} distinct versions (${APPS.map((a, i) => a.split(' ')[1] + '=' + hashes[i].slice(0, 8)).join(', ')})`);
}

// ── 3b. No nested junk trees (old botched copies inside bundles) ──
console.log('\n🔍 Nested junk trees (resources/app/VELTRUVIA*/ must not exist)');
for (const app of APPS) {
  const junk = APPS.filter(n => existsSync(`${app}/resources/app/${n}`));
  if (junk.length === 0) ok(`${app}: clean`);
  else fail(`${app}: contains nested copy of itself — delete resources/app/${junk[0]}/`);
}

// ── 3c. Public page scripts parse (inline <script> blocks + js/*.js) ──
console.log('\n🔍 Page scripts (public/ inline blocks + js/ modules parse)');
for (const app of APPS) {
  const pubDir = `${app}/resources/app/public`;
  let blocks = 0, bad = 0;
  const parse = (code, label) => {
    blocks++;
    try { new vm.SourceTextModule(code); }
    catch (err) { bad++; fail(`${app}: ${label} → ${err.message.split('\n')[0]}`); }
  };
  let entries = [];
  try { entries = readdirSync(pubDir); } catch {}
  for (const e of entries) {
    if (e.endsWith('.html')) {
      const html = readFileSync(`${pubDir}/${e}`, 'utf8');
      const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
      let m, n = 0;
      while ((m = re.exec(html))) parse(m[1], `${e} block #${++n}`);
    } else if (e.endsWith('.js')) {
      parse(readFileSync(`${pubDir}/${e}`, 'utf8'), e);
    }
  }
  const jsDir = `${pubDir}/js`;
  try { for (const e of readdirSync(jsDir)) if (e.endsWith('.js')) parse(readFileSync(`${jsDir}/${e}`, 'utf8'), `js/${e}`); } catch {}
  if (bad === 0) ok(`${app}: ${blocks} page script block(s) parse cleanly`);
}

// ── 4. Icon sanity ───────────────────────────────────────────────
console.log('\n🔍 Icons (dimensions match filename, maskable variants present)');
for (const app of APPS) {
  const dir = `${app}/resources/app/public/icons`;
  let files = [];
  try { files = readdirSync(dir).filter(f => f.endsWith('.png')); } catch { continue; }
  let bad = 0;
  for (const f of files) {
    try {
      const b = readFileSync(`${dir}/${f}`);
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
      const expect = f.includes('192') ? 192 : 512;
      if (w !== expect || h !== expect) { bad++; fail(`${app}: ${f} is ${w}x${h}, expected ${expect}x${expect}`); }
      if (b.length > 600_000) { bad++; fail(`${app}: ${f} is ${(b.length / 1024 / 1024).toFixed(1)}MB — should be < 600KB`); }
    } catch { bad++; fail(`${app}: ${f} unreadable`); }
  }
  const roles = new Set(files.map(f => f.split('-')[0]));
  for (const r of roles) {
    if (!files.includes(`${r}-maskable-512.png`)) { bad++; fail(`${app}: missing ${r}-maskable-512.png`); }
  }
  if (bad === 0) ok(`${app}: all icons correct`);
}

console.log('\n' + (problems === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${problems} problem(s) found`));
process.exit(problems === 0 ? 0 : 1);
