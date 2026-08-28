import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppMap,
  Connection,
  LogicalScrollSurface,
  Screen,
  ScreenVariant,
} from "@relay/protocol";
import { classifyGraphExplorationControl, proposeGraphExploration } from "./graph-exploration.js";

const scope = { organizationId: "org", projectId: "project", appMapId: "settings" };
const evidence = <T extends "image/png" | "application/json">(id: string, mime: T) => ({
  id,
  uri: `relay://evidence/${id}`,
  sha256: "a".repeat(64),
  mime,
  bytes: 1,
});

function screen(id: string, variantIds: string[] = []): Screen {
  return {
    ...scope,
    id,
    title: id,
    identity: { schemaVersion: 1, fingerprint: id.padEnd(64, "a").slice(0, 64) },
    variantIds,
    createdAt: 1,
    updatedAt: 1,
  };
}

function connection(id: string, from: string, to: string, label: string): Connection {
  return {
    ...scope,
    id,
    fromScreenId: from,
    destination: { kind: "screen", screenId: to },
    label,
    state: "ready",
    actions: [
      {
        id: `${id}-tap`,
        kind: "tap",
        target: { identifier: label.toLocaleLowerCase().replaceAll(" ", "-") },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

function fixture(): AppMap {
  const labels = [
    ["appearance", "Appearance", "Button"],
    ["kids", "Kids Mode", "Switch"],
    ["privacy", "Privacy", "Cell"],
    ["noop", "View memory", "Button"],
    ["language", "App Language", "Button"],
    ["delete", "Delete account", "Button"],
    ["mystery", "Mystery", "TextView"],
  ] as const;
  const surface: LogicalScrollSurface = {
    schemaVersion: 1,
    id: "settings-surface",
    captureId: "capture-2",
    targetProfileId: "android",
    capturePolicy: {
      captureMode: "full-surface",
      source: "explicit",
      reason: "test",
      decidedAt: 1,
    },
    capturedAt: 2,
    status: "completed",
    reason: "end-of-content",
    message: "complete",
    restoredStartViewport: true,
    viewports: [],
    mergedTree: { ...evidence("tree", "application/json"), nodeCount: labels.length },
    manifest: evidence("manifest", "application/json"),
    semanticIndex: {
      schemaVersion: 1,
      documentHeight: 1_600,
      viewportHeight: 800,
      // Deliberately shuffled: proposal order comes from the document index.
      anchors: labels
        .map(([id], index) => ({
          order: index,
          documentY: (index + 1) * 100,
          target: { identifier: id },
          label: labels[index]![1],
          role: labels[index]![2],
        }))
        .reverse(),
    },
  };
  const variant: ScreenVariant = {
    ...scope,
    id: "settings-android",
    screenId: "settings",
    targetProfile: {
      id: "android",
      name: "Pixel",
      source: "device",
      platform: "android",
      targetId: "pixel",
      capabilities: ["snapshot", "tap"],
      observedAt: 1,
    },
    observation: {
      fingerprint: "s".repeat(64),
      nodes: labels.map(([id, label, role]) => ({ identifier: id, label, role })),
      volatileSignals: [],
    },
    evidenceIds: [],
    scrollSurfaces: [surface],
    createdAt: 1,
    updatedAt: 2,
  };
  const openAppearance = connection("open-appearance", "settings", "appearance", "Appearance");
  return {
    schemaVersion: 1,
    id: "settings",
    organizationId: "org",
    projectId: "project",
    name: "Settings",
    revision: 7,
    notes: {},
    groups: {},
    screens: {
      settings: screen("settings", [variant.id]),
      appearance: screen("appearance"),
      "kids-enabled": screen("kids-enabled"),
    },
    screenVariants: { [variant.id]: variant },
    connections: {
      [openAppearance.id]: openAppearance,
      "return-appearance": connection("return-appearance", "appearance", "settings", "Back"),
      "return-kids": connection("return-kids", "kids-enabled", "settings", "Back"),
    },
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
    updatedAt: 2,
  };
}

test("classifies unsafe and stateful controls conservatively", () => {
  const control = {
    key: "label:kids mode",
    label: "Kids Mode",
    role: "Switch",
    target: { label: "Kids Mode" },
    documentOrder: 1,
    documentY: 200,
  };
  assert.equal(classifyGraphExplorationControl({ control }).decision, "defer");
  assert.deepEqual(classifyGraphExplorationControl({ control, cleanupProven: true }), {
    classification: "reversible",
    decision: "explore",
    reason: "The state change has a complete reviewed cleanup path.",
  });
  assert.equal(
    classifyGraphExplorationControl({
      control: { ...control, label: "Delete account", role: "Button" },
    }).classification,
    "destructive",
  );
  for (const label of ["Send message", "Post", "Allow", "Install", "Create account", "Enviar"]) {
    assert.deepEqual(
      classifyGraphExplorationControl({
        control: { ...control, label, role: "Button" },
      }),
      {
        classification: "unknown",
        decision: "defer",
        reason:
          "An unreviewed control cannot prove navigation or the absence of external effects from its label and role.",
      },
    );
  }
});

test("builds one deterministic review-only exploration proposal from a semantic surface", () => {
  const map = fixture();
  const before = structuredClone(map);
  const proposal = proposeGraphExploration({
    map,
    sourceScreenId: "settings",
    testId: "settings-exploration",
    actorId: "agent:planner",
    at: 10,
    observations: [
      {
        controlKey: "identifier:kids",
        outcome: {
          kind: "screen",
          destinationScreenId: "kids-enabled",
          cleanupConnectionIds: ["return-kids"],
        },
      },
      {
        controlKey: "identifier:noop",
        outcome: { kind: "no-op", reason: "User-owned content is intentionally not traversed." },
      },
    ],
    frontier: [
      {
        controlKey: "identifier:privacy",
        factors: {
          novelty: 90,
          coverageValue: 95,
          changedCodeRelevance: 88,
          uncertaintyReduction: 80,
          executionCost: 30,
        },
      },
    ],
  });

  assert.deepEqual(map, before);
  assert.equal(proposal.status, "review-required");
  assert.deepEqual(
    proposal.decisions.map((decision) => decision.control.label),
    [
      "Appearance",
      "Kids Mode",
      "Privacy",
      "View memory",
      "App Language",
      "Delete account",
      "Mystery",
    ],
  );
  assert.deepEqual(
    Object.fromEntries(
      proposal.decisions.map((decision) => [
        decision.control.label,
        [decision.classification, decision.decision],
      ]),
    ),
    {
      "View memory": ["no-op", "skip"],
      "App Language": ["external", "defer"],
      Privacy: ["unknown", "defer"],
      "Kids Mode": ["reversible", "skip"],
      Appearance: ["navigation", "skip"],
      "Delete account": ["destructive", "defer"],
      Mystery: ["unknown", "defer"],
    },
  );
  assert.equal(proposal.proposedConnections.length, 1);
  assert.equal(proposal.proposedConnections[0]?.label, "Kids Mode");
  assert.deepEqual(
    proposal.proposedConnections[0]?.actions.map((action) => action.kind),
    ["reveal", "tap"],
  );
  assert.equal(proposal.proposedConnections[0]?.state, "draft");
  assert.equal(
    proposal.decisions.find((decision) => decision.control.label === "Privacy")?.policy?.level,
    "prohibited",
  );
  assert.equal(
    proposal.decisions.find((decision) => decision.control.label === "Delete account")?.policy
      ?.level,
    "destructive",
  );
  assert.equal(
    proposal.decisions.find((decision) => decision.control.label === "Mystery")?.policy?.level,
    "prohibited",
  );
  assert.ok(
    proposal.decisions
      .filter((decision) => decision.decision === "explore")
      .every((decision) => decision.policy?.level === "safe"),
  );
  assert.equal(
    proposal.frontier?.entries.find((entry) => entry.actionId === "identifier:privacy")?.rationale
      .changedCodeRelevance,
    88,
  );
  assert.equal(proposal.proposedTest.steps.length, 7);
  assert.deepEqual(proposal.proposedTest.surfaceBindings?.[0], {
    screenId: "settings",
    variantId: "settings-android",
    captureMode: "full-surface",
    reason: "Stable semantic document order for graph-native exploration",
    surfaceId: "settings-surface",
    baselineCaptureId: "capture-2",
    compare: "visual-and-semantic",
    repair: "propose-recapture",
  });
  assert.deepEqual(proposal.summary, {
    controls: 7,
    explore: 0,
    skipped: 3,
    deferred: 4,
    proposedConnections: 1,
  });
});

test("rejects an observed reversible state without a complete ready cleanup path", () => {
  const map = fixture();
  delete map.connections["return-kids"];
  const proposal = proposeGraphExploration({
    map,
    sourceScreenId: "settings",
    testId: "settings-exploration",
    actorId: "agent:planner",
    at: 10,
    observations: [
      {
        controlKey: "identifier:kids",
        outcome: {
          kind: "screen",
          destinationScreenId: "kids-enabled",
          cleanupConnectionIds: ["open-appearance"],
        },
      },
    ],
  });
  const kids = proposal.decisions.find((decision) => decision.control.label === "Kids Mode");
  assert.deepEqual([kids?.classification, kids?.decision], ["unknown", "defer"]);
  assert.equal(
    proposal.proposedConnections.some((connection) => connection.label === "Kids Mode"),
    false,
  );
});
