// Prints the two GitHub Actions secrets needed by .github/workflows/release.yml
// so the CI android job can sign the release APKs.
//
// Usage:   node scripts/print-github-secrets.mjs
// Then paste both values into:
//   https://github.com/videju/veltruvia/settings/secrets/actions
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keystorePath = join(root, 'veltruvia-release.keystore');
const passPath = join(root, '.keystore-pass');

let b64, pass;
try {
  b64 = readFileSync(keystorePath).toString('base64');
} catch {
  console.error(`✗ keystore not found at ${keystorePath}`);
  process.exit(1);
}
try {
  pass = readFileSync(passPath, 'utf8').replace(/\r?\n/g, '');
} catch {
  console.error(`✗ keystore password not found at ${passPath}`);
  process.exit(1);
}

console.log(`
Add these two secrets at:
  https://github.com/videju/veltruvia/settings/secrets/actions

Name: VELTRUVIA_KEYSTORE_B64
Value:
${b64}

Name: VELTRUVIA_KEYSTORE_PASSWORD
Value:
${pass}

After saving both, push a version tag to trigger the automated release:
  git tag v2.0.1 && git push origin v2.0.1
`);
