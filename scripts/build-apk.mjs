// ═════════════════════════════════════════════════════════════════════
// VELTRUVIA mobile APK build helper
//
//   npm run apk:patient            # Patient app
//   npm run apk:lab                # Lab app
//   VELTRUVIA_API_BASE=https://emr.yourclinic.com npm run apk:patient
//   npm run apk:patient -- --release
//
// Steps:
//   1. Copy the shared web UI (public/) into mobile/<app>/www
//   2. Bake the server URL into window.__VELTRUVIA_API_BASE__
//   3. If an android/ project exists → cap sync + gradle assemble
//      If not → print the one-time setup commands (needs Android Studio).
// ═════════════════════════════════════════════════════════════════════
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = process.argv[2];
const release = process.argv.includes('--release');

if (app !== 'patient' && app !== 'lab') {
  console.error('Usage: node scripts/build-apk.mjs <patient|lab> [--release]');
  process.exit(1);
}

const apiBase = (process.env.VELTRUVIA_API_BASE || 'http://10.0.2.2:3000').replace(/\/+$/, '');
const publicDir = join(root, 'VELTRUVIA Server', 'resources', 'app', 'public');
const mobileDir = join(root, 'mobile', app);
const wwwDir = join(mobileDir, 'www');
const androidDir = join(mobileDir, 'android');

console.log(`\n📱 Building VELTRUVIA ${app[0].toUpperCase() + app.slice(1)} APK`);
console.log(`   Server baked in: ${apiBase}\n`);

// ── 1. Web assets ───────────────────────────────────────────────────
rmSync(wwwDir, { recursive: true, force: true });
mkdirSync(wwwDir, { recursive: true });
cpSync(publicDir, wwwDir, { recursive: true });
// Never ship the /downloads/ file-share folder (hosted installers) inside an APK.
rmSync(join(wwwDir, 'downloads'), { recursive: true, force: true });

// Keep the APK lean: desktop-only pages and the doctor portal aren't used on phones.
for (const name of ['index.html', 'admin.html', 'blockchain.html', 'download.html',
  'index.html.bak', 'lab.html.bak']) {
  rmSync(join(wwwDir, name), { force: true });
}
for (const name of ['page/index-1-helpers.js', 'page/index-2-record.js', 'page/index-3-reports.js',
  'page/index-4-standalone.js', 'page/admin-1-boot.js', 'page/admin-2-app.js',
  'page/blockchain-1-app.js']) {
  rmSync(join(wwwDir, 'js', name), { force: true });
}

// ── 2. Bake the API base ────────────────────────────────────────────
const marker = "window.__VELTRUVIA_API_BASE__='';";
const entry = app === 'patient' ? 'patient.html' : 'lab.html';
const entryPath = join(wwwDir, entry);
if (!existsSync(entryPath)) {
  console.error(`   ❌ ${entry} missing from public/ — sync-bundles first.`);
  process.exit(1);
}
let html = readFileSync(entryPath, 'utf8');
if (!html.includes(marker)) {
  console.error(`   ❌ API-base marker not found in ${entry} — expected: ${marker}`);
  process.exit(1);
}
html = html.replace(marker, `window.__VELTRUVIA_API_BASE__='${apiBase}';`);
writeFileSync(entryPath, html);

// Capacitor requires www/index.html as the web entry — redirect to the portal.
writeFileSync(join(wwwDir, 'index.html'),
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VELTRUVIA</title>` +
  `<script>location.replace('${entry}');</script>` +
  `<meta http-equiv="refresh" content="0;url=${entry}"></head>` +
  `<body style="background:#080d1a;color:#e2e8f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">Opening VELTRUVIA…</body></html>`);
console.log(`   ✅ www/ prepared (${entry} → ${apiBase})`);

// ── 3. Android project ──────────────────────────────────────────────
if (!existsSync(androidDir)) {
  console.log(`    ⚠️  No android/ project yet — one-time setup (needs JDK 21 + Android SDK):

       cd "${mobileDir}"
       npm install
       npx cap add android
       npm run apk:debug        # or this script again

   The www/ payload above is ready; cap add simply wraps it.`);
  process.exit(0);
}

console.log('   ⟳ cap sync android…');
const cap = spawnSync('npx', ['cap', 'sync', 'android'], { cwd: mobileDir, stdio: 'inherit', shell: true });
if (cap.status !== 0) {
  console.error('   ❌ cap sync failed');
  process.exit(cap.status ?? 1);
}

const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const task = release ? 'assembleRelease' : 'assembleDebug';
console.log(`   ⟳ gradle ${task}…`);
const build = spawnSync(join(androidDir, gradle), [task], { cwd: androidDir, stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) {
  console.error('   ❌ gradle build failed');
  process.exit(build.status ?? 1);
}

const out = join(androidDir, 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug');
console.log(`\n✅ APK ready: ${out}`);
console.log('   Install on a phone:  adb install -r <file.apk>   (or copy the file and tap it)');
if (release) {
  console.log('   Release APKs must be signed — see BUILDING.md → "Signing the APKs".');
}
