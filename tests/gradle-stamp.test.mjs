// Tests for scripts/gradle-stamp.mjs — version stamping + signingConfig
// injection into Capacitor-generated app/build.gradle files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVersionCode, stampGradle } from '../scripts/gradle-stamp.mjs';

// What `npx cap add android` generates: versionCode 1, no signing config.
const FRESH = `apply plugin: 'com.android.application'

android {
    namespace = "com.veltruvia.app"
    compileSdkVersion 35

    defaultConfig {
        applicationId = "com.veltruvia.app"
        minSdkVersion = 23
        targetSdkVersion = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            minifyEnabled = false
        }
    }
}
`;

// The hand-maintained local variant: signing already present.
const LOCAL = FRESH.replace('    buildTypes {', `    signingConfigs {
        release {
            storeFile file(System.getenv("VELTRUVIA_KEYSTORE") ?: rootProject.file("../../../veltruvia-release.keystore").absolutePath)
            storePassword System.getenv("VELTRUVIA_KEYSTORE_PASSWORD")
            keyAlias "veltruvia"
            keyPassword System.getenv("VELTRUVIA_KEYSTORE_PASSWORD")
        }
    }

    buildTypes {`)
  .replace('        release {\n            minifyEnabled', '        release {\n            signingConfig signingConfigs.release\n            minifyEnabled');

test('versionCode maps semver to monotonically increasing ints', () => {
  assert.equal(computeVersionCode('2.0.1'), 20001);
  assert.equal(computeVersionCode('2.0.0'), 20000);
  assert.equal(computeVersionCode('1.0.0'), 10000);
  assert.equal(computeVersionCode('10.3.7'), 100307);
  assert.ok(computeVersionCode('2.0.2') > computeVersionCode('2.0.1'));
});

test('fresh cap add project gets stamped version + release signing', () => {
  const out = stampGradle(FRESH, '2.0.1');
  assert.match(out, /versionCode 20001/);
  assert.match(out, /versionName "2\.0\.1"/);
  assert.match(out, /signingConfigs \{/);
  assert.match(out, /keyAlias "veltruvia"/);
  assert.match(out, /signingConfig signingConfigs\.release/);
  // signingConfigs block must sit before buildTypes inside android { }
  assert.ok(out.indexOf('signingConfigs {') < out.indexOf('buildTypes {'));
});

test('idempotent: stamping twice does not duplicate config', () => {
  const once = stampGradle(FRESH, '2.0.1');
  const twice = stampGradle(once, '2.0.1');
  assert.equal(twice, once);
  assert.equal((twice.match(/signingConfigs \{/g) || []).length, 1);
  assert.equal((twice.match(/signingConfig signingConfigs\.release/g) || []).length, 1);
});

test('locally maintained gradle (already signed) is only re-versioned', () => {
  const out = stampGradle(LOCAL, '2.0.1');
  assert.match(out, /versionCode 20001/);
  assert.equal((out.match(/signingConfigs \{/g) || []).length, 1);
  assert.equal((out.match(/keyAlias "veltruvia"/g) || []).length, 1);
});
