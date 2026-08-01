import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  currentOperationContext,
  runWithOperationContext,
  saveCompatibilityMatrix,
  saveRecipe,
  writeJourney,
  type EnqueueJobInput,
  type OperationContext,
} from "@relay/core";
import type { DeviceLease, JourneyGraph } from "@relay/protocol";
import { enqueueCompatibilityBatch, type CompatibilityBatchRuntime } from "./compatibility-jobs.js";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";

const projectId = "compatibility-graph-project";
const scope: RequestContext = {
  subject: "human:compatibility-test",
  organizationId: "relay",
  projectId,
  allowedProjects: [projectId],
  tokenKind: "local",
  localTrusted: true,
};

function operation(id: string): OperationContext {
  return {
    schemaVersion: 1,
    organizationId: scope.organizationId,
    projectId,
    actorId: scope.subject,
    actorKind: "human",
    operationId: id,
    requestId: `${id}-request`,
    idempotencyKey: `${id}-key`,
    issuedAt: Date.now(),
  };
}

async function withState<T>(run: () => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "relay-compatibility-graph-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    legacyState: process.env.GROK_DEVICE_STATE_DIR,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = root;
  process.env.GROK_DEVICE_STATE_DIR = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  try {
    return await run();
  } finally {
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.legacyState === undefined) delete process.env.GROK_DEVICE_STATE_DIR;
    else process.env.GROK_DEVICE_STATE_DIR = previous.legacyState;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
}

function mobileRuntime(enqueued: EnqueueJobInput[]) {
  const leaseContexts: Array<{ targetId: string; leaseId?: string }> = [];
  const enqueue: CompatibilityBatchRuntime["enqueueJob"] = (input) => {
    enqueued.push(structuredClone(input));
    leaseContexts.push({
      targetId: input.serial!,
      leaseId: currentOperationContext()?.leaseId,
    });
    return input as unknown as ReturnType<CompatibilityBatchRuntime["enqueueJob"]>;
  };
  const control: CompatibilityBatchRuntime["assertTargetControl"] = async (_scope, targetId) =>
    ({
      id: `lease-${targetId}`,
      projectId,
      poolId: "mobile",
      deviceSerial: targetId!,
      ownerId: scope.subject,
      status: "leased",
      leasedAt: 1,
      expiresAt: Date.now() + 60_000,
    }) satisfies DeviceLease;
  const runtime: Partial<CompatibilityBatchRuntime> = {
    listDevices: async () => [
      {
        id: "android-device",
        name: "Pixel",
        serial: "android-1",
        kind: "Pixel 9",
        booted: true,
        platform: "android",
        osVersion: "16",
      },
      {
        id: "ios-device",
        name: "iPhone",
        serial: "ios-1",
        kind: "iPhone 17",
        booted: true,
        platform: "ios",
        osVersion: "19.0",
      },
    ],
    listTargets: async () => [],
    assertTargetControl: control,
    enqueueJob: enqueue,
  };
  return { runtime, leaseContexts };
}

async function saveMobileMatrix() {
  return saveCompatibilityMatrix({
    id: "mobile-release",
    projectId,
    name: "Mobile release",
    selectors: [{ platforms: ["ios", "android"] }],
  });
}

