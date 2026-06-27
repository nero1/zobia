# Expo white-screen fix — Android SDK level + on-device diagnostics

This note explains the changes made to (a) move the Android build to API level 35
the *supported* way, and (b) make startup errors actually visible on the device
so the post-splash white screen can be diagnosed without a CLI/Metro.

## RESOLUTION (the actual root cause) — expo-updates was gating the JS bundle

After every JS-level guard was in place (polyfills, bootstrap watchdog, root
error boundary, native-alert fallback, and the `SafeAreaProvider initialMetrics`
fix in PR #403), a `preview`-profile APK — which **force-enables** the debug
chip via `EXPO_PUBLIC_DEBUG_OVERLAY=1` — *still* booted to a permanent white
screen with **no chip and no native alert**. The debug chip is rendered as the
very first thing React paints, so its absence proves **React never mounted at
all** — i.e. the JS bundle was never executed. That rules out every JS-level
cause and points below JS, to the native bundle-loading layer (exactly what the
"How to use this…" section below predicted).

In a release build, **`expo-updates` owns JS bundle loading**: React Native's
`getJSBundleFile()` returns the bundle resolved by the updates controller. If
the controller is enabled but cannot resolve a launchable update (e.g. a
runtime-version mismatch between the embedded manifest and what the controller
expects), it returns no bundle and the app hangs on a blank screen — splash →
white → no JS → no chip → no alert.

The `expo-updates` config was also **malformed**: `runtimeVersion` and
`projectId` were passed as *plugin props*, which the `expo-updates` config plugin
does not read (they belong at the top level / `extra.eas.projectId`). So the
top-level `runtimeVersion` was effectively unset.

**Fix:** disable OTA so React Native loads the embedded `index.android.bundle`
directly, bypassing the updates controller entirely:

- `apps/expo/app.json` → top-level `"updates": { "enabled": false }` and a fixed
  top-level `"runtimeVersion": "1.0.0"`.
- Replaced the malformed `["expo-updates", { … }]` plugin entry with the plain
  `"expo-updates"` string so the plugin still writes `ENABLED=false` into the
  native config.

OTA was not a used feature — `expo-updates` is only referenced via
`Updates.reloadAsync()`, guarded by `Updates.isAvailable`, to apply an RTL
(Arabic) layout flip. With OTA disabled, `isAvailable` is `false`, so those calls
no-op; the only behavioural change is that switching to/from Arabic needs a
manual app restart. OTA can be re-enabled later (top-level `runtimeVersion` +
`updates.url`) once the app is stable.

## Root findings

1. **The Android SDK keys in `app.json` / `app.config.js` never took effect.**
   `android.compileSdkVersion`, `android.targetSdkVersion`, and
   `android.minSdkVersion` are **not** valid Expo config keys — Expo prints
   "Ignoring extra key …" and drops them. The only supported way to set Android
   SDK levels in an Expo prebuild project is the
   [`expo-build-properties`](https://docs.expo.dev/versions/latest/sdk/build-properties/)
   config plugin. So the "API 36" the build supposedly targeted was never
   applied; the build used the Expo SDK 51 defaults (compile/target **34**).

2. **The on-device diagnostics were profile-gated off.** `DebugOverlay`, the
   native-alert fallback (`lib/debug/logStore`) and the error-boundary detail are
   all disabled when `APP_ENV === 'production'`. `eas build` with **no
   `--profile`** defaults to the `production` profile, which both suppressed
   every on-screen diagnostic *and* built a non-installable `.aab`. That matches
   the reported symptom: white screen, no chip, no native alert, no error screen.

## Changes

- **`apps/expo/app.json`** — registered the `expo-build-properties` plugin with
  `compileSdkVersion: 35`, `targetSdkVersion: 35`, `minSdkVersion: 24`,
  `buildToolsVersion: "35.0.0"`; removed the ignored `*SdkVersion` keys from the
  `android` block.
- **`apps/expo/app.config.js`** — removed the ignored `*SdkVersion` keys (left a
  comment so they don't get re-added).
- **`apps/expo/package.json`** — added `expo-build-properties@~0.12.5` (the SDK 51
  version).
- **On-device diagnostics force-switch** — `EXPO_PUBLIC_DEBUG_OVERLAY`:
  - `"1"`/`"true"` → force the overlay, native-alert fallback and error-boundary
    detail **on**, even in a release/production bundle.
  - `"0"`/`"false"` → force them off.
  - unset → previous behaviour (on for non-production).
  Wired into `DebugOverlay.tsx`, `lib/debug/logStore.ts`,
  `RootErrorBoundary.tsx`, and set to `"1"` in the `development`, `preview` and
  `staging` EAS profiles.
- **`package.json` (root)** — `build:expo` now builds the **preview** profile
  (installable APK + diagnostics on); added `build:expo:prod` for the store
  `.aab`.

## How to use this to find the real white-screen cause

1. Build the **preview** profile: `npm run build:expo` (or
   `eas build -p android --profile preview`). It produces an installable APK with
   diagnostics on.
2. Install and launch. If a startup error is the cause you will now see either:
   - a **native alert** ("Startup error: …") for a crash that happens before
     React mounts, or
   - the **floating debug chip** (top-right) / **"Something went wrong"** screen
     with the error + stack for a crash after React mounts.
3. If the screen is white **and** none of the above appears, the failure is at
   the native layer (before JS runs) — capture `adb logcat` if possible.

> Tip: a stale `eas update` OTA bundle can mask a fresh build. Because the
> runtime version uses the `fingerprint` policy, a new native build gets a new
> fingerprint and falls back to the embedded bundle, so this is unlikely — but if
> in doubt, confirm no broken update is published to the build's channel.
