// ═══════════════════════════════════════════════════════════════════════
// Auto-update wiring for the VELTRUVIA exes (electron-updater).
//
// Reads the "publish" block from the electron-builder config: GitHub
// Releases of this repo. Behavior:
//   • Dev runs: no-op.
//   • Packaged: check every 6 h and at boot (+15 s). Updates download in
//     the background and install on next app quit — no user interruption.
//   • Until the first GitHub Release is published, checks fail silently —
//     that is expected and harmless.
// ═══════════════════════════════════════════════════════════════════════
import electron from 'electron';
import electronUpdaterPkg from 'electron-updater';
const { autoUpdater } = electronUpdaterPkg;

const log = (msg) => console.log('[updater]', msg);

export function setupAutoUpdate({ intervalMs = 6 * 60 * 60 * 1000, silent = true, channel = null } = {}) {
  const app = electron.app;
  if (!app || !app.isPackaged) { log('skipped (not packaged)'); return null; }

  autoUpdater.logger = { info: log, warn: log, error: (m) => console.error('[updater]', m) };
  // Per-app update feed: without this, every exe would read the Server's
  // latest.yml and e.g. the Doctor app would "update" itself into the
  // Server installer. channel 'latest-doctor' → fetches latest-doctor.yml.
  if (channel) autoUpdater.channel = channel;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let timer = null;
  const check = async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      // No published release yet (or offline) — silent unless debugging.
      if (!silent) console.warn('[updater] check failed:', e.message);
    }
  };

  app.whenReady().then(() => {
    setTimeout(check, 15_000);
    timer = setInterval(check, intervalMs);
    autoUpdater.on('update-downloaded', () => {
      log('update downloaded — will install on quit');
    });
  }).catch(() => {});

  return { check };
}
