import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoveryControl, DiscoverySession, ObservedScreen } from "@relay/protocol";
import { discoveryFingerprintsChanged } from "./discovery-verify.js";

// Light unit coverage for the here/do option marking without a device.
function openedTargets(session: Pick<DiscoverySession, "transitions">): Set<string> {
  const out = new Set<string>();
  for (const transition of session.transitions) {
    if (!transition.target || !transition.changedScreen) continue;
    out.add(`${transition.fromScreenId}:${JSON.stringify(transition.target)}`);
  }
  return out;
}

test("opened options mark only identity-changing taps from the current screen", () => {
  const control: DiscoveryControl = {
    id: "c1",
    label: "Appearance",
    target: { label: "Appearance" },
  };
  const screen: ObservedScreen = {
    id: "screen-settings",
    fingerprint: "fp",
    title: "Settings",
    capturedAt: 1,
    controls: [control],
  };
  const opened = openedTargets({
    transitions: [
      {
        id: "t1",
        fromScreenId: "screen-settings",
        toScreenId: "screen-appearance",
        kind: "tap",
        label: "Appearance",
        target: { label: "Appearance" },
        capturedAt: 2,
        changedScreen: true,
      },
      {
        id: "t2",
        fromScreenId: "screen-settings",
        kind: "tap",
        label: "Haptics",
        target: { label: "Haptics" },
        capturedAt: 3,
        changedScreen: false,
      },
    ],
  });
  assert.equal(opened.has(`${screen.id}:${JSON.stringify(control.target)}`), true);
  assert.equal(opened.has(`${screen.id}:${JSON.stringify({ label: "Haptics" })}`), false);
});

test("do→here verify treats fingerprint drift as changed even without new screen id", () => {
  const before: Pick<ObservedScreen, "id" | "fingerprint"> = {
    id: "screen-settings",
    fingerprint: "fp-before",
  };
  const hereScreen: Pick<ObservedScreen, "id" | "fingerprint"> = {
    id: "screen-settings",
    fingerprint: "fp-after-settle",
  };
  const changedIdentity = before.id !== hereScreen.id;
  const changed =
    discoveryFingerprintsChanged(before.fingerprint, hereScreen.fingerprint) || changedIdentity;
  assert.equal(changedIdentity, false);
  assert.equal(changed, true);
});

test("do→here verify keeps changed false when settle matches before", () => {
  const beforeFp = "same-fp";
  const hereFp = "same-fp";
  const changedIdentity = false;
  const changed = discoveryFingerprintsChanged(beforeFp, hereFp) || changedIdentity;
  assert.equal(changed, false);
});
