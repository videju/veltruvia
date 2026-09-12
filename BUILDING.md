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

## Release checklist

- [ ] `npm run check` green (no drift, no await bugs, icons valid)
- [ ] `npm run verify` green (53/53 × 4 apps)
- [ ] Version bumped in all four `resources/app/package.json`
- [ ] No `.exe.new`, `test*.db`, `.demo-admin-password`, or logs in release folders
- [ ] `HOST` unset (or `127.0.0.1`), `VELTRUVIA_DEMO` unset
- [ ] Installer/exe code-signed (if distributing beyond this machine)
