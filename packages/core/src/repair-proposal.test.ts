import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, Screen } from "@relay/protocol";
import { proposeRepair } from "./repair-proposal.js";
import type { DestinationRepairHint, RepairMapSource } from "./repair-proposal.js";
import { StubVisionGrounder, type Grounder } from "./grounding.js";

const scope = { organizationId: "org", projectId: "project", appMapId: "map" };

function screen(id: string, fingerprint: string): Screen {
  return {
    ...scope,
    id,
    title: id,
    identity: { schemaVersion: 1, fingerprint },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function mapFixture(): AppMap {
  const home = screen("home", "a".repeat(64));
  const settings = screen("settings", "b".repeat(64));
  const usage = screen("usage", "c".repeat(64));
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Map",
    revision: 7,
    notes: {},
    groups: {},
    screens: { home, settings, usage },
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

function failure(overrides: Partial<DestinationRepairHint> = {}): DestinationRepairHint {
  return {
    expectedScreenId: "settings",
    expectedScreenTitle: "Settings",
    expectedFingerprint: "b".repeat(64),
    observedScreenTitle: "Usage",
    resolutionMethod: "a11y+visual",
    ...overrides,
  };
}

/** A grounder that always "sees" the given screen title with its confidence. */
function visionGrounder(
  label: string,
  confidence: number,
  calls: Array<{ target: string; screenshotBase64?: string }> = [],
): Grounder {
  return {
    async groundVision(request) {
      calls.push({
        target: request.target,
        ...(request.screenshotBase64 ? { screenshotBase64: request.screenshotBase64 } : {}),
      });
      return { interaction: { kind: "label", label }, confidence };
    },
  };
}

test("stub grounder yields zero proposals with reason grounding-unavailable", async () => {
  const result = await proposeRepair({
    failure: failure({ observedFingerprint: "a".repeat(64) }),
    map: mapFixture(),
    grounder: new StubVisionGrounder(),
  });
  assert.deepEqual(result, { available: false, proposals: [], reason: "grounding-unavailable" });
});

test("missing grounder yields zero proposals with reason grounding-unavailable", async () => {
  const result = await proposeRepair({
    failure: failure({ observedFingerprint: "a".repeat(64) }),
    map: mapFixture(),
  });
  assert.equal(result.available, false);
  assert.deepEqual(result.proposals, []);
});

const nonStub = visionGrounder("Settings", 0.9);

test("exact observed fingerprint proposes that screen at confidence 1", async () => {
  const result = await proposeRepair({
    failure: failure({ observedFingerprint: "a".repeat(64) }),
    map: mapFixture(),
    grounder: nonStub,
  });
  assert.ok(result.available);
  const top = result.proposals[0];
  assert.ok(top);
  assert.equal(top.candidateScreenId, "home");
  assert.equal(top.confidence, 1);
  assert.equal(top.method, "fingerprint");
});

test("proposals are ranked by descending confidence", async () => {
  // The exact fingerprint match (home, confidence 1) must outrank the
  // vision-only match (usage) that the grounder supplies.
  const result = await proposeRepair({
    failure: failure({ observedFingerprint: "a".repeat(64) }),
    map: mapFixture(),
    grounder: visionGrounder("Usage", 0.6),
    observationAccess: { screenshotBase64: async () => Buffer.from("x").toString("base64") },
  });
  assert.ok(result.available);
  assert.ok(result.proposals.length >= 2, "both the fingerprint and vision proposals appear");
  const confidences = result.proposals.map((proposal) => proposal.confidence);
  assert.deepEqual(
    [...confidences].sort((left, right) => right - left),
    confidences,
    `expected descending order, got ${JSON.stringify(confidences)}`,
  );
  assert.equal(result.proposals[0]?.candidateScreenId, "home");
  assert.equal(result.proposals[0]?.method, "fingerprint");
  const usage = result.proposals.find((proposal) => proposal.candidateScreenId === "usage");
  assert.ok(usage);
  assert.equal(usage.method, "vision");
  assert.equal(result.proposals.at(-1)?.confidence, usage.confidence);
});

test("vision-only match is proposed when no fingerprint agrees", async () => {
  const calls: Array<{ target: string; screenshotBase64?: string }> = [];
  const result = await proposeRepair({
    failure: failure({ observedFingerprint: "f".repeat(64) }),
    map: mapFixture(),
    grounder: visionGrounder("usage", 0.75, calls),
    observationAccess: {
      nodes: async () => [{ role: "heading", label: "Usage", visibleToUser: true }],
      screenshotBase64: async () => Buffer.from("pixels").toString("base64"),
    },
  });
  assert.ok(result.available);
  assert.equal(calls.length, 1, "the grounder was consulted exactly once");
  assert.ok(calls[0]!.screenshotBase64, "the observation pixels were supplied");
  const top = result.proposals[0];
  assert.ok(top);
  assert.equal(top.candidateScreenId, "usage");
  assert.equal(top.method, "vision");
  assert.ok(top.confidence > 0 && top.confidence <= 1);
});

test("an unknown vision answer produces zero proposals without error", async () => {
  const result = await proposeRepair({
    failure: failure({ observedFingerprint: "f".repeat(64) }),
    map: mapFixture(),
    grounder: visionGrounder("Not A Screen Title", 0.9),
    observationAccess: { screenshotBase64: async () => Buffer.from("x").toString("base64") },
  });
  assert.ok(result.available);
  assert.deepEqual(result.proposals, []);
});

test("a throwing vision provider degrades to zero vision proposals", async () => {
  const failingVision: Grounder = {
    async groundVision() {
      throw new Error("provider outage");
    },
  };
  const result = await proposeRepair({
    failure: failure({ observedFingerprint: "f".repeat(64) }),
    map: mapFixture(),
    grounder: failingVision,
    observationAccess: { screenshotBase64: async () => Buffer.from("x").toString("base64") },
  });
  assert.ok(result.available);
  assert.deepEqual(result.proposals, []);
});

test("proposal generation never mutates App Map state", async () => {
  const original = mapFixture();
  (original.screens.usage!.variantIds as string[]) = ["usage-v1"];
  (original as { screenVariants: Record<string, unknown> }).screenVariants["usage-v1"] = {
    ...scope,
    id: "usage-v1",
    screenId: "usage",
    targetProfile: {
      id: "p1",
      targetId: "serial-1",
      platform: "android",
      source: "device",
      createdAt: 1,
      updatedAt: 1,
    },
    observation: { fingerprint: "d".repeat(64), nodes: [], volatileSignals: [] },
    evidenceIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const before = structuredClone(original);
  await proposeRepair({
    failure: failure({ observedFingerprint: "d".repeat(64) }),
    map: original,
    grounder: visionGrounder("Settings", 0.8),
    observationAccess: {
      nodes: async () => [{ role: "heading", label: "Usage" }],
      screenshotBase64: async () => Buffer.from("x").toString("base64"),
    },
  });
  assert.deepEqual(original, before, "the App Map must be untouched by proposal generation");

  // Also true for a read-only projection source.
  const projection: RepairMapSource = {
    screens: structuredClone(original.screens),
    screenVariants: structuredClone(
      (original as unknown as { screenVariants: Record<string, never> }).screenVariants,
    ),
  };
  const projectedBefore = structuredClone(projection);
  await proposeRepair({
    failure: failure({ observedFingerprint: "d".repeat(64) }),
    map: projection,
    grounder: nonStub,
  });
  assert.deepEqual(projection, projectedBefore);
});

test("aliases participate in exact fingerprint matching", async () => {
  const aliased = mapFixture();
  aliased.screens.settings!.identity = {
    schemaVersion: 1,
    fingerprint: "b".repeat(64),
    aliases: [alias()],
  };
  const result = await proposeRepair({
    failure: failure({ observedFingerprint: alias() }),
    map: aliased,
    grounder: nonStub,
  });
  assert.ok(result.available);
  assert.equal(result.proposals[0]?.candidateScreenId, "settings");
  assert.equal(result.proposals[0]?.confidence, 1);

  function alias(): string {
    return "e".repeat(64);
  }
});
