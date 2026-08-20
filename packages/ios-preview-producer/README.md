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

Build the sidecar once per machine before using live iOS preview. It requires
Go 1.26 or newer, matching its pinned `go-ios`
`v1.2.2-0.20260805152531-ebec9a0b076c` dependency:

```sh
pnpm ios-preview:build
```

The binary is local and ignored at `.relay/bin/relay-ios-preview`. Override it
only deliberately with `RELAY_IOS_PREVIEW_PRODUCER_BIN`.
