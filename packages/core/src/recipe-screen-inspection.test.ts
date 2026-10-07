import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "agent-device";
import { JobCancelledError } from "./control.js";
import { IosMutationOutcomeUnknownError } from "./ios-mutation-policy.js";
import { runCampaignCheck } from "./recipe-runner-campaign-checks.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { runExpectScreenStep } from "./recipe-runner-screen.js";
import { runRecipeStep } from "./recipe-runner.js";
import { observeScreenIdentity } from "./screen-identity.js";
import type { TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";
import { deviceTestDouble } from "./testing.js";

const nodes = [{ type: "Button", identifier: "home.control", label: "Home", hittable: true }];
const fingerprint = observeScreenIdentity(nodes).fingerprint;
const screen = {
  kind: "expect-screen" as const,
  id: "relay-source-home",
  screenId: "home",
  screenTitle: "Home",
  fingerprint,
  timeoutMs: 0,
};

function fixture() {
  const targetContext = {
    kind: "browser",
    platform: "browser",
    targetId: "inspection-fixture",
  } as const;
  const job: TestJob = {
    id: "inspection-fixture",
    targetContext,
    action: "saved-native-test",
    status: "running",
    queuedAt: 1,
    attempts: 1,
    platform: "ios",
    targetKind: "device",
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Verify",
    tone: "dim",
    title: "Current screen",
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
    artifacts: [],
    resolvedInputs: {},
  };
  const events: string[] = [];
  const device = deviceTestDouble({
    capture: {
      snapshot: async () => {
        events.push("failure-evidence-read");
        return { nodes };
      },
      screenshot: async () => {
        events.push("failure-evidence-pixels");
        throw new Error("fixture raster unavailable");
      },
    },
    command: { wait: async () => {} },
    interactions: {
      press: async () => {
        events.push("input");
      },
      type: async () => {
        events.push("input");
      },
    },
  });
  const ctx: RecipeStepContext = {
    job,
    runtime: {},
    log: (line) => job.logs.push(line),
    observeVisualFingerprint: async () => fingerprint,
  };
  const run = <T>(operation: () => Promise<T>) => runWithTargetContext(targetContext, operation);
  return { job, events, device, ctx, run };
}

async function caught(
  operation: () => Promise<void>,
): Promise<Error & { inspection?: Record<string, unknown> }> {
  try {
    await operation();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  assert.fail("Expected unproven screen inspection to reject");
}

test("actual screen failure distinguishes a twice-failed read from successful empty AX without leaking driver text", async () => {
  const value = fixture();
  let reads = 0;
  const failure = Object.assign(
    new Error("Timed out reading usbmux: private-token=secret AX payload"),
    { code: "MAIN_THREAD_TIMEOUT" },
  );
  const error = await caught(() =>
    value.run(() =>
      runExpectScreenStep(value.device, screen, value.ctx, {
        observeSnapshot: async () => {
          reads += 1;
          throw failure;
        },
      }),
    ),
  );
  assert.equal(error.name, "RecipeScreenInspectionError");
  assert.equal(error.inspection?.state, "failed-read");
  assert.equal(error.inspection?.stage, "semantic-read");
  assert.equal(error.inspection?.readAttempts, 2);
  assert.deepEqual(error.inspection?.cause, { category: "timeout", code: "MAIN_THREAD_TIMEOUT" });
  assert.match(error.message, /^screen-inspection-unavailable:/);
  assert.doesNotMatch(JSON.stringify(error) + error.message, /secret|private-token|AX payload/);
  assert.equal(reads, 2);
  assert.equal(value.ctx.runtime?.navigationCursor?.status, "unknown");
  assert.equal(value.ctx.runtime?.observation, undefined);
});

test("successful empty AX stays unproven even when its empty fingerprint is explicitly expected", async () => {
  const value = fixture();
  const error = await caught(() =>
    value.run(() =>
      runExpectScreenStep(
        value.device,
        { ...screen, fingerprint: observeScreenIdentity([]).fingerprint },
        value.ctx,
        { observeSnapshot: async () => [] },
      ),
    ),
  );
  assert.equal(error.name, "RecipeScreenInspectionError");
  assert.equal(error.inspection?.state, "empty-success");
  assert.equal(error.inspection?.readAttempts, 1);
  assert.equal(error.inspection?.cause, undefined);
  assert.equal(value.ctx.runtime?.navigationCursor?.status, "unknown");
});

test("a successful retry preserves the existing two-read policy and proves the current screen", async () => {
  const value = fixture();
  let reads = 0;
  await value.run(() =>
    runExpectScreenStep(value.device, screen, value.ctx, {
      observeSnapshot: async () => {
        if (++reads === 1) throw new Error("snapshot timed out");
        return nodes;
      },
    }),
  );
  assert.equal(reads, 2);
  assert.equal(value.ctx.runtime?.navigationCursor?.status, "proven");
});

test("permanent semantic read failure remains one attempt with a controlled cause", async () => {
  const value = fixture();
  let reads = 0;
  const error = await caught(() =>
    value.run(() =>
      runExpectScreenStep(value.device, screen, value.ctx, {
        observeSnapshot: async () => {
          reads += 1;
          throw new Error("permission denied for private-user");
        },
      }),
    ),
  );
  assert.equal(error.inspection?.state, "failed-read");
  assert.deepEqual(error.inspection?.cause, { category: "permission-denied" });
  assert.equal(reads, 1);
});

for (const [runnerErrorCode, category] of [
  ["MAIN_THREAD_TIMEOUT", "timeout"],
  ["RUNNER_BUSY", "runner-busy"],
] as const) {
  test(`actual screen failure retains only ${runnerErrorCode} from normalized SDK errors`, async () => {
    const value = fixture();
    const failure = new AppError("COMMAND_FAILED", "SDK capture failed: private-driver-payload", {
      runnerErrorCode,
      logPath: "/private/runner.log",
      privateDetail: "private-AX-payload",
    });
    const error = await caught(() =>
      value.run(() =>
        runExpectScreenStep(value.device, screen, value.ctx, {
          observeSnapshot: async () => {
            throw failure;
          },
        }),
      ),
    );
    assert.equal(error.name, "RecipeScreenInspectionError");
    assert.deepEqual(error.inspection?.cause, { category, code: runnerErrorCode });
    assert.doesNotMatch(
      error.message + JSON.stringify(value.job.artifacts),
      /private-driver|private-AX|private\/runner|COMMAND_FAILED/,
    );
  });
}

for (const mode of ["empty", "failed"] as const) {
  test(`ordinary stabilization cannot turn a fresh ${mode} AX read into destination proof`, async () => {
    const value = fixture();
    let reads = 0;
    const error = await caught(() =>
      value.run(async () => {
        await runExpectScreenStep(
          value.device,
          { ...screen, evidenceSurface: "ordinary" },
          value.ctx,
          {
            observeSnapshot: async () => {
              if (++reads === 1) return nodes;
              if (mode === "empty") return [];
              throw new AppError("COMMAND_FAILED", "snapshot timed out: private-stabilization", {
                runnerErrorCode: "MAIN_THREAD_TIMEOUT",
              });
            },
          },
        );
        value.events.push("dependent-input");
        await runRecipeStep(value.device, { kind: "tap", target: { label: "Home" } }, value.ctx);
      }),
    );
    assert.equal(value.ctx.runtime?.navigationCursor?.status, "unknown");
    assert.equal(value.events.includes("dependent-input"), false);
    assert.equal(error.name, "RecipeScreenInspectionError");
    assert.equal(error.inspection?.state, mode === "empty" ? "empty-success" : "failed-read");
    assert.equal(error.inspection?.stage, "semantic-read");
    assert.equal(error.inspection?.readAttempts, mode === "empty" ? 1 : 2);
    assert.equal(reads, mode === "empty" ? 2 : 3);
    if (mode === "failed")
      assert.deepEqual(error.inspection?.cause, {
        category: "timeout",
        code: "MAIN_THREAD_TIMEOUT",
      });
    assert.equal(value.ctx.runtime?.observation, undefined);
    assert.equal(value.events.includes("input"), false);
    assert.ok(
      value.job.artifacts.some((artifact) => artifact.kind === "screen-inspection-failure"),
    );
    assert.doesNotMatch(error.message, /private-stabilization/);
  });
}

test("a raster read failure retains its actual stage without exposing its driver payload", async () => {
  const value = fixture();
  value.ctx.observeVisualFingerprint = async () => {
    throw Object.assign(new Error("connection reset: private-raster-payload"), {
      code: "ECONNRESET",
    });
  };
  const error = await caught(() =>
    value.run(() =>
      runExpectScreenStep(value.device, { ...screen, fingerprint: "different-screen" }, value.ctx, {
        observeSnapshot: async () => nodes,
      }),
    ),
  );
  assert.equal(error.inspection?.stage, "raster-read");
  assert.equal(error.inspection?.state, "failed-read");
  assert.deepEqual(error.inspection?.cause, {
    category: "transport-unavailable",
    code: "ECONNRESET",
  });
  assert.doesNotMatch(error.message + JSON.stringify(error), /private-raster-payload/);
});

test("a later raster error cannot replace the primary failed semantic read", async () => {
  const value = fixture();
  value.ctx.observeVisualFingerprint = async () => {
    throw new Error("raster timed out: private-raster-payload");
  };
  const error = await caught(() =>
    value.run(() =>
      runExpectScreenStep(value.device, screen, value.ctx, {
        observeSnapshot: async () => {
          throw new Error("permission denied: private-AX-payload");
        },
      }),
    ),
  );
  assert.equal(error.inspection?.stage, "semantic-read");
  assert.deepEqual(error.inspection?.cause, { category: "permission-denied" });
  assert.deepEqual((error as Error & { rasterFailure?: unknown }).rasterFailure, {
    category: "timeout",
  });
  assert.doesNotMatch(
    error.message + JSON.stringify(error),
    /private-AX-payload|private-raster-payload/,
  );
});

test("cancellation and unknown input remain terminal without a second semantic read", async () => {
  const unknown = new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation: "press",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: { attempts: 0, decision: "blocked", reason: "native-command-outcome-unknown" },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 1,
    },
    new Error("unknown error: native acknowledgement unavailable"),
  );
  for (const failure of [
    new JobCancelledError("fixture"),
    new JobCancelledError("snapshot timed out"),
    unknown,
  ]) {
    const value = fixture();
    let reads = 0;
    const error = await caught(() =>
      value.run(() =>
        runExpectScreenStep(value.device, screen, value.ctx, {
          observeSnapshot: async () => {
            reads += 1;
            throw failure;
          },
        }),
      ),
    );
    assert.equal(error, failure);
    assert.equal(reads, 1);
  }
});

