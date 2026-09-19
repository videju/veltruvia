// Pure transform for a Capacitor-generated app/build.gradle:
//   1. stamp versionCode/versionName from the app's package.json version —
//      a fresh `cap add android` ships versionCode 1, a *downgrade* for
//      phones already running an earlier release;
//   2. ensure a release signingConfig exists — the generated project has
//      none, so gradle would emit an unsigned APK on CI.
// Pure string-in/string-out so tests can pin exact behavior.
export function computeVersionCode(version) {
  const [maj, min, patch] = String(version).split('.').map(Number);
  return maj * 10000 + min * 100 + (patch || 0); // 2.0.1 → 20001
}

export function stampGradle(src, version) {
  // Handle both Groovy (`versionCode 1`) and Kotlin-style (`versionCode = 1`)
  // renderings; the replacement method-call form is valid in either.
  let out = src
    .replace(/versionCode\s*=?\s*\d+/, `versionCode ${computeVersionCode(version)}`)
    .replace(/versionName\s*=?\s*"[^"]*"/, `versionName "${version}"`);

  if (!out.includes('signingConfigs {')) {
    const ind = (out.match(/\n(\s*)buildTypes \{/) || [null, '    '])[1];
    const block =
      `${ind}signingConfigs {\n` +
      `${ind}    release {\n` +
      `${ind}        storeFile file(System.getenv("VELTRUVIA_KEYSTORE") ?: rootProject.file("../../../veltruvia-release.keystore").absolutePath)\n` +
      `${ind}        storePassword System.getenv("VELTRUVIA_KEYSTORE_PASSWORD")\n` +
      `${ind}        keyAlias "veltruvia"\n` +
      `${ind}        keyPassword System.getenv("VELTRUVIA_KEYSTORE_PASSWORD")\n` +
      `${ind}    }\n` +
      `${ind}}\n\n`;
    out = out.replace(/\n\s*buildTypes \{/, `\n${block}${ind}buildTypes {`);
  }
  if (!out.includes('signingConfig signingConfigs.release')) {
    out = out.replace(
      /buildTypes \{\n(\s*)release \{/,
      (m, i) => `buildTypes {\n${i}release {\n${i}    signingConfig signingConfigs.release`);
  }
  return out;
}
