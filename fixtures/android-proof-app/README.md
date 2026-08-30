# Relay Android Proof fixture

This deliberately small, offline Android app gives Relay a stable target for
exact-build install, launch, semantic interaction, screenshot, accessibility,
log, and TracePack checks. It has no account, network, permission, or external
service dependency.

Build the tracked APK twice and require byte-for-byte reproducibility:

```bash
pnpm android-proof:build
```

Verify that the tracked APK still matches its source-bound manifest:

```bash
pnpm android-proof:verify
```

The package is `dev.relay.prooffixture` and the launch activity is
`dev.relay.prooffixture.MainActivity`. The checked-in signing key is a public,
fixture-only test key. It must never be reused for a production application.

The deterministic journey is:

1. Launch the app with a clean activity.
2. Select **Reset fixture**.
3. Select **Prove interaction**.
4. Verify that **Checkpoint passed** is visible and capture evidence.

The artifact manifest records both the raw APK SHA-256 and Relay's canonical
Proof artifact digest (`sha256(file\0 + bytes)`).
