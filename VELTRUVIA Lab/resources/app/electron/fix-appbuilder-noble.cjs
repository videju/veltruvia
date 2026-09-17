// app-builder-lib (electron-builder) requires @noble/hashes/blake2.js via
// CommonJS, but its own dep spec (^2) resolves to the ESM-only v2, which
// crashes every electron-builder invocation with ERR_REQUIRE_ESM.
// The CJS-compatible v1 satisfies it — remove any nested ESM copy so Node
// resolves to the root v1 install (see "overrides" in package.json).
// Wired as a postinstall hook so plain `npm install` self-heals.
const { rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const nested = join(__dirname, '..', 'node_modules', 'app-builder-lib', 'node_modules', '@noble');
try {
  if (existsSync(nested)) {
    rmSync(nested, { recursive: true, force: true });
    console.log('[fix-appbuilder-noble] removed ESM @noble/hashes nested in app-builder-lib');
  }
} catch (e) {
  console.warn('[fix-appbuilder-noble] non-fatal:', e.message);
}
