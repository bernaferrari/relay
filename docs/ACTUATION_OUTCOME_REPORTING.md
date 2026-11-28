# Actuation outcome reporting

Vendored `agent-device` instrumentation that native replay-cache admission is gated on.
Phases 1 and 2 are built: contracts, daemon-runtime construction, and Android executor
reporting ship in `patches/agent-device/0002-actuation-outcome-reporting.patch`; Apple runner
outcome reporting, direct-iOS delegation reasons, and Relay adopted-listener parsing ship in
`patches/agent-device/0003-apple-runner-actuation-reporting.patch` and
`packages/core/src/device/device-activation-transport.ts`. Physical-iOS selector presses now
classify honestly; old runners record `unobserved` rather than earning purity. Not yet
instrumented: sequence/double-tap batches, mouse click, drag/swipe gestures, and tvOS remote
presses report `executor: unknown` conservatively.

## Why

Cached replay may only admit a native step when its actuation did not depend on externally
frozen geometry. Verified against pinned vendor 0.21.45:

- The daemon resolves every selector against its own fresh accessibility capture and actuates
  the resolved point. The selector never reaches the platform on ordinary `press`/`fill`.
- `expectedTapPoint` is read only by the click-only direct-iOS runner route Relay does not use.
- Even the runner's element tap is an element-anchored coordinate; synthesized touch at the
  live element frame is numeric input. "Coordinate vs element" is the wrong question.

The honest model has three orthogonal axes: who chose the target, whose geometry was used and
whether it was fresh or externally supplied, and which executor injected the input.

## Wire shape

Additive optional `actuation` object on interaction success responses (daemon RPC `data` and
Apple runner `DataPayload`). No protocol-version bump: ADR 0006 says additive optional response
fields do not bump, and absence must always mean unknown, never pure. Fields: `version`,
`targeting` (element | point | direct), `geometry` (none | runner-element-frame |
runner-expected-point | daemon-snapshot | relay-snapshot | caller-point | provider-element |
unknown), `executor` (xctest-element-coordinate | xctest-coordinate | xctest-synthesized-touch
| android-adb-input | android-uiautomation-helper | android-provider-native | provider-native |
keyboard | unknown), optional `executorDetail`, and two deliberately separate fallback facts:
`coordinateFallback` (a semantic target became numeric input, including daemon direct→runtime
delegation reasons) and `mechanismFallback` (one injector substituted for another).

Ownership: the daemon owns targeting/geometry for runtime-resolved interactions, the platform
backend owns executor/mechanism facts, the runner owns runner-internal selector outcomes on
direct-selector commands only. Do not overload `maestroNonHittableCoordinateFallbackUsed`;
keep vendored type names upstream-neutral (no Relay vocabulary).

## Phasing

1. (done) Contracts + daemon-runtime construction + Android executor reporting + Relay ledger
   consumption. Corrects the dominant unknowability without any runner upgrade.
2. (done) Apple runner outcome reporting + direct-iOS delegation reasons + Relay adopted-listener
   parsing. Makes physical-iOS selector presses honest.
3. Capability advertisement, guarantee-matrix classification, skew hardening.

Estimated 8–12 days total, most of it in the vendored Swift runner and its packaging workflow.

## What stays unknowable even then

Whether the OS interpreted injected input as activation of the intended control; provider-internal
actuation mechanics; outcomes of old daemons/runners; physical delivery confirmation for the HID
sidecar beyond its own acknowledgement. `unobserved`/unknown is never admissible for cache replay.
