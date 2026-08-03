import assert from "node:assert/strict";
import test from "node:test";
import type {
  DiscoverySession,
  CanvasGraph,
  ObservedScreen,
  ObservedTransition,
} from "@relay/protocol";
import { canonicalDiscoveryScreenId, importDiscoveryAppMap } from "./discovery-app-map-import.js";

// Discovery proposals must merge into the same canonical App Map.

const screen = (id: string, capturedAt: number, fingerprint = id): ObservedScreen => ({
  id,
  fingerprint,
  title: id[0]!.toUpperCase() + id.slice(1),
  capturedAt,
});

const transition = (
  id: string,
  fromScreenId: string,
  toScreenId: string | undefined,
  capturedAt: number,
  kind: ObservedTransition["kind"] = "tap",
): ObservedTransition => ({
  id,
  fromScreenId,
  ...(toScreenId ? { toScreenId } : {}),
  kind,
  label: id,
  ...(kind === "tap" ? { target: { label: id } } : {}),
  capturedAt,
  changedScreen: fromScreenId !== toScreenId,
});

const session = (
  screens: ObservedScreen[],
  transitions: ObservedTransition[],
): DiscoverySession => ({
  id: "discovery-auth",
  name: "Authentication",
  targetId: "iphone",
  scope: { maxScreens: 20, maxTransitions: 40, maxDurationMs: 60_000 },
  status: "complete",
  createdAt: 1,
  updatedAt: 100,
  screens,
  transitions,
});

test("imports branches and deduplicates screen observations by fingerprint", () => {
  const source = session(
    [
      screen("home-first", 1, "home-stable"),
      { ...screen("home-again", 2, "home-stable"), title: "Duplicate home" },
      screen("email", 3),
      screen("sso", 4),
    ],
    [
      transition("Use email", "home-first", "email", 10),
      transition("Use SSO", "home-again", "sso", 20),
    ],
  );

  const { graph, warnings } = importDiscoveryAppMap(source);
  const homeId = canonicalDiscoveryScreenId("home-stable");
  assert.equal(graph.screens.length, 3);
  const home = graph.screens.find((item) => item.id === homeId);
  assert.equal(home?.title, "Home-first");
  assert.equal(home?.identity?.fingerprint, "home-stable");
  assert.deepEqual(
    home?.observations?.map((observation) => [
      observation.source,
      observation.sessionId,
      observation.externalId,
    ]),
    [
      ["discovery", "discovery-auth", "home-first"],
      ["discovery", "discovery-auth", "home-again"],
    ],
  );
  assert.deepEqual(
    graph.transitions.map((item) => [item.fromScreenId, item.destination, item.label]),
    [
      [homeId, { kind: "screen", screenId: canonicalDiscoveryScreenId("email") }, "Use email"],
      [homeId, { kind: "screen", screenId: canonicalDiscoveryScreenId("sso") }, "Use SSO"],
    ],
  );
  assert.deepEqual(
    graph.flows.map((flow) => [flow.name, flow.screenId]),
    [["Authentication", homeId]],
  );
  assert.deepEqual(warnings, []);
});

test("preserves cycles and marks an observed back edge as a return", () => {
  const { graph } = importDiscoveryAppMap(
    session(
      [screen("home", 1), screen("settings", 2)],
      [
        transition("Open settings", "home", "settings", 10),
        transition("Go back", "settings", "home", 20, "back"),
      ],
    ),
  );

  assert.equal(graph.transitions.length, 2);
  assert.equal(graph.transitions[0]?.kind, "forward");
  assert.equal(graph.transitions[1]?.kind, "return");
  assert.deepEqual(graph.transitions[1]?.destination, {
    kind: "screen",
    screenId: canonicalDiscoveryScreenId("home"),
  });
  assert.ok(graph.transitions.every((item) => item.state === "needs-recording"));
  assert.ok(graph.transitions.every((item) => item.stepIds.length === 0));
  assert.deepEqual(graph.transitions[1]?.provenance, {
    source: "discovery",
    externalId: "Go back",
    sessionId: "discovery-auth",
  });
});

test("merges a discovery fingerprint into an already canonical authored screen", () => {
  const existing: CanvasGraph = {
    schemaVersion: 1,
    screens: [
      {
        id: "screen-home",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "canonical-home" },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    transitions: [],
    flows: [],
  };
  const observed = screen("observed-home", 10, "known-fingerprint");
  observed.identity = { schemaVersion: 1, fingerprint: "canonical-home" };

  const { graph } = importDiscoveryAppMap(session([observed], []), existing);
  assert.equal(graph.screens.length, 1);
  assert.equal(graph.screens[0]?.id, "screen-home");
  assert.equal(graph.screens[0]?.observations?.[0]?.externalId, "observed-home");
  assert.equal(graph.flows[0]?.screenId, "screen-home");
});

test("merges repeatedly into an existing graph without mutation or duplication", () => {
  const observed = session(
    [screen("home", 1), screen("profile", 2)],
    [transition("Open profile", "home", "profile", 10)],
  );
  const existing: CanvasGraph = {
    schemaVersion: 1,
    screens: [{ id: "authored", title: "Authored", createdAt: 0, updatedAt: 0 }],
    transitions: [],
    flows: [],
  };
  const existingSnapshot = structuredClone(existing);
  const first = importDiscoveryAppMap(observed, existing);
  const second = importDiscoveryAppMap(observed, first.graph);

  assert.deepEqual(existing, existingSnapshot);
  assert.notEqual(first.graph, existing);
  assert.deepEqual(second.graph, first.graph);
  assert.deepEqual(second.warnings, first.warnings);
  assert.equal(second.graph.screens.length, 3);
  assert.equal(second.graph.transitions.length, 1);
  assert.equal(second.graph.flows.length, 1);
});

test("warns about incomplete observations without inventing destinations or actions", () => {
  const observed = session(
    [screen("home", 1), screen("details", 2)],
    [
      transition("Unknown destination", "home", "missing", 10),
      transition("No destination", "home", undefined, 20),
      transition("Manual jump", "home", "details", 30, "manual"),
    ],
  );

  const { graph, warnings } = importDiscoveryAppMap(observed);
  assert.equal(graph.transitions.length, 1);
  assert.equal(graph.transitions[0]?.label, "Manual jump");
  assert.deepEqual(graph.transitions[0]?.stepIds, []);
  assert.equal(graph.transitions[0]?.state, "needs-recording");
  assert.deepEqual(
    warnings.map((warning) => warning.code),
    [
      "missing-transition-destination",
      "missing-transition-destination",
      "non-replayable-transition",
    ],
  );
});
