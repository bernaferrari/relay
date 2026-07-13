import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoverySession, ObservedTransition } from "@relay/protocol";
import { discoveryCanvasLayout, discoveryPathRows } from "./discovery-presentation.js";

const transition = (
  id: string,
  fromScreenId: string,
  toScreenId: string,
  capturedAt: number,
): ObservedTransition => ({
  id,
  fromScreenId,
  toScreenId,
  capturedAt,
  kind: "tap",
  label: id,
  changedScreen: true,
});

const session = (transitions: ObservedTransition[]): DiscoverySession => ({
  id: "discovery-1",
  name: "Authentication",
  targetId: "iphone",
  scope: { maxScreens: 10, maxTransitions: 20, maxDurationMs: 60_000 },
  status: "complete",
  createdAt: 1,
  updatedAt: 2,
  screens: [
    { id: "home", fingerprint: "home", title: "Home", capturedAt: 1 },
    { id: "email", fingerprint: "email", title: "Email", capturedAt: 2 },
    { id: "sso", fingerprint: "sso", title: "SSO", capturedAt: 3 },
    { id: "orphan", fingerprint: "orphan", title: "Orphan", capturedAt: 4 },
  ],
  transitions,
});

test("presents sibling branches in observed order with reconstructable paths", () => {
  const rows = discoveryPathRows(
    session([
      transition("Use email", "home", "email", 10),
      transition("Use SSO", "home", "sso", 20),
    ]),
  );
  assert.deepEqual(
    rows.map((row) => [row.screen.id, row.depth, row.incoming?.label, row.reachable]),
    [
      ["home", 0, undefined, true],
      ["email", 1, "Use email", true],
      ["sso", 1, "Use SSO", true],
      ["orphan", 0, undefined, false],
    ],
  );
});

test("does not loop when the observed graph contains a back edge", () => {
  const rows = discoveryPathRows(
    session([transition("Forward", "home", "email", 10), transition("Back", "email", "home", 20)]),
  );
  assert.equal(rows.filter((row) => row.screen.id === "home").length, 1);
  assert.deepEqual(
    rows.find((row) => row.screen.id === "email")?.path.map((item) => item.id),
    ["Forward"],
  );
});

test("keeps sibling branches in one column and places unlinked captures after the graph", () => {
  const positions = discoveryCanvasLayout(
    session([
      transition("Email", "home", "email", 10),
      transition("SSO", "home", "sso", 20),
      transition("Back", "email", "home", 30),
    ]),
    { width: 236, height: 288, columnGap: 56, rowGap: 44 },
  );
  assert.deepEqual(
    [positions.home, positions.email, positions.sso, positions.orphan].map((position) => [
      position?.level,
      position?.x,
      position?.y,
      position?.reachable,
    ]),
    [
      [0, 0, 0, true],
      [1, 292, 0, true],
      [1, 292, 332, true],
      [2, 584, 0, false],
    ],
  );
});
