import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, DiscoverySession } from "@relay/protocol";
import {
  proposalFromDiscovery,
  proposalFromObservedEdge,
  discoveryLandChanges,
  matchingScreenId,
} from "./observation-proposal.js";
import type { ProposedNavigationEdge } from "./navigation-observation.js";
import { compileIntentWalk } from "./intent-walk.js";
import { connectionIdsFromProposal } from "./keep-prove.js";

function emptyMap(): AppMap {
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Product",
    revision: 0,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function session(): DiscoverySession {
  return {
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
}

test("discovery becomes a target-covered App Map proposal without mutating the map", () => {
  const map = emptyMap();
  const proposal = proposalFromDiscovery({
    map,
    session: session(),
    proposalId: "proposal",
    at: 5,
  });
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

test("one observed edge carries a draft navigation contract for Keep", () => {
  const edge: ProposedNavigationEdge = {
    action: { kind: "tap", label: "Cart" },
    targetAlternatives: [{ kind: "accessibility", label: "Cart" }],
    sourceIdentity: { schemaVersion: 1, fingerprint: "home" },
    destinationIdentity: { schemaVersion: 1, fingerprint: "cart" },
    confidence: 0.72,
    reasons: ["test"],
  };
  const proposal = proposalFromObservedEdge({
    map: emptyMap(),
    session: session(),
    proposalId: "edge",
    transitionId: "open-cart",
    edge,
    at: 5,
  });
  const connection = proposal.changes.find((change) => change.kind === "connection.connect");
  assert.equal(connection?.kind, "connection.connect");
  if (connection?.kind !== "connection.connect") throw new Error("expected connection");
  assert.equal(connection.connection.state, "draft");
  assert.equal(connection.connection.navigation?.targetAlternatives[0]?.kind, "accessibility");
  assert.equal(connection.connection.navigation?.expectedDestination.evidenceIds.length, 1);
  assert.deepEqual(connectionIdsFromProposal(proposal), [connection.connection.id]);
});

test("English compiles onto ready edges and stays stuck when the map has none", () => {
  const map = emptyMap();
  const stuck = compileIntentWalk(map, "Cover Settings");
  assert.equal(stuck.status, "stuck");
  const scope = { organizationId: "org", projectId: "project", appMapId: "map" };
  map.screens.home = {
    ...scope,
    id: "home",
    title: "Settings",
    identity: { schemaVersion: 1, fingerprint: "home" },
    position: { x: 0, y: 0 },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.screens.language = {
    ...scope,
    id: "language",
    title: "Language",
    identity: { schemaVersion: 1, fingerprint: "language" },
    position: { x: 1, y: 0 },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.connections.open = {
    ...scope,
    id: "open",
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "language" },
    label: "Language",
    state: "ready",
    actions: [{ id: "a", kind: "tap", target: { label: "Language" } }],
    createdAt: 1,
    updatedAt: 1,
  };
  const compiled = compileIntentWalk(map, "Language");
  assert.equal(compiled.status, "compiled");
  if (compiled.status === "compiled") assert.deepEqual(compiled.connectionIds, ["open"]);
  map.connections.open = { ...map.connections.open!, state: "draft" };
  const draft = compileIntentWalk(map, "Language");
  assert.equal(draft.status, "stuck");
  if (draft.status === "stuck") assert.match(draft.missing, /draft/i);
});

test("crawl lands named draft screens without a navigation contract", () => {
  const map = emptyMap();
  const changes = discoveryLandChanges({
    map,
    session: session(),
    transitionId: "open-cart",
  });
  const screens = changes.filter((change) => change.kind === "screen.add");
  const connection = changes.find((change) => change.kind === "connection.create");
  assert.equal(screens.length, 2);
  assert.deepEqual(
    screens.map((change) => (change.kind === "screen.add" ? change.input.screen.title : "")),
    ["Home", "Cart"],
  );
  assert.ok(
    screens.every(
      (change) =>
        change.kind === "screen.add" &&
        /^[a-f0-9]{64}$/.test(change.input.screen.identity?.fingerprint ?? ""),
    ),
  );
  assert.equal(connection?.kind, "connection.create");
  if (connection?.kind !== "connection.create") throw new Error("expected connection");
  assert.equal(connection.connection.state, "draft");
  assert.equal(connection.connection.navigation, undefined);
  for (const change of changes) {
    if (change.kind === "screen.add") map.screens[change.input.screen.id] = change.input.screen;
    if (change.kind === "connection.create")
      map.connections[change.connection.id] = change.connection;
  }
  assert.equal(
    discoveryLandChanges({ map, session: session(), transitionId: "open-cart" }).length,
    0,
  );
});

test("matchingScreenId keeps Memory, Kids Mode, and NSFW distinct under shared chrome", () => {
  const map = emptyMap();
  const scope = { organizationId: "org", projectId: "project", appMapId: "map" };
  const shared = "shared-settings-chrome";
  map.screens.memory = {
    ...scope,
    id: "memory",
    title: "Memory",
    identity: { schemaVersion: 1, fingerprint: shared },
    position: { x: 0, y: 0 },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.screens.kids = {
    ...scope,
    id: "kids",
    title: "Kids Mode",
    identity: { schemaVersion: 1, fingerprint: shared, aliases: ["kids-alias"] },
    position: { x: 1, y: 0 },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  assert.equal(matchingScreenId(map, shared, "Memory"), "memory");
  assert.equal(matchingScreenId(map, shared, "Kids Mode"), "kids");
  assert.equal(matchingScreenId(map, shared, "NSFW Preferences"), undefined);
  assert.equal(matchingScreenId(map, shared, "Settings"), undefined);
});

test("land prefers Settings child labels over a misleading Settings title", () => {
  const map = emptyMap();
  const settingsSession: DiscoverySession = {
    ...session(),
    screens: [
      { id: "hub", fingerprint: "hub", title: "Settings", capturedAt: 2 },
      {
        id: "child",
        fingerprint: "shared-chrome",
        title: "Settings",
        capturedAt: 3,
        screenshotPath: "screens/child.png",
      },
    ],
    transitions: [
      {
        id: "open-nsfw",
        fromScreenId: "hub",
        toScreenId: "child",
        kind: "tap",
        label: "NSFW Preferences",
        capturedAt: 4,
        changedScreen: true,
      },
    ],
  };
  const changes = discoveryLandChanges({
    map,
    session: settingsSession,
    transitionId: "open-nsfw",
  });
  const titles = changes
    .filter((change) => change.kind === "screen.add")
    .map((change) => (change.kind === "screen.add" ? change.input.screen.title : ""));
  assert.deepEqual(titles.sort(), ["NSFW Preferences", "Settings"]);
});
