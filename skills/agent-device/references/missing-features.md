# Missing Features Plan (Agent-Browser Parity)

This is a prioritized, mobile-specific gap list based on agent-browser.

## P0 (core parity)

- Waits: wait for text, wait for element (by ref), wait for app idle.
- Alerts: detect, accept, dismiss, get text.
- Navigation: back, home, app switcher (where supported).
- Scroll into view by text for iOS (Android already has scrollintoview).
- Snapshot scopes by ref (e.g., snapshot -s "label" or use node ref as scope).

## P1 (debug and reliability)

- Highlight ref (visual debug overlay for refs).
- Record start/stop for simulator and adb (CLI wrapper).
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
