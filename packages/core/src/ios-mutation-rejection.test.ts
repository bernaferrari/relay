import assert from "node:assert/strict";
import test from "node:test";
import {
  IosMutationOutcomeUnknownError,
  IosMutationRejectedError,
  IosNativeMutationError,
  iosSelectorWasNotDispatched,
  lastIosMutationAttemptDiagnostic,
} from "./ios-mutation-policy.js";
import { classifyRunOutcome } from "./outcomes.js";
import { runRecipeStep } from "./recipe-runner.js";
import { runCampaignCheck } from "./recipe-runner-campaign-checks.js";
import { runMappedPrelude } from "./recipe-runner-tour.js";
import { classifySessionError } from "./session-job-support.js";
import type { RecipeStep } from "./recipes.js";
import type { TestJob } from "./session-contract.js";
import { runWithTargetContext } from "./target-context.js";
import { deviceTestDouble } from "./testing.js";
import { runIosMutationOnce } from "./ios-mutation-policy.js";

for (const code of ["AMBIGUOUS_MATCH", "ELEMENT_OFFSCREEN"] as const) {
  for (const path of ["optional-recipe", "campaign", "tour-prelude"] as const) {
    test(`${path} stops after proven ${code} without fallback, cleanup or sibling input`, async () => {
      const serial = `rejected-${path}-${code}`;
      const nativeError = new IosNativeMutationError(
        code === "AMBIGUOUS_MATCH" ? "selector matched multiple elements" : "element is offscreen",
        code,
        "no",
      );
      const presses: string[] = [];
      const logs: string[] = [];
      const job = { id: serial, artifacts: [] } as unknown as TestJob;
      const device = deviceTestDouble({
        capture: {
          snapshot: async () => ({
            nodes: [
              {
                type: "Button",
                label: "Fast",
                hittable: true,
                rect: { x: 20, y: 40, width: 100, height: 44 },
              },
            ],
          }),
        },
        interactions: {
          press: async (input: { selector?: string }) => {
            presses.push(input.selector ?? "point");
            throw nativeError;
          },
        },
      });
      const step: RecipeStep = { kind: "tap", target: { label: "Fast" }, optional: true };
      await assert.rejects(
        runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
          path === "tour-prelude"
            ? runMappedPrelude(
                device,
                [step, { kind: "tap", target: { label: "Sibling" } }],
                (line) => logs.push(line),
              )
            : runRecipeStep(
                device,
                path === "campaign"
                  ? {
                      ...step,
                      optional: false,
                      check: {
                        id: "fast",
                        title: "Select Fast",
                        cleanup: {
                          recipeId: "cleanup",
                          terminalScreenId: "home",
                          onCancel: "skip",
                        },
                      },
                    }
                  : step,
                {
                  log: (line) => logs.push(line),
                  job,
                  runtime: {},
                  recipeGraph: {
                    cleanup: {
                      id: "cleanup",
                      title: "Cleanup",
                      source: "custom",
                      createdAt: 1,
                      updatedAt: 1,
                      steps: [{ kind: "tap", target: { label: "Cleanup" } }],
                    },
                  },
                },
              ),
        ),
        (error: unknown) => {
          assert.ok(error instanceof IosMutationRejectedError);
          assert.equal(error.cause, nativeError);
          assert.equal(error.cause.code, code);
          assert.ok(!(error instanceof IosMutationOutcomeUnknownError));
          assert.equal(iosSelectorWasNotDispatched(error), false);
          assert.equal(classifySessionError(error.message), "ACTION_FAILED");
          assert.deepEqual(classifyRunOutcome({ status: "error", error: error.message }), {
            outcome: "harness-failure",
            failureCategory: "locator",
          });
          return true;
        },
      );
      assert.deepEqual(presses, ['label="Fast"']);
      assert.equal(lastIosMutationAttemptDiagnostic(serial)?.outcome, "selector-rejected");
      assert.equal(lastIosMutationAttemptDiagnostic(serial)?.intervention.required, false);
      assert.equal(lastIosMutationAttemptDiagnostic(serial)?.retry.decision, "blocked");
      assert.ok(!job.artifacts.some((artifact) => artifact.kind === "optional-step-skipped"));
      assert.ok(!logs.some((line) => line.includes("optional prelude tap skipped")));
      if (path === "campaign") {
        const cleanup = job.artifacts.find(
          (artifact) => artifact.kind === "campaign-check-cleanup",
        );
        assert.equal((cleanup?.data as { status?: string } | undefined)?.status, "skipped");
      }
    });
  }
}

test("a proven cleanup selector rejection stops the campaign without uncertain classification", async () => {
  const serial = "rejected-cleanup";
  let executions = 0;
  const job = { id: serial, artifacts: [] } as unknown as TestJob;
  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
      runCampaignCheck(
        deviceTestDouble({ capture: { snapshot: async () => ({ nodes: [] }) } }),
        {
          kind: "tap",
          target: { label: "Primary" },
          check: {
            id: "primary",
            title: "Primary",
            cleanup: { recipeId: "cleanup", terminalScreenId: "home", onCancel: "skip" },
          },
        },
        { log: () => {}, job, runtime: {} },
        async (recipeId) => {
          executions += 1;
          if (recipeId === "cleanup") {
            await runIosMutationOnce(serial, "press", async () => {
              throw new IosNativeMutationError(
                "selector matched multiple elements",
                "AMBIGUOUS_MATCH",
                "no",
              );
            });
          }
        },
      ),
    ),
    IosMutationRejectedError,
  );
  assert.equal(executions, 2);
  const cleanup = job.artifacts.find((artifact) => artifact.kind === "campaign-check-cleanup");
  assert.equal((cleanup?.data as { status?: string } | undefined)?.status, "failed");
});
