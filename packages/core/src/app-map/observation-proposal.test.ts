import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, DiscoverySession } from "@relay/protocol";
import { proposalFromDiscovery } from "./observation-proposal.js";

test("discovery becomes a target-covered App Map proposal without mutating the map", () => {
  const map: AppMap = {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Product",
    revision: 0,
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
  const session: DiscoverySession = {
    id: "session",
    name: "Checkout exploration",
    targetId: "pixel",
    targetProfile: {
      id: "profile-pixel",
      name: "Pixel",
      source: "device",
      platform: "android",
      targetId: "pixel",
      capabilities: ["snapshot", "screenshot", "tap"],
      observedAt: 2,
    },
    scope: {
      maxScreens: 10,
      maxTransitions: 10,
      maxDurationMs: 60_000,
      allowSensitiveControls: false,
    },
    status: "complete",
    createdAt: 2,
    updatedAt: 4,
    screens: [
      { id: "home", fingerprint: "home", title: "Home", capturedAt: 2 },
      {
        id: "cart",
        fingerprint: "cart",
        title: "Cart",
        capturedAt: 3,
        screenshotPath: "screens/cart.png",
      },
    ],
    transitions: [
      {
        id: "open-cart",
        fromScreenId: "home",
        toScreenId: "cart",
        kind: "tap",
        label: "Open cart",
        target: { label: "Cart" },
        capturedAt: 4,
        changedScreen: true,
      },
    ],
  };

  const proposal = proposalFromDiscovery({ map, session, proposalId: "proposal", at: 5 });
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.baseRevision, 0);
  assert.equal(proposal.changes.filter((change) => change.kind === "screen.add").length, 2);
  assert.equal(proposal.changes.filter((change) => change.kind === "connection.connect").length, 1);
  const cart = proposal.changes.find(
    (change) => change.kind === "screen.add" && change.input.screen.title === "Cart",
  );
  assert.equal(cart?.kind === "screen.add" ? cart.input.variants?.[0]?.evidenceIds.length : 0, 1);
  assert.equal(Object.keys(map.screens).length, 0);
});
