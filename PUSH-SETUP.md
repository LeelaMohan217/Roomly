# Push notifications — the setup only you can do

Everything in the code and the database is already finished and verified:

| Piece | State |
|---|---|
| `push_tokens` table + `register_push_token()` RPC | done, migration `0016` |
| Sending, straight from Postgres via `pg_net` | done, migration `0016` |
| Token registration on sign-in | done, `src/lib/push.ts` |
| Foreground banner behaviour | done |
| Android notification channel | done |
| Status row in Account | done |

The security suite already proves the server half works: an anonymous call to
`register_push_token` returns `204`, so the function and table exist.

**What is missing is two account-level things, and I cannot do either of them:
they need your Expo login and your Google account.** Both are free.

Until they are done, the app registers no token, sends no push, and the in-app
bell keeps working exactly as it does now. Account → Notifications reads
**Off — this build has no push credentials**.

---

## Step 1 — an Expo project ID (5 minutes)

`getExpoPushTokenAsync()` cannot issue a token without one.

```bash
cd roomly
npx expo login
npx eas init
```

`eas init` creates a free Expo project and writes the ID into `app.json` for
you, as `expo.extra.eas.projectId`. Nothing else in `app.json` changes.

> You do **not** need EAS Build. The project ID is just an identity that
> Expo's push service resolves; the APK stays locally built.

Check it landed:

```bash
node -e "console.log(require('./app.json').expo.extra.eas.projectId)"
```

## Step 2 — Firebase Cloud Messaging (15 minutes)

Android push is delivered by FCM. Expo's service needs permission to send on
your behalf, and the app needs to know which Firebase project it belongs to.

1. In the [Firebase console](https://console.firebase.google.com), create a
   project. Any name.
2. Add an **Android** app to it. The package name **must be exactly**:

   ```
   com.roomly.app
   ```

   Getting this wrong is the single most common cause of "no token" — it has to
   match `expo.android.package` in `app.json`.
3. Download **`google-services.json`** and put it in the `roomly/` folder,
   next to `app.json`.
4. In Firebase: **Project settings → Service accounts → Generate new private
   key**. This downloads a second, *secret* JSON file.
5. Upload that secret file to your Expo project — either:

   ```bash
   npx eas credentials
   # Android > production > Google Service Account
   # > Manage your Google Service Account Key for Push Notifications (FCM V1)
   # > Set up a Google Service Account Key > Upload a new service account key
   ```

   or in the Expo dashboard: **Project settings → Credentials → Android →
   `com.roomly.app` → Service Credentials → FCM V1 service account key**.

> `google-services.json` holds public identifiers and is safe in the repo. The
> **service account key from step 4 is a secret** — it is already covered by
> `.gitignore`. Never send it to anyone, including me.

## Step 2b — iOS: an Apple push key (APNs)

iOS push goes through Apple (APNs), not Firebase. `google-services.json` is
Android-only and is not needed for iOS.

This needs a paid **Apple Developer Program** membership ($99/year) — there is
no free way to get push on a real iPhone.

You do **not** need a Mac. EAS builds iOS in the cloud and can create the key
for you:

```bash
npx eas credentials --platform ios
# production > Push Notifications: Manage your Apple Push Notifications Key
# > Set up your project to use Push Notifications > let EAS generate a new key
```

The bundle identifier is `com.roomly.app` (`expo.ios.bundleIdentifier` in
`app.json`) — it must match the App ID in your Apple account, and EAS creates
that App ID for you on the first `eas build --platform ios`.

> The downloaded `.p8` key is a secret. It is already covered by `.gitignore`.

## Step 3 — tell me, and I finish it

Once steps 1 and 2 are done, say so. I will:

1. add `android.googleServicesFile` and the `expo-notifications` plugin to
   `app.json` — deliberately **not** added yet, because pointing at a
   `google-services.json` that does not exist fails the build
2. run `node scripts/rebuild-native.mjs --build`

That script exists for one reason. A config plugin change requires
`expo prebuild`, which regenerates `android/gradle.properties` and **silently
drops** the three hand-made settings that took the APK from 112MB to 37MB:

```
reactNativeArchitectures=arm64-v8a
android.enableMinifyInReleaseBuilds=true
android.enableShrinkResourcesInReleaseBuilds=true
```

The script restores them and **fails loudly if any is missing**, rather than
handing you a three-times-larger APK with no explanation.

---

## Checking it actually works

Install the new APK and open **Account → Notifications**. It should read
**On**. If not:

| Reads | Means |
|---|---|
| Off — no push credentials | `extra.eas.projectId` missing. Step 1 |
| Off — only a real phone | You are on web or an emulator. Expected |
| Blocked | Either the OS prompt was declined, or FCM (Android) / APNs (iOS) is misconfigured |
| Asking | Permission prompt not answered yet |

> **A missing FCM key on Expo's side does not show up here at all.** The row
> reads **On** as soon as a token is issued, which needs only the project ID
> and `google-services.json`. If it says On and nothing ever arrives, the
> service account key from step 2 was never uploaded — that is the first thing
> to check, not the phone.

**Blocked is the ambiguous one** — it covers both a declined prompt and a
broken FCM setup, because a token request failing is the only way FCM trouble
surfaces. If Android settings show notifications *are* allowed for roomly and
it still says Blocked, the package name in step 2 is the first thing to check.

Then the real test: have a housemate add an expense while your app is **fully
closed**. You should get a banner. Nothing arrives from your own actions — the
trigger deliberately skips the person who did it.

## What will already work, and what will not

Already working, no setup needed: the bell and unread badge, and live updates
while the app is open (Supabase Realtime).

Push covers new expenses, confirmed payments, payments awaiting your approval,
members added or joined, and ownership handovers — the same events the in-app
feed shows, because both come from the same `notify_household()` call.
