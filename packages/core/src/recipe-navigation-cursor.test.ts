import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  currentVerifiedScreen,
  invalidateVerifiedScreen,
  markNavigationExternalHandoff,
  proveNavigationDestination,
  proveNavigationScreen,
  type NavigationProofCursor,
  type RecipeRuntimeState,
  type RecipeStepContext,
  type VerifiedScreenCheckpoint,
} from "./recipe-runner-context.js";
import type { TestJob } from "./session-contract.js";

function context(): RecipeStepContext & {
  runtime: RecipeRuntimeState;
  job: TestJob;
} {
  return {
    log: () => {},
    runtime: { campaignCoverageStarted: true },
    job: { id: "cursor-run", artifacts: [] } as unknown as TestJob,
  };
}

function checkpoint(screenId: string, at = 100): VerifiedScreenCheckpoint {
  return {
    screenId,
    screenTitle: screenId,
    nodes: [{ role: "heading", label: screenId }],
    observedAt: at,
    verifiedAt: at,
  };
}

describe("navigation proof cursor", () => {
  it("keeps one canonical proven location and invalidates it after mutation", () => {
    const ctx = context();
    const settings = checkpoint("settings");

    proveNavigationScreen(ctx, settings);
    assert.equal(ctx.runtime.navigationCursor?.status, "proven");
    assert.equal(currentVerifiedScreen(ctx.runtime), settings);

    invalidateVerifiedScreen(ctx);
    const unknown = ctx.runtime.navigationCursor as NavigationProofCursor | undefined;
    assert.equal(unknown?.status, "unknown");
    assert.deepEqual(unknown?.status === "unknown" ? unknown.previous : undefined, {
      screenId: "settings",
      proofToken: "cursor-run:settings:100",
    });
    assert.equal(currentVerifiedScreen(ctx.runtime), undefined);
  });

  it("records transition, cleanup, and external-handoff states as immutable run evidence", () => {
    const ctx = context();

    proveNavigationDestination(ctx, {
      screenId: "kids-enabled",
      source: "transition",
      at: 200,
    });
    proveNavigationDestination(ctx, {
      screenId: "kids-off",
      source: "cleanup",
      at: 300,
    });
    markNavigationExternalHandoff(ctx, "com.android.settings", "App Language opened Settings.");

    assert.equal(ctx.runtime.navigationCursor?.status, "external-handoff");
    assert.deepEqual(
      ctx.job.artifacts
        .filter((artifact) => artifact.kind === "navigation-proof-cursor")
        .map((artifact) => artifact.data),
      [
        {
          schemaVersion: 1,
          status: "proven",
          screenId: "kids-enabled",
          proofToken: "cursor-run:transition:kids-enabled:200",
          source: "transition",
          updatedAt: 200,
        },
        {
          schemaVersion: 1,
          status: "proven",
          screenId: "kids-off",
          proofToken: "cursor-run:cleanup:kids-off:300",
          source: "cleanup",
          updatedAt: 300,
        },
        {
          schemaVersion: 1,
          status: "external-handoff",
          foregroundApp: "com.android.settings",
          reason: "App Language opened Settings.",
          updatedAt: ctx.runtime.navigationCursor?.updatedAt,
          previous: {
            screenId: "kids-off",
            proofToken: "cursor-run:cleanup:kids-off:300",
          },
        },
      ],
    );
  });
});
