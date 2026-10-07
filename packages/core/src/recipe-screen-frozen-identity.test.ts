import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AppMapCompiledTest } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { GROK_ANDROID_APP_POLICY } from "./app-identity-policy.js";
import { frozenScreenIdentityObservations } from "./recipe-screen-frozen-identity.js";
import { observeScreenIdentity, observeScreenIdentityForHost } from "./screen-identity.js";
import type { RecipeStep } from "./recipes.js";
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/grok-imagine-workspace.json", import.meta.url), "utf8"),
) as { template: SnapshotNode[]; generated: SnapshotNode[] };
const bytes = Buffer.from(JSON.stringify({ nodes: fixture.template }));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const step: Extract<RecipeStep, { kind: "expect-screen" }> = {
  kind: "expect-screen",
  screenId: "imagine",
  screenTitle: "Imagine",
  fingerprint: observeScreenIdentity(fixture.template).fingerprint,
};
const plan: AppMapCompiledTest = {
  schemaVersion: 1,
  appMapRevision: 1,
  test: { id: "imagine-speed", name: "Imagine Speed", kind: "scenario", intentSchemaVersion: 1 },
  rootRecipeId: "root",
  recipes: { root: { id: "root", title: "Imagine", parameters: [], steps: [step] } },
  stepProvenance: [],
  performance: {
    executableOperations: 0,
    moduleCalls: 0,
    operationCounts: {},
    screenshotCount: 0,
    destinationProofCount: 1,
  },
  startup: { mode: "cold" },
  appMapId: "grok-android",
  runtimeTargetProfile: {
    id: "phone",
    targetId: "phone",
    platform: "android",
    viewport: { width: 1080, height: 2340 },
  },
  rawAccessibilitySourcesByScreenId: {
    imagine: [
      {
        screenId: "imagine",
        variant: {
          id: "v",
          targetProfileId: "phone",
          targetId: "phone",
          platform: "android",
          viewport: { width: 1080, height: 2340 },
        },
        origin: { kind: "screen-variant", observationId: "old-observation", capturedAt: 1 },
        tree: {
          id: "evidence",
          uri: `relay-evidence://${sha256}`,
          sha256,
          bytes: bytes.length,
          mime: "application/json",
        },
      },
    ],
  },
};
const options = { policy: GROK_ANDROID_APP_POLICY };
const readEvidence = async () => bytes;
test("hash-bound frozen template proves generated workspace through the canonical policy", async () => {
  const observations = await frozenScreenIdentityObservations(plan, step, options, {
    readEvidence,
  });
  assert.equal(observations.length, 1);
  assert.equal(
    observations[0]?.fingerprint,
    observeScreenIdentityForHost(fixture.generated, { appMapId: "grok-android" }).fingerprint,
  );
});
test("missing, damaged, unbound or mismatched frozen sources cannot add proof", async () => {
  for (const candidate of [
    { ...plan, rawAccessibilitySourcesByScreenId: {} },
    { ...plan, runtimeTargetProfile: { ...plan.runtimeTargetProfile!, id: "other-phone" } },
    {
      ...plan,
      runtimeTargetProfile: {
        ...plan.runtimeTargetProfile!,
        viewport: { width: 800, height: 600 },
      },
    },
  ])
    assert.deepEqual(
      await frozenScreenIdentityObservations(candidate, step, options, { readEvidence }),
      [],
    );
  assert.deepEqual(
    await frozenScreenIdentityObservations(plan, step, options, {
      readEvidence: async () => Buffer.from("damaged"),
    }),
    [],
  );
  assert.deepEqual(
    await frozenScreenIdentityObservations(plan, { ...step, fingerprint: "unrelated" }, options, {
      readEvidence,
    }),
    [],
  );
  const unbound = structuredClone(plan);
  unbound.rawAccessibilitySourcesByScreenId!.imagine![0]!.origin = { kind: "screen-variant" };
  assert.deepEqual(
    await frozenScreenIdentityObservations(unbound, step, options, { readEvidence }),
    [],
  );
  const partial = structuredClone(plan);
  partial.rawAccessibilitySourcesByScreenId!.imagine!.push({
    ...partial.rawAccessibilitySourcesByScreenId!.imagine![0]!,
    tree: {
      ...partial.rawAccessibilitySourcesByScreenId!.imagine![0]!.tree,
      sha256: "a".repeat(64),
      uri: `relay-evidence://${"a".repeat(64)}`,
    },
  });
  assert.deepEqual(
    await frozenScreenIdentityObservations(partial, step, options, { readEvidence }),
    [],
  );
});

test("frozen owned Home evidence admits its advisory state without changing the recorded criterion", async () => {
  const home = JSON.parse(
    readFileSync(new URL("./fixtures/grok-chat-home-keyboard.json", import.meta.url), "utf8"),
  ).nodes as SnapshotNode[];
  const advisory = JSON.parse(
    readFileSync(new URL("./fixtures/grok-home-advisory.json", import.meta.url), "utf8"),
  ).nodes as SnapshotNode[];
  const homeBytes = Buffer.from(JSON.stringify({ nodes: home }));
  const homeDigest = createHash("sha256").update(homeBytes).digest("hex");
  const homePlan = structuredClone(plan);
  const source = homePlan.rawAccessibilitySourcesByScreenId!.imagine![0]!;
  source.tree = {
    ...source.tree,
    sha256: homeDigest,
    uri: `relay-evidence://${homeDigest}`,
    bytes: homeBytes.length,
  };
  const homeStep = {
    ...step,
    screenTitle: "Grok home",
    fingerprint: observeScreenIdentity(home).fingerprint,
  };
  const frozen = await frozenScreenIdentityObservations(homePlan, homeStep, options, {
    readEvidence: async () => homeBytes,
  });
  assert.equal(frozen.length, 1);
  assert.equal(frozen[0]?.fingerprint, observeScreenIdentity(advisory, options).fingerprint);
  const wrongMode = advisory.map((node) =>
    node.label === "Fast" ? { ...node, label: "Expert", value: "Expert" } : node,
  );
  assert.notEqual(frozen[0]?.fingerprint, observeScreenIdentity(wrongMode, options).fingerprint);
  assert.equal(source.tree.sha256, homeDigest, "the original raw tree remains the proof source");
});
