/**
 * Shared Configuration for VELTRUVIA Desktop Apps
 *
 * Uses a shared directory next to the app folders so all apps
 * (Server, Doctor, Patient, Lab) can discover each other.
 * No UI — connection happens silently in the background.
 */

import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { app } from 'electron';
import { fileURLToPath } from 'node:url';

/**
 * Find the shared root directory (e.g. C:\Users\Sara\Desktop\ve).
 * Strategy: walk up from this file until we find a directory containing
 * two or more VELTRUVIA* app folders (the install root), or fall back to
 * a folder next to userData.
 *
 * Note: require DIRECTORIES, not files — the exe folder itself contains
 * "VELTRUVIA Server.exe" and would otherwise false-positive.
 */
function findSharedDir() {
  // Walk up from the electron/ directory looking for the install root
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    dir = dirname(dir);
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      const appDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('VELTRUVIA'));
      if (appDirs.length >= 2) return dir;
    } catch {}
  }

  // Fallback: use a shared folder next to the user data directory
  const fallback = join(app.getPath('userData'), '..', 'VELTRUVIA-shared');
  try { mkdirSync(fallback, { recursive: true }); } catch {}
  return fallback;
}

// Resolved lazily on first access
let _sharedDir = null;
function getSharedDir() {
  if (!_sharedDir) _sharedDir = findSharedDir();
  return _sharedDir;
}

/**
 * The install root shared by all VELTRUVIA apps (contains the VELTRUVIA*
 * folders, the shared .env, and the shared data/ directory).
 * @returns {string}
 */
export function getSharedRoot() {
  return getSharedDir();
}

function getConfigDir() {
  const dir = join(getSharedDir(), 'config');
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

const CONFIG_DIR = getConfigDir();
const CONFIG_FILE = join(CONFIG_DIR, 'server-config.json');

/**
 * Get the server URL from shared config
 * @returns {string|null} The server URL or null if not found
 */
export function getServerUrl() {
  try {
    if (!existsSync(CONFIG_FILE)) return null;
    const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    return data.serverUrl || null;
  } catch (err) {
    console.error('[shared-config] Failed to read config:', err.message);
    return null;
  }
}

/**
 * Save the server URL to shared config
 * @param {string} url - The server URL to save
 */
export function saveServerUrl(url) {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    let config = {};
    if (existsSync(CONFIG_FILE)) {
      try {
        config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
      } catch {}
    }

    config.serverUrl = url;
    config.updatedAt = new Date().toISOString();

    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`[shared-config] Saved server URL: ${url}`);
  } catch (err) {
    console.error('[shared-config] Failed to save config:', err.message);
  }
}
