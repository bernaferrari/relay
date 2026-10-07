import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GROK_ANDROID_APP_POLICY } from "./app-identity-policy.js";
import type { Device, SnapshotNode } from "./device.js";
import { runExpectScreenStep } from "./recipe-runner-screen.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { RecipeStep } from "./recipes.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { nativeWorkspaceIdentityNodes } from "./screen-identity-native-workspace.js";

// Physical Fast Chat Run 8d8a5ae5: the captured keyboard/focus state was
// already approved as a Home alias. Keep geometry to reproduce the mask.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/grok-chat-home-keyboard.json", import.meta.url), "utf8"),
) as {
  approvedFingerprint: string;
  nodes: SnapshotNode[];
  ignoreRegions: NonNullable<Extract<RecipeStep, { kind: "expect-screen" }>["ignoreRegions"]>;
};
const home = observeScreenIdentity(fixture.nodes);
const step: Extract<RecipeStep, { kind: "expect-screen" }> = {
  kind: "expect-screen",
  screenId: "home",
  screenTitle: "Grok home",
  fingerprint: "8905d9d49815a790cc6677e2908a9d1d12d130e2c6a894cf67751b431ac4bf48",
  aliases: [fixture.approvedFingerprint],
  observations: [home],
  ignoreRegions: fixture.ignoreRegions,
  timeoutMs: 0,
};
const device = {
  command: { wait: async () => assert.fail("identity proof must not operate the device") },
} as unknown as Device;
function context(): RecipeStepContext {
  return {
    runtime: { identityPolicy: GROK_ANDROID_APP_POLICY },
    log: () => undefined,
    observeVisualFingerprint: async () => undefined,
  };
}

test("physical Home mask cannot invalidate an exact approved full semantic alias", async () => {
  assert.equal(home.fingerprint, fixture.approvedFingerprint);
  assert.equal(
    home.nodes.some((node) => "rect" in node),
    false,
  );
  assert.notEqual(
    observeScreenIdentity(fixture.nodes, { ignoreRegions: fixture.ignoreRegions }).fingerprint,
    fixture.approvedFingerprint,
  );
  assert.notEqual(
    nativeWorkspaceIdentityNodes(fixture.nodes, GROK_ANDROID_APP_POLICY),
    fixture.nodes,
  );
  const ctx = context();
  await runExpectScreenStep(device, step, ctx, {
    observeSnapshot: async () => fixture.nodes,
    getLocalization: async () => assert.fail("exact approved proof needs no locale lookup"),
  });
  assert.equal(ctx.runtime?.navigationCursor?.status, "proven");
});

test("a mask adds no full semantic proof for an unapproved captured state", async () => {
  const artifacts: NonNullable<RecipeStepContext["artifacts"]> = [];
  const ctx = { ...context(), artifacts } satisfies RecipeStepContext;
  let reads = 0;
  await assert.rejects(
    runExpectScreenStep(device, { ...step, aliases: [], observations: [] }, ctx, {
      observeSnapshot: async () => {
        reads += 1;
        return fixture.nodes;
      },
      getLocalization: async () => undefined,
    }),
    /expect-screen:/u,
  );
  assert.equal(reads, 1, "mismatch retention must not take a later snapshot");
  const tree = ctx.artifacts.find((artifact) => artifact.kind === "ui-tree")?.data as {
    phase: string;
    fingerprint: string;
    unmaskedFingerprint: string;
    nodesSha256: string;
    nodes: SnapshotNode[];
  };
  assert.equal(tree.phase, "destination-mismatch");
  assert.equal(
    tree.unmaskedFingerprint,
    observeScreenIdentity(fixture.nodes, { policy: GROK_ANDROID_APP_POLICY }).fingerprint,
  );
  assert.notEqual(tree.fingerprint, tree.unmaskedFingerprint);
  assert.deepEqual(tree.nodes, fixture.nodes);
  assert.notEqual(tree.nodes, fixture.nodes, "retain the assessed tree as immutable evidence");
  assert.equal(
    tree.nodesSha256,
    createHash("sha256").update(JSON.stringify(tree.nodes)).digest("hex"),
  );
});

test("an approved Home alias cannot admit a different app through its mask", async () => {
  const differentApp: SnapshotNode[] = [
    {
      type: "android.widget.TextView",
      label: "Files",
      bundleId: "com.example.files",
      identifier: "com.example.files:id/title",
      rect: { x: 0, y: 0, width: 1080, height: 2340 },
      visibleToUser: true,
    },
  ];
  await assert.rejects(
    runExpectScreenStep(device, step, context(), {
      observeSnapshot: async () => differentApp,
      getLocalization: async () => undefined,
    }),
    /expect-screen:/u,
  );
});
