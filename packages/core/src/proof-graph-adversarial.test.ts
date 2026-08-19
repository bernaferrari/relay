import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "./device.js";
import { runCampaignCheck } from "./recipe-runner-campaign-checks.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { RecipeStep } from "./recipes.js";
import type { TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";

type Check = NonNullable<RecipeStep["check"]>;

const settings = {
  connectionId: "open-settings",
  originScreenId: "home",
  destination: { kind: "screen" as const, screenId: "settings" },
  expectedApp: "ai.x.grok",
};

const profile = {
  connectionId: "open-profile",
  originScreenId: "home",
  destination: { kind: "screen" as const, screenId: "profile" },
  expectedApp: "ai.x.grok",
};

const recovery = {
  groupId: "transition:open-settings",
  recipeId: "confirm-open-settings",
  transitionId: "open-settings",
  mode: "warm-transition" as const,
  coldRecipeId: "cold-open-settings-review-only",
};

function check(id: string, dependencies = [settings], patch: Partial<Check> = {}): Check {
  return {
    id,
    title: id,
    transitionDependencies: dependencies,
    recovery,
    ...patch,
  };
}

function device(): Device {
  return {
    capture: {
      snapshot: async () => ({
        nodes: [
          {
            identifier: "settings",
            label: "Settings",
            visibleToUser: true,
            rect: { x: 20, y: 40, width: 300, height: 80 },
          },
        ],
      }),
    },
  } as unknown as Device;
}

function context(id: string): RecipeStepContext & { job: TestJob } {
  return {
    log: () => {},
    runtime: {},
    job: { id, artifacts: [] } as unknown as TestJob,
  };
}

function sourceProvenRecipe(id: string, screenId: string) {
  return {
    id,
    title: `Confirm ${screenId}`,
    source: "custom" as const,
    steps: [
      {
        kind: "expect-screen" as const,
        id: `relay-source-${id}`,
        screenId,
        screenTitle: screenId,
        fingerprint: `${screenId}-fingerprint`,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

async function run(
  ctx: RecipeStepContext,
  value: Check,
  execute: (recipeId?: string) => Promise<void>,
): Promise<void> {
  await runWithTargetContext(
    { kind: "device", platform: "android", serial: "proof-graph-model" },
    () => runCampaignCheck(device(), { kind: "sleep", ms: 1, check: value }, ctx, execute),
  );
}

function resultStatuses(ctx: RecipeStepContext): Array<{ id: string; status: string }> {
  return (ctx.job?.artifacts ?? []).flatMap((artifact) => {
    if (artifact.kind !== "campaign-check-result") return [];
    const data = artifact.data as { id?: string; status?: string };
    return data.id && data.status ? [{ id: data.id, status: data.status }] : [];
  });
}

test("a broken shared edge blocks unrelated work until its own origin is proven", async () => {
  const ctx = context("model-shared-edge");
  ctx.recipeGraph = {
    [recovery.recipeId]: sourceProvenRecipe(recovery.recipeId, settings.originScreenId),
  };
  const executions: string[] = [];

  await run(ctx, check("missing-reset"), async () => {
    executions.push("missing-reset:warm");
    ctx.job.artifacts.push({
      kind: "target-resolution-attempt",
      capturedAt: Date.now(),
      data: { selector: { identifier: "reset-available" }, outcome: "absent" },
    });
    throw new Error("Reset Available is absent after locale reflow");
  });
  await run(ctx, check("privacy"), async (recipeId) => {
    executions.push(`privacy:${recipeId ?? "warm"}`);
    throw new Error("Settings confirmation remained ambiguous");
  });
  await run(ctx, check("help"), async () => {
    executions.push("help:must-not-run");
  });
  await run(ctx, check("profile", [profile], { recovery: undefined }), async () => {
    executions.push("profile:warm");
  });

  assert.deepEqual(executions, ["missing-reset:warm", "privacy:confirm-open-settings"]);
  assert.deepEqual(resultStatuses(ctx), [
    { id: "privacy", status: "failed" },
    { id: "help", status: "blocked" },
    { id: "profile", status: "blocked" },
  ]);
  assert.equal(ctx.runtime?.campaignTransitionProofs?.[settings.connectionId]?.status, "open");
  assert.equal(
    ctx.runtime?.campaignTransitionProofs?.[profile.connectionId],
    undefined,
    "an unrelated edge is not independent until its own origin is proven",
  );

  const intervention = ctx.job.artifacts.find(
    (artifact) => artifact.kind === "campaign-recovery-intervention",
  )?.data as
    | {
        status?: string;
        transitionId?: string;
        attemptedSelectors?: unknown[];
        accessibility?: { available?: boolean; nodeCount?: number };
        nodes?: unknown[];
        screenshot?: { caption?: string };
        recovery?: { proposedColdRecipeId?: string; implicitResumeAllowed?: boolean };
      }
    | undefined;
  assert.equal(intervention?.status, "intervention-required");
  assert.equal(intervention?.transitionId, settings.connectionId);
  assert.equal(intervention?.accessibility?.available, true);
  assert.equal(intervention?.accessibility?.nodeCount, 1);
  assert.equal(intervention?.nodes?.length, 1);
  assert.match(intervention?.screenshot?.caption ?? "", /^sos:cold-recovery:/);
  assert.equal(intervention?.recovery?.proposedColdRecipeId, "cold-open-settings-review-only");
  assert.equal(intervention?.recovery?.implicitResumeAllowed, false);
  assert.equal(
    ctx.job.artifacts.some(
      (artifact) =>
        artifact.kind === "navigation-proof-cursor" &&
        (artifact.data as { status?: string }).status === "unknown",
    ),
    true,
  );
  assert.equal(
    executions.some((entry) => entry.includes("cold-open-settings")),
    false,
    "a proposed cold path is never executable campaign recovery",
  );
});

test("an unknown cursor confirms only the independently source-proven leaf", async () => {
  const ctx = context("model-stale-terminal");
  ctx.runtime!.navigationCursor = {
    status: "unknown",
    reason: "Add to home return did not prove Settings",
    updatedAt: 1,
    previous: { screenId: "add-to-home", proofToken: "old-terminal" },
  };
  const navigation = {
    connectionId: "open-navigation",
    originScreenId: "home",
    destination: { kind: "screen" as const, screenId: "settings" },
    expectedApp: "ai.x.grok",
  };
  const advanced = {
    connectionId: "open-advanced",
    originScreenId: "settings",
    destination: { kind: "screen" as const, screenId: "advanced" },
    expectedApp: "ai.x.grok",
  };
  const executed: string[] = [];
  ctx.recipeGraph = {
    "confirm-open-advanced": sourceProvenRecipe("confirm-open-advanced", "settings"),
  };

  await run(
    ctx,
    check("advanced-after-failed-return", [navigation, advanced], {
      warmSourceScreenId: "add-to-home",
      recovery: {
        groupId: "transition:open-advanced",
        recipeId: "confirm-open-advanced",
        transitionId: "open-advanced",
        mode: "warm-transition",
      },
    }),
    async (recipeId) => {
      executed.push(recipeId ?? "stale-warm-path");
    },
  );

  assert.deepEqual(executed, ["confirm-open-advanced"]);
  assert.equal(ctx.runtime?.campaignTransitionProofs?.[navigation.connectionId], undefined);
  assert.equal(ctx.runtime?.campaignTransitionProofs?.[advanced.connectionId]?.status, "verified");
  const finalCursor = ctx.runtime?.navigationCursor as
    | { status: string; screenId?: string }
    | undefined;
  assert.equal(finalCursor?.status, "proven");
  assert.equal(finalCursor?.status === "proven" ? finalCursor.screenId : undefined, "advanced");
});

test("r173 Birth Year drift blocks every stale warm mutation behind one evidence root", async () => {
  const ctx = context("90560436-r173");
  ctx.runtime!.navigationCursor = {
    status: "unknown",
    reason: "Birth Year destination did not prove its reviewed return",
    updatedAt: 173,
    previous: { screenId: "birth-year", proofToken: "90560436:birth-year" },
  };
  const settingsToSuperGrok = {
    connectionId: "open-supergrok",
    originScreenId: "settings",
    destination: { kind: "screen" as const, screenId: "supergrok" },
    expectedApp: "ai.x.grok",
  };
  const settingsToUsage = {
    connectionId: "open-usage",
    originScreenId: "settings",
    destination: { kind: "screen" as const, screenId: "usage" },
    expectedApp: "ai.x.grok",
  };
  const mutations: string[] = [];

  for (const value of [
    check("visit-04-supergrok", [settingsToSuperGrok], {
      warmSourceScreenId: "birth-year",
      recovery: undefined,
    }),
    check("visit-05-usage", [settingsToUsage], {
      warmSourceScreenId: "supergrok",
      recovery: undefined,
    }),
    check("visit-06-privacy", [settingsToUsage], {
      warmSourceScreenId: "settings",
      recovery: undefined,
    }),
  ]) {
    await run(ctx, value, async (recipeId) => {
      mutations.push(recipeId ?? `${value.id}:stale-warm`);
    });
  }

  assert.deepEqual(mutations, [], "no Back, tap, reveal, cleanup, or warm recipe may run");
  assert.deepEqual(resultStatuses(ctx), [
    { id: "visit-04-supergrok", status: "blocked" },
    { id: "visit-05-usage", status: "blocked" },
    { id: "visit-06-privacy", status: "blocked" },
  ]);
  const firewalls = ctx.job.artifacts.filter(
    (artifact) => artifact.kind === "campaign-cursor-firewall",
  );
  assert.equal(firewalls.length, 1, "one unknown cursor produces one root Problem, not a cascade");
  const evidence = firewalls[0]!.data as {
    status?: string;
    stoppedMutations?: boolean;
    expected?: { originScreenId?: string; leafTransition?: { connectionId?: string } };
    observed?: { cursor?: { status?: string; reason?: string }; screenIdentity?: unknown };
    attemptedSelectors?: unknown[];
    accessibility?: { available?: boolean; nodeCount?: number };
    nodes?: unknown[];
    screenshot?: { caption?: string };
    repair?: { action?: string; implicitMutationAllowed?: boolean };
  };
  assert.equal(evidence.status, "blocked-before-mutation");
  assert.equal(evidence.stoppedMutations, true);
  assert.equal(evidence.expected?.originScreenId, "birth-year");
  assert.equal(evidence.expected?.leafTransition?.connectionId, "open-supergrok");
  assert.equal(evidence.observed?.cursor?.status, "unknown");
  assert.match(evidence.observed?.cursor?.reason ?? "", /Birth Year/u);
  assert.deepEqual(evidence.attemptedSelectors, []);
  assert.deepEqual(evidence.accessibility, { available: true, nodeCount: 1 });
  assert.equal(evidence.nodes?.length, 1);
  assert.match(evidence.screenshot?.caption ?? "", /visit-04-supergrok/u);
  assert.equal(evidence.repair?.action, "prove-origin-or-teach-canonical-leaf");
  assert.equal(evidence.repair?.implicitMutationAllowed, false);
  assert.equal(
    ctx.job.artifacts
      .filter((artifact) => artifact.kind === "campaign-check-result")
      .every(
        (artifact) =>
          (artifact.data as { stoppedMutations?: boolean; evidenceCapturedAt?: number })
            .stoppedMutations === true &&
          typeof (artifact.data as { evidenceCapturedAt?: number }).evidenceCapturedAt === "number",
      ),
    true,
  );
  assert.equal(ctx.runtime?.navigationCursor?.status, "unknown");
});

test("a failed stateful cleanup remains visible and invalidates the cursor", async () => {
  const ctx = context("model-cleanup");
  const cleanupCheck = check("kids-mode", [settings], {
    recovery: undefined,
    cleanup: {
      recipeId: "ensure-kids-off",
      terminalScreenId: "kids-off",
      onCancel: "skip",
    },
  });

  await run(ctx, cleanupCheck, async (recipeId) => {
    if (recipeId === "ensure-kids-off") throw new Error("Kids Mode still enabled");
  });

  assert.deepEqual(resultStatuses(ctx), [{ id: "kids-mode", status: "failed" }]);
  assert.equal(ctx.runtime?.navigationCursor?.status, "unknown");
  assert.match(
    ctx.runtime?.navigationCursor?.status === "unknown" ? ctx.runtime.navigationCursor.reason : "",
    /Kids Mode still enabled/,
  );
  const cleanup = ctx.job.artifacts.find((artifact) => artifact.kind === "campaign-check-cleanup")
    ?.data as { status?: string; terminalScreenId?: string; error?: string } | undefined;
  assert.equal(cleanup?.status, "failed");
  assert.equal(cleanup?.terminalScreenId, "kids-off");
  assert.equal(cleanup?.error, "Kids Mode still enabled");
});

test("the same perturbation seed produces the same campaign outcome", async () => {
  async function simulate(seed: number): Promise<{
    executed: string[];
    results: Array<{ id: string; status: string }>;
  }> {
    const ordered = ["usage", "privacy", "help", "advanced"];
    const ctx = context(`model-seed-${seed}`);
    const executed: string[] = [];
    for (const [index, id] of ordered.entries()) {
      await run(ctx, check(id, [profile], { recovery: undefined }), async () => {
        executed.push(id);
        if ((seed + index) % 3 === 0) throw new Error(`seeded drift at ${id}`);
      });
    }
    return { executed, results: resultStatuses(ctx) };
  }

  assert.deepEqual(await simulate(2), await simulate(2));
  assert.notDeepEqual(await simulate(1), await simulate(2));
});
