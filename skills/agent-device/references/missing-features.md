# Missing Features Plan (Agent-Browser Parity)

This is a prioritized, mobile-specific gap list based on agent-browser.

## P1 (debug and reliability)

- Highlight ref (visual debug overlay for refs).
- Trace/log capture toggle for XCTest/AX.
- Retry strategy knobs (backoff, max retries) for flaky operations.

## P2 (advanced parity)

- Semantic finders (find text/label/value role) to avoid raw refs.
- App state: foreground app, current activity, app list with metadata.
- OS settings helpers (toggle wifi, location, airplane mode) for simulators.

## P3 (nice-to-have)

- Multi-screen/multi-window support (iPad, Android multi-window).
- UI caching (reuse snapshot nodes across steps with validation).
- Screenshot OCR helpers for visual-only flows.
