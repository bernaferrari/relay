import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotPayload } from "../workspace-capture.js";
import { proposeNavigationFromObservation } from "./navigation-observation.js";

function snapshot(title: string, extra: SnapshotPayload["nodes"] = []): SnapshotPayload {
  return {
    capturedAt: 1,
    nodes: [
      {
        identifier: `${title}-root`,
        type: "Application",
        label: title,
        visibleToUser: true,
        rect: { x: 0, y: 0, width: 64, height: 160 },
      },
      ...extra,
    ],
    interactive: extra,
    bounds: { width: 64, height: 160 },
    inspectable: true,
    source: "sdk",
    screenIdentity: { fingerprint: title, nodes: [], volatileSignals: [] },
  };
}

test("a unique safe tap proposes a reviewable edge and never mutates inputs", () => {
  const before = snapshot("Settings", [
    {
      identifier: "advanced",
      label: "Advanced",
      type: "Button",
      visibleToUser: true,
      rect: { x: 8, y: 40, width: 48, height: 16 },
    },
  ]);
  const after = snapshot("Advanced", [
    {
      label: "Back",
      type: "Button",
      visibleToUser: true,
      rect: { x: 4, y: 8, width: 20, height: 16 },
    },
    {
      identifier: "voice",
      label: "Voice",
      type: "Button",
      visibleToUser: true,
      rect: { x: 8, y: 40, width: 48, height: 16 },
    },
  ]);
  const beforeNodes = before.nodes.length;
  const result = proposeNavigationFromObservation({
    before,
    after,
    action: { kind: "tap", identifier: "advanced", label: "Advanced" },
  });
  assert.equal(result.status, "proposed");
  if (result.status !== "proposed") return;
  assert.deepEqual(result.edge.targetAlternatives[0], {
    kind: "identifier",
    identifier: "advanced",
  });
  assert.equal(result.edge.returnBehavior?.kind, "back");
  assert.notEqual(
    result.edge.sourceIdentity.fingerprint,
    result.edge.destinationIdentity.fingerprint,
  );
  assert.equal(before.nodes.length, beforeNodes);
});

test("destructive and duplicate controls stay unresolved", () => {
  const before = snapshot("Account", [
    {
      identifier: "erase",
      label: "Erase all content",
      type: "Button",
      visibleToUser: true,
    },
    { identifier: "dup", label: "Open", type: "Button", visibleToUser: true },
    { identifier: "dup-2", label: "Open", type: "Button", visibleToUser: true },
  ]);
  const after = snapshot("Gone");
  assert.equal(
    proposeNavigationFromObservation({
      before,
      after,
      action: { kind: "tap", identifier: "erase", label: "Erase all content" },
    }).status,
    "unresolved",
  );
  assert.equal(
    proposeNavigationFromObservation({
      before,
      after,
      action: { kind: "tap", label: "Open" },
    }).status,
    "unresolved",
  );
});

test("an unchanged identity after a tap is not a navigation edge", () => {
  const screen = snapshot("Settings", [
    {
      identifier: "advanced",
      label: "Advanced",
      type: "Button",
      visibleToUser: true,
    },
  ]);
  const result = proposeNavigationFromObservation({
    before: screen,
    after: structuredClone(screen),
    action: { kind: "tap", identifier: "advanced" },
  });
  assert.equal(result.status, "unresolved");
  if (result.status === "unresolved") {
    assert.match(result.reason, /did not change screen identity/u);
  }
});
