/**
 * Turn push on, once the two account-level prerequisites exist.
 *
 *   node scripts/enable-push.mjs
 *
 * Why this is a script and not something already in app.json: both entries it
 * adds are booby-trapped until the prerequisites are in place.
 *
 *   - `android.googleServicesFile` pointing at a file that does not exist
 *     fails `expo prebuild` outright.
 *   - a placeholder `extra.eas.projectId` is worse than none: it opens the gate
 *     in src/lib/push.ts and then fails at token fetch, which looks like a
 *     broken app rather than an unfinished setup.
 *
 * So it refuses rather than guessing, and is idempotent -- run it twice and the
 * second run changes nothing.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const APP_JSON = 'app.json';
const GOOGLE_SERVICES = './google-services.json';
const NOTIFICATION_ICON = './assets/images/android-icon-monochrome.png';
const ACCENT = '#0E9A6C'; // theme.primary

const app = JSON.parse(readFileSync(APP_JSON, 'utf8'));
const expo = app.expo;
const problems = [];

// ---- prerequisite 1: an Expo project ID -------------------------------
const projectId = expo.extra?.eas?.projectId;
if (!projectId) {
  problems.push(
    'No expo.extra.eas.projectId.\n' +
      '    getExpoPushTokenAsync() cannot issue a token without one.\n' +
      '    Fix:  npx expo login  &&  npx eas-cli@latest init'
  );
}

// ---- prerequisite 2: google-services.json -----------------------------
if (!existsSync(GOOGLE_SERVICES.replace(/^\.\//, ''))) {
  problems.push(
    'No google-services.json in the project root.\n' +
      '    Download it from the Firebase console for an Android app whose\n' +
      '    package is exactly "' + expo.android.package + '".\n' +
      '    See PUSH-SETUP.md step 2.'
  );
}

if (problems.length) {
  console.error('\nCannot enable push yet:\n');
  problems.forEach((p, i) => console.error('  ' + (i + 1) + '. ' + p + '\n'));
  console.error('Nothing was changed.\n');
  process.exit(1);
}

// The package name in google-services.json must match, or FCM issues no token
// and the only symptom is a silent failure at registration.
const gs = JSON.parse(readFileSync(GOOGLE_SERVICES.replace(/^\.\//, ''), 'utf8'));
const packages = (gs.client ?? [])
  .map((c) => c.client_info?.android_client_info?.package_name)
  .filter(Boolean);

if (!packages.includes(expo.android.package)) {
  console.error(
    '\nERROR: google-services.json is for ' +
      (packages.join(', ') || '(no package found)') +
      ',\n       but this app is ' + expo.android.package + '.\n\n' +
      'Add an Android app with that exact package in the Firebase console and\n' +
      're-download the file. A mismatch here yields no push token, silently.\n'
  );
  process.exit(1);
}

// ---- apply ------------------------------------------------------------
const changes = [];

if (expo.android.googleServicesFile !== GOOGLE_SERVICES) {
  expo.android.googleServicesFile = GOOGLE_SERVICES;
  changes.push('android.googleServicesFile');
}

expo.plugins = expo.plugins ?? [];
const hasNotifications = expo.plugins.some(
  (p) => p === 'expo-notifications' || (Array.isArray(p) && p[0] === 'expo-notifications')
);

if (!hasNotifications) {
  // Reusing the monochrome adaptive-icon layer: Android notification icons
  // must be a white-on-transparent silhouette, which is exactly what that
  // asset already is. No new artwork needed.
  expo.plugins.push([
    'expo-notifications',
    { icon: NOTIFICATION_ICON, color: ACCENT },
  ]);
  changes.push('expo-notifications plugin');
}

if (!changes.length) {
  console.log('\nAlready enabled. app.json unchanged.');
} else {
  writeFileSync(APP_JSON, JSON.stringify(app, null, 2) + '\n');
  console.log('\nEnabled push in app.json:');
  changes.forEach((c) => console.log('  + ' + c));
}

console.log('\nprojectId : ' + projectId);
console.log('package   : ' + expo.android.package);
console.log(
  '\nNext, and it must be this script -- a plain gradlew build will not pick up\n' +
    'the config plugin, and a plain prebuild will drop the size settings:\n\n' +
    '  node scripts/rebuild-native.mjs --build\n'
);
