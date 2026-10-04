# Android application labels

Relay reads the names of launcher apps through this small PackageManager helper.
The existing device adapter remains the source of package identities; helper
output only enriches those identities with observed names. Labels are read fresh
for each inventory request so app updates and locale changes remain visible.

The helper has no Activity, launcher, or UiAutomation session. Its manifest only
queries apps with a launcher intent, so it does not compete with the snapshot
helper for Android's single UiAutomation slot.

From the repository root:

```sh
node scripts/build-android-app-inventory.mjs          # build and sign using the local Android SDK
node scripts/build-android-app-inventory.mjs --check  # verify source and APK provenance
```

The checked-in manifest pins the source digest, APK digest, package, runner, and
version. Desktop packaging copies the APK and manifest into the server assets.
At runtime Relay prepares an absent or outdated helper once, then makes one
bounded label request. Failure preserves the adapter's original app list and
fallback names.

Source and packaging checks do not qualify installation or observed names on a
physical phone; that requires a fresh Relay app inventory with a connected device.
