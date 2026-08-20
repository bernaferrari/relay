# Relay iOS preview producer

This is Relay's narrow, local sidecar for live iPad pixels. It uses the public
go-ios Instruments screenshot service directly and writes one MJPEG-like stream
to Relay over stdout.

It intentionally does **not** use `ios screenshot --stream`: the upstream
HTTP server fan-outs each frame through unbounded goroutines and can race a
send against a disconnected client's closed channel. The sidecar has exactly
one parent pipe and keeps only the latest JPEG while that pipe is blocked.

The reviewed upstream source is pinned in `go.mod` and `go.sum` to
[`go-ios@ebec9a0b076c`](https://github.com/danielpaulus/go-ios/tree/ebec9a0b076c);
the sidecar deliberately calls only its public Instruments screenshot API.

It provides pixels only. It never uses DeviceKit, WebDriverAgent, XCTest, or a
control channel, and it does not advertise a target FPS. Relay measures the
frames it actually observes.

Source checkouts can build the sidecar once per machine before using live iOS preview. It requires
Go 1.26 or newer, matching its pinned `go-ios`
`v1.2.2-0.20260805152531-ebec9a0b076c` dependency:

```sh
pnpm ios-preview:build
```

The binary is local and ignored at `.relay/bin/relay-ios-preview`. Override it
only deliberately with `RELAY_IOS_PREVIEW_PRODUCER_BIN`.

Packaged Relay for macOS does not require that manual step. Each target-specific release build
includes the reviewed Apple Silicon or Intel binary plus a manifest containing its byte checksum and
the exact producer/go-module hashes. Relay validates the native binary for the host architecture
before it starts the bundled server. A missing or changed packaged sidecar fails closed and asks the
user to reinstall Relay; it never downloads, rebuilds, or falls back to `ios screenshot --stream`.

Before either a source-built or packaged producer can provide pixels, Relay runs exactly one local
`relay-ios-preview --version` process with a two-second `SIGKILL` deadline. The finite cold-start
budget accommodates macOS's first-execution validation of a freshly signed release binary without
making preview startup unbounded. That proof receives no UDID, tunnel, device, or control argument;
there is no retry and a timeout remains an actionable unavailable diagnosis.

The manifest's `buildSha256` is the deterministic pre-sign build checksum. macOS changes executable
signature bytes while packaging, so the release gate and first-run preflight verify the final nested
code signature and outer app seal instead of comparing signed bytes to that pre-sign checksum.
