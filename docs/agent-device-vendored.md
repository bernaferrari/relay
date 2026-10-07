# Vendored `agent-device`

Relay uses a local fork of `agent-device` at `vendor/agent-device`, pulled from upstream release
`v0.21.23`, commit `b8219f54ddfd2acf08a2f56a5dbcce917cc16d0c`.
The package is linked directly from `@relay/core`, so device behavior is editable and reviewable in
this repository rather than hidden inside pnpm's patch store.

## Clean vendor policy

- The tree under `vendor/agent-device` is the source of truth for the fork.
- There is **no** pnpm `patchedDependencies` entry, **no** `patches/` overlay, and **no** post-build
  override directory for this dependency.
- Relay-specific runtime behavior is implemented directly in the vendored TypeScript and Apple
  runner source. The build is a normal upstream-style build; compiled output must not drift from that
  source via a second patch layer.

Do not edit `node_modules/.pnpm` or add another pnpm patch. Changes belong in the vendored source
or Relay itself.

The fork retains verified physical iOS field paste/copy, orientation-correct iPad screenshots,
element-relative selector taps, scoped runner artifact cleanup, and serialization of local daemon
acquisition. Updates keep upstream's daemon ownership and command trait declarations authoritative.

## Updating the fork

The vendored tree is an upstream subtree. To inspect or pull a newer upstream release:

```bash
git remote add agent-device-upstream https://github.com/callstack/agent-device.git
git fetch agent-device-upstream
git subtree pull --prefix=vendor/agent-device agent-device-upstream <tag> --squash
```

Resolve any intentional Relay changes in the vendored source, then run:

```bash
pnpm agent-device:install
pnpm agent-device:build
```

## Verification after an update

```bash
cd vendor/agent-device
pnpm typecheck
npx vitest run --project unit-core        # hermetic suites
npx vitest run --project apple-runner     # XCTest runner suites
pnpm check:xctest-selection
pnpm build:xcuitest:ios
ANDROID_HOME="$HOME/Library/Android/sdk" AGENT_DEVICE_ANDROID_BUILD_TOOLS=36.0.0 \
  pnpm build:android
```

Replace the previous snapshot helper APK and manifest in `packages/core/android-helpers/` with the
new pair from `android/snapshot-helper/dist/`; keep one version there. Relay verifies the manifest
and APK checksum, checks the installed helper version, and verifies an upgrade before capture.
The SDK also needs its rebuilt snapshot and IME helpers under the vendored `android/*/dist/` trees.
Run `node scripts/verify-android-snapshot-helper.mjs` from the Relay root after packaging.

Two upstream gates compare git trees against `origin/main` and only behave in upstream's own CI:
`scripts/__tests__/test-file-size-ratchet.test.ts` reads merge-base paths relative to the vendor
root, which never resolve in this repository's nested layout, and the eager-closure budgets need
`origin/main` to already contain the subtree merge. Treat their fork-local failures as upstream-CI
context, not source regressions.