test("actual failed prerequisite is retained before propagation and cannot be overwritten by cleanup or dependent response", async () => {
  const value = fixture();
  let primary: Error | undefined;
  value.ctx.runtime!.responseBoundaryUnavailable = {};
  const result = await caught(() =>
    value.run(async () => {
      await runCampaignCheck(
        value.device,
        {
          kind: "sleep",
          ms: 0,
          check: {
            id: "reach-home",
            title: "Reach Home",
            recovery: { groupId: "home", recipeId: "reach-home", mode: "warm-transition" },
            cleanup: { recipeId: "cleanup", terminalScreenId: "home", onCancel: "skip" },
          },
        },
        value.ctx,
        async (recipeId) => {
          if (recipeId) {
            value.events.push("cleanup-input");
            return;
          }
          primary = await caught(() =>
            runExpectScreenStep(value.device, screen, value.ctx, {
              observeSnapshot: async () => {
                throw new Error("permission denied");
              },
            }),
          );
          throw primary;
        },
      );
      value.events.push("dependent-response");
      await runRecipeStep(
        value.device,
        { kind: "wait-response", target: { label: "Copy" }, timeoutMs: 0 },
        value.ctx,
      );
    }),
  );
  assert.equal(result, primary);
  assert.match(result.message, /^screen-inspection-unavailable:/);
  assert.equal(value.events.includes("dependent-response"), false);
  assert.equal(value.events.includes("cleanup-input"), false);
  assert.equal(value.events.includes("input"), false);
  assert.ok(value.events.includes("failure-evidence-read"));
  const evidence = value.job.artifacts.find(
    (artifact) => artifact.kind === "campaign-check-evidence",
  );
  const retained = value.job.artifacts.find(
    (artifact) => artifact.kind === "campaign-check-result",
  );
  assert.equal((retained?.data as { status?: string })?.status, "failed");
  assert.equal((retained?.data as { error?: string })?.error, primary?.message);
  assert.equal((evidence?.data as { error?: string })?.error, primary?.message);
  assert.equal(
    value.ctx.runtime?.navigationCursor?.status,
    "unknown",
    "later healthy failure evidence is not prerequisite proof",
  );
  assert.equal(value.ctx.runtime?.deferredCampaignChecks?.length ?? 0, 0);
});

test("ordinary screen mismatch remains a retained campaign failure that can continue", async () => {
  const value = fixture();
  await value.run(() =>
    runCampaignCheck(
      value.device,
      { kind: "sleep", ms: 0, check: { id: "ordinary-mismatch", title: "Expected screen" } },
      value.ctx,
      async () => {
        await runExpectScreenStep(
          value.device,
          { ...screen, fingerprint: "different-screen" },
          value.ctx,
          { observeSnapshot: async () => nodes },
        );
      },
    ),
  );
  assert.equal(
    (
      value.job.artifacts.find((artifact) => artifact.kind === "campaign-check-result")?.data as {
        status?: string;
      }
    ).status,
    "failed",
  );
});