function checkoutGraph(): JourneyGraph {
  return {
    schemaVersion: 1,
    screens: [
      { id: "home", title: "Home", createdAt: 1, updatedAt: 1 },
      { id: "cart", title: "Cart", createdAt: 1, updatedAt: 1 },
    ],
    flows: [{ id: "checkout", name: "Checkout", screenId: "home", createdAt: 1, updatedAt: 1 }],
    transitions: [
      {
        id: "open-cart",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "cart" },
        stepIds: ["tap-cart"],
        state: "recorded",
        kind: "forward",
        review: { status: "verified", updatedAt: 1, verifiedAt: 1 },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "submit-order",
        fromScreenId: "cart",
        destination: { kind: "end" },
        stepIds: ["shared-checkout"],
        state: "recorded",
        kind: "forward",
        review: { status: "verified", updatedAt: 1, verifiedAt: 1 },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };
}

test("freezes one Journey path and reusable graph across iOS and Android profiles", async () => {
  await withState(() =>
    runWithOperationContext(operation("compatibility.graph.run"), async () => {
      await saveRecipe({
        id: "shared-checkout-flow",
        expectedRevision: 0,
        title: "Shared checkout",
        steps: [{ id: "confirm", kind: "tap", target: { label: "Confirm" } }],
      });
      await saveRecipe({
        id: "unused-flow",
        expectedRevision: 0,
        title: "Unused flow",
        steps: [{ kind: "sleep", ms: 999 }],
      });
      const recipe = await saveRecipe({
        id: "checkout-journey",
        expectedRevision: 0,
        title: "Checkout journey",
        steps: [
          { id: "tap-cart", kind: "tap", target: { label: "Cart" } },
          { id: "shared-checkout", kind: "module", recipeId: "shared-checkout-flow" },
          { id: "unrelated", kind: "module", recipeId: "unused-flow" },
        ],
      });
      await writeJourney(projectId, recipe.id, {
        expectedRevision: 0,
        value: {
          schemaVersion: 6,
          positions: {},
          edgeLabels: {},
          edgeKinds: {},
          graph: checkoutGraph(),
        },
      });
      await saveMobileMatrix();

      const enqueued: EnqueueJobInput[] = [];
      const { runtime, leaseContexts } = mobileRuntime(enqueued);
      const batch = await enqueueCompatibilityBatch(
        scope,
        {
          recipe: recipe.id,
          matrixId: "mobile-release",
          flowName: "Checkout",
          transitionPath: ["open-cart", "submit-order"],
        },
        { kind: "compatibility", maxRepetitions: 20, maxJobs: 200 },
        runtime,
      );

      assert.equal(batch.jobs.length, 2);
      assert.deepEqual(
        enqueued.map((job) => [job.serial, job.platform]),
        [
          ["android-1", "android"],
          ["ios-1", "ios"],
        ],
      );
      for (const job of enqueued) {
        assert.deepEqual(
          job.recipeSnapshot?.steps.map((step) => step.id),
          ["tap-cart", "shared-checkout"],
        );
        assert.deepEqual(Object.keys(job.recipeGraph ?? {}).sort(), [
          "checkout-journey",
          "shared-checkout-flow",
        ]);
        assert.equal(job.projectId, projectId);
        assert.equal(job.ownerId, scope.subject);
        assert.equal(job.targetProfile?.targetId, job.serial);
      }
      const plans = enqueued.map(
        (job) => job.artifacts?.find((artifact) => artifact.kind === "journey-graph-plan")?.data,
      );
      assert.deepEqual(plans[0], plans[1]);
      assert.deepEqual((plans[0] as { transitionIds?: string[] }).transitionIds, [
        "open-cart",
        "submit-order",
      ]);
      assert.deepEqual(leaseContexts, [
        { targetId: "android-1", leaseId: "lease-android-1" },
        { targetId: "ios-1", leaseId: "lease-ios-1" },
      ]);
    }),
  );
});

test("keeps whole-recipe compatibility execution unchanged when no flow is selected", async () => {
  await withState(() =>
    runWithOperationContext(operation("compatibility.recipe.run"), async () => {
      const recipe = await saveRecipe({
        id: "legacy-whole-recipe",
        expectedRevision: 0,
        title: "Whole recipe",
        steps: [
          { id: "first", kind: "tap", target: { label: "Continue" } },
          { id: "second", kind: "expect", target: { label: "Done" }, condition: "visible" },
        ],
      });
      await saveMobileMatrix();
      const enqueued: EnqueueJobInput[] = [];
      const { runtime } = mobileRuntime(enqueued);

      await enqueueCompatibilityBatch(
        scope,
        { recipe: recipe.id, matrixId: "mobile-release" },
        { kind: "compatibility", maxRepetitions: 20, maxJobs: 200 },
        runtime,
      );

      assert.equal(enqueued.length, 2);
      assert.deepEqual(
        enqueued.map((job) => job.recipeSnapshot?.steps.map((step) => step.id)),
        [
          ["first", "second"],
          ["first", "second"],
        ],
      );
      assert.ok(
        enqueued.every(
          (job) => !job.artifacts?.some((artifact) => artifact.kind === "journey-graph-plan"),
        ),
      );
    }),
  );
});

test("rejects missing and invalid Journey graph path input with actionable errors", async () => {
  await assert.rejects(
    enqueueCompatibilityBatch(
      scope,
      { recipe: "checkout", matrixId: "mobile-release", transitionPath: ["open-cart"] },
      { kind: "compatibility", maxRepetitions: 20, maxJobs: 200 },
    ),
    (error) =>
      error instanceof HttpError &&
      error.status === 400 &&
      error.message === "flowName is required when transitionPath is provided",
  );

  await withState(() =>
    runWithOperationContext(operation("compatibility.graph.invalid"), async () => {
      const recipe = await saveRecipe({
        id: "graph-input-errors",
        expectedRevision: 0,
        title: "Graph input errors",
        steps: [{ id: "tap-cart", kind: "tap", target: { label: "Cart" } }],
      });
      await saveMobileMatrix();
      const { runtime } = mobileRuntime([]);
      const missingGraph = await writeJourney(projectId, recipe.id, {
        expectedRevision: 0,
        value: {
          schemaVersion: 6,
          positions: {},
          edgeLabels: {},
          edgeKinds: {},
        },
      });
      await assert.rejects(
        enqueueCompatibilityBatch(
          scope,
          { recipe: recipe.id, matrixId: "mobile-release", flowName: "Checkout" },
          { kind: "compatibility", maxRepetitions: 20, maxJobs: 200 },
          runtime,
        ),
        (error) =>
          error instanceof HttpError &&
          error.status === 409 &&
          /has no canonical graph/.test(error.message),
      );

      await writeJourney(projectId, recipe.id, {
        expectedRevision: missingGraph.revision,
        value: {
          schemaVersion: 6,
          positions: {},
          edgeLabels: {},
          edgeKinds: {},
          graph: checkoutGraph(),
        },
      });
      await assert.rejects(
        enqueueCompatibilityBatch(
          scope,
          {
            recipe: recipe.id,
            matrixId: "mobile-release",
            flowName: "Checkout",
            transitionPath: ["not-a-transition"],
          },
          { kind: "compatibility", maxRepetitions: 20, maxJobs: 200 },
          runtime,
        ),
        (error) =>
          error instanceof HttpError &&
          error.status === 409 &&
          /Journey graph path is invalid: Transition "not-a-transition" does not exist/.test(
            error.message,
          ),
      );
    }),
  );
});
