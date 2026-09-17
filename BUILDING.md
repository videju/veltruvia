# Building & Releasing

## How the exes relate to the source

Each `VELTRUVIA <App>/` folder is a **packaged Electron build** of the shared
backend (`VELTRUVIA Server/resources/app/`), built with electron-builder using
the configs in `src/electron/electron-builder-<app>.json`. The builder injects
each app's entry via `extraMetadata.main`:

- `electron-builder-server.json` → `main-server.js`
- `electron-builder-doctor.json` → `main-doctor.js`
- `electron-builder-patient.json` → `main-patient.js`
- `electron-builder-lab.json` → `main-lab.js`

## Editing code

1. Edit **only** `VELTRUVIA Server/resources/app/` (canonical source).
2. Run `npm run sync-bundles` to propagate to the three client bundles
   (each client keeps its own `package.json` main entry automatically).
3. Run `npm run check` (fast gate) and `npm run verify` (full 53-check × 4 apps).

## Rebuilding the executables

From `VELTRUVIA Server/resources/app/`:

```bash
npm ci
npx electron-builder --config electron/electron-builder-server.json
npx electron-builder --config electron/electron-builder-doctor.json
npx electron-builder --config electron/electron-builder-patient.json
npx electron-builder --config electron/electron-builder-lab.json
```

Output lands in `dist-desktop/` per bundle (dir target, x64, unsigned).
After rebuilding, copy the new exe + runtime files into each top-level
`VELTRUVIA <App>/` folder and delete any stale `*.exe.new` artifacts.

## Build size & signing

The builder configs exclude dev-only trees (`test/`, `docs/`, `*.md`, `*.map`,
`*.d.ts`, typings and tooling files) from `node_modules` inside the asar, and
set `compression: maximum`. Native modules (`*.node`) are unpacked.

To sign the exes (Windows):

```bash
# PowerShell (from VELTRUVIA Server/resources/app/)
$env:CSC_LINK="C:\path\to\cert.pfx"      # or certificateSubjectName via signtool
$env:CSC_KEY_PASSWORD="<pfx password>"
npx electron-builder --config electron/electron-builder-server.json
```

electron-builder picks up `CSC_LINK`/`CSC_KEY_PASSWORD` automatically; no
secrets live in the repo. Verify with `Get-AuthenticodeSignature .\VELTRUVIA.exe`.

## Building the mobile APKs (Patient & Lab)

The Android apps wrap the shared web UI. One-time setup (per machine):
JDK 21 (Capacitor 7 requires it — JDK 17 fails with "invalid source release: 21")
+ Android Studio or just the cmdline-tools, then `cd mobile/patient && npm install
&& npx cap add android` (and the same in `mobile/lab`). See `mobile/README.md`.

From the repo root:

```bash
npm run apk:patient                                    # debug APK (points at 10.0.2.2:3000 emulator loopback)
VELTRUVIA_API_BASE=https://emr.yourclinic.com npm run apk:lab   # bake the cloud server in
npm run apk:patient -- --release                       # release APK (must be signed)
```

Output: `mobile/<app>/android/app/build/outputs/apk/<debug|release>/`.
The server address is baked at build time but changeable in-app (⚙ button).

### Signing the APKs (release)

```bash
keytool -genkeypair -v -keystore veltruvia-release.keystore -alias veltruvia \
  -keyalg RSA -keysize 2048 -validity 10000
```

Wire the keystore into each app's `android/app/build.gradle` `signingConfigs.release`
and build with `VELTRUVIA_KEYSTORE_PASSWORD=…` (full snippet in `mobile/README.md`).
Upload the signed `VELTRUVIA Patient.apk` and `VELTRUVIA Lab.apk` to the same
GitHub Releases the exes use — the download page links there.

## Deploying a fresh build to the top-level app folders

The top-level `VELTRUVIA <App>/` folders are **dev-checkout layouts**: the exe
loads `resources/app/` (the canonical, gate-enforced source tree) directly.
An asar-built exe is for **standalone installs only**. When refreshing the
top-level folders:

1. Copy everything from `dist-desktop/win-unpacked/` **except `resources/`**
   (exe, DLLs, paks, `locales/`).
2. Delete the destination `locales/` first — `Copy-Item` merges directories,
   so old locale packs would otherwise survive (locale pruning = ~40 MB).
3. Never delete/rename `resources/app/` in any bundle: check.mjs,
   sync-bundles.mjs, the tests, and the exe itself all depend on it.
4. Launch, then probe `http://127.0.0.1:3000/health` (or the fallback port
   printed in the server window) to confirm the build works.

## Release checklist

- [ ] `npm run check` green (no drift, no await bugs, icons valid)
- [ ] `npm run verify` green (53/53 × 4 apps)
- [ ] Version bumped in all four `resources/app/package.json`
- [ ] No `.exe.new`, `test*.db`, `.demo-admin-password`, or logs in release folders
- [ ] `HOST` unset (or `127.0.0.1`), `VELTRUVIA_DEMO` unset
- [ ] Installer/exe code-signed (if distributing beyond this machine)
- [ ] Server & Doctor exes deployed to the top-level `VELTRUVIA <App>/` folders
      from `dist-desktop/win-unpacked/` (delete destination `locales/` first;
      copy everything **except** `resources/` — see "Deploying a fresh build")
- [ ] Mobile APKs built + signed into `dist/`: `VELTRUVIA Patient.apk`,
      `VELTRUVIA Lab.apk` (toolchain + commands in `mobile/README.md`; on this
      machine JDK 21 + Android SDK already live in `C:\Users\Sara\veltruvia-build-tools\`)
- [ ] APKs + exes uploaded to GitHub Releases (download-page links point there)
