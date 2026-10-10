/**
 * Stamp a build identity into app.json.
 *
 *   node scripts/stamp-build.mjs
 *
 * Why this exists: every APK built today reported "Version 1.0.0", because
 * settings.tsx had that string hardcoded and app.json had no versionCode. With
 * four people sideloading, "the calendar looks squashed" was unanswerable --
 * there was no way to tell which build someone was running.
 *
 * WHAT IT BUMPS, AND WHAT IT DELIBERATELY DOES NOT
 *
 *   extra.buildNumber   incremented   the identity shown in the app
 *   extra.buildTime     now           so a build can be placed in the day
 *   android.versionCode incremented   Android's own install ordering
 *   ios.buildNumber     incremented   iOS's equivalent (a string, per Apple)
 *   version             UNTOUCHED     see below
 *
 * `version` must not move. runtimeVersion uses the `appVersion` policy, so an
 * OTA update published for 1.0.0 reaches every APK reporting 1.0.0. Bumping
 * `version` per build would orphan every update the moment a new APK existed,
 * which is the opposite of what OTA is for. Bump `version` by hand, and only
 * when native code changes in a way JS cannot be shipped against.
 *
 * extra.* rather than versionCode for the in-app display, because extra is
 * embedded in assets/app.config at bundle time -- it reaches the APK from a
 * plain `gradlew assembleRelease`, with no prebuild needed. versionCode only
 * takes effect when prebuild runs.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const APP_JSON = 'app.json';
const app = JSON.parse(readFileSync(APP_JSON, 'utf8'));
const expo = app.expo;

expo.extra = expo.extra ?? {};
expo.android = expo.android ?? {};
expo.ios = expo.ios ?? {};

const previous = Number(expo.extra.buildNumber ?? 0);
const next = previous + 1;

expo.extra.buildNumber = next;
// Local time, not UTC: this is read by a person comparing it to their clock.
expo.extra.buildTime = new Date()
  .toLocaleString('sv-SE', { hour12: false })
  .replace(' ', 'T')
  .slice(0, 16);

expo.android.versionCode = Number(expo.android.versionCode ?? 0) + 1;
expo.ios.buildNumber = String(Number(expo.ios.buildNumber ?? 0) + 1);

writeFileSync(APP_JSON, JSON.stringify(app, null, 2) + '\n');

console.log('build      ' + previous + ' -> ' + next);
console.log('buildTime  ' + expo.extra.buildTime);
console.log('versionCode ' + expo.android.versionCode);
console.log('ios build   ' + expo.ios.buildNumber);
console.log('version     ' + expo.version + '   (unchanged on purpose -- OTA targets it)');
