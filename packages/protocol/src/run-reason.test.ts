import assert from "node:assert/strict";
import test from "node:test";
import { plainRunReason } from "./run-reason.js";

test("plain reasons translate runner phrasing seen in real runs", () => {
  const cases: [string, string][] = [
    [
      "Text entry verification failed: the field readback does not match the requested text. Relay stopped before continuing.",
      "Relay typed the text, but the field showed something different.",
    ],
    [
      "check cleanup skipped: Type text — native input unverified\n✗ Text entry verification failed: the field readback does not match the requested text.",
      "Relay typed the text, but the field showed something different.",
    ],
    [
      "screen-inspection-unavailable: accessibility inspection unavailable; screen identity unproven (expected “Grok home”; semantic-read failed-read)",
      "Relay couldn’t read the screen’s controls, so it couldn’t confirm it was on “Grok home”.",
    ],
    [
      '1 campaign check failed: Open Imagine signed-in: tap failed: named target ambiguous in current Android accessibility tree: selector matches 2 different control locations (label "Imagine")',
      "Relay found 2 “Imagine” controls and couldn’t tell which one to use.",
    ],
    [
      '15 campaign checks failed: Team permissions: tap failed: named target absent from current Android accessibility tree: selector is not present in the current accessibility tree (label "Manage team")',
      "Relay couldn’t find “Manage team” on the screen.",
    ],
    [
      "response completion: timed out after 120s (no response observed)",
      "No reply appeared within 2 min.",
    ],
    [
      '\u001b[2m  - navigating to "http://127.0.0.1:8791/", waiting until "domcontentloaded"\u001b[22m',
      "The page at http://127.0.0.1:8791/ didn’t finish loading.",
    ],
    [
      "Stuck at “Open the attach menu” and nobody resumed it within 60s",
      "Relay paused at “Open the attach menu” and nobody continued it within 1 min.",
    ],
    [
      "1 campaign check failed: Home: expect-screen: on “unknown”, not “Start” after 5000ms (pixels unchanged for 5022ms). Next: Inspect",
      "Expected the “Start” screen within 5 s, but Relay didn’t recognize the screen it was on.",
    ],
  ];
  for (const [raw, plain] of cases) assert.equal(plainRunReason(raw), plain);
});

test("plain reasons keep an already plain sentence as is", () => {
  const sentence = "The iOS press may already have reached the device. Relay did not retry it.";
  assert.equal(plainRunReason(sentence), sentence);
  assert.equal(plainRunReason("   "), undefined);
});
