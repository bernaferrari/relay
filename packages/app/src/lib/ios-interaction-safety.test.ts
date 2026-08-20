import assert from "node:assert/strict";
import test from "node:test";
import {
  defineIosMutationTerminalityRegistry,
  verifyIosMutationTerminalityRegistry,
} from "@relay/protocol";
import {
  dispatchWithSafePointFallback,
  interactionSucceeded,
  iosInteractionFailure,
  iosMutationOutcomeUnknownIntervention,
} from "./ios-interaction-safety";

function unknownIosOutcome() {
  return Object.assign(new Error("The iOS press may already have reached the device."), {
    body: {
      code: "IOS_MUTATION_OUTCOME_UNKNOWN",
      iosMutation: {
        operation: "press",
        nativeAttempts: 1,
        outcome: "outcome-unknown",
        retry: { attempts: 0, decision: "blocked", reason: "native-command-outcome-unknown" },
        intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      },
    },
  });
}

test("an iOS unknown outcome becomes a review-and-evidence intervention", () => {
  const error = unknownIosOutcome();
  assert.deepEqual(iosInteractionFailure(error), {
    code: "IOS_MUTATION_OUTCOME_UNKNOWN",
    mutation: {
      operation: "press",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: { decision: "blocked", reason: "native-command-outcome-unknown" },
      intervention: { action: "capture-current-screen-before-any-retry" },
    },
  });
  assert.deepEqual(iosMutationOutcomeUnknownIntervention(error, "tap Settings"), {
    title: "Action may already have happened",
    detail:
      "Relay sent one iOS command and did not retry it. The current screen is saved for review before any next action.",
    screenshotCaption: "review before retry · tap Settings",
    operation: "press",
  });
});

function selectorMissFailure() {
  return iosInteractionFailure(
    Object.assign(new Error("selector was never dispatched"), {
      body: {
        code: "IOS_SELECTOR_NOT_DISPATCHED",
        iosMutation: {
          nativeAttempts: 1,
          outcome: "selector-miss",
          retry: {
            attempts: 0,
            decision: "safe-selector-fallback",
            reason: "selector-was-not-dispatched",
          },
        },
      },
    }),
  );
}

test("the canonical fallback boundary never turns an unknown iOS result into a point command", async () => {
  let primaryCalls = 0;
  let pointCalls = 0;
  const failed = {
    status: "ios-outcome-unknown",
    iosFailure: iosInteractionFailure(unknownIosOutcome()),
  };

  const result = await dispatchWithSafePointFallback({
    platform: "ios",
    kind: "label",
    hasPoint: true,
    attempt: async () => {
      primaryCalls += 1;
      return failed;
    },
    failedResult: (outcome) => !interactionSucceeded(outcome),
    failureForResult: (outcome) => outcome.iosFailure,
    pointFallback: async () => {
      pointCalls += 1;
      return { status: "succeeded", iosFailure: undefined };
    },
  });

  assert.equal(primaryCalls, 1);
  assert.equal(pointCalls, 0);
  assert.equal(result, failed);
});

test("the canonical fallback boundary rethrows an unknown iOS command without a second point command", async () => {
  const error = unknownIosOutcome();
  let primaryCalls = 0;
  let pointCalls = 0;

  await assert.rejects(
    dispatchWithSafePointFallback({
      platform: "ios",
      kind: "label",
      hasPoint: true,
      attempt: async (): Promise<{ session: string }> => {
        primaryCalls += 1;
        throw error;
      },
      pointFallback: async () => {
        pointCalls += 1;
        return { session: "fallback" };
      },
    }),
    (received: unknown) => received === error,
  );

  assert.equal(primaryCalls, 1);
  assert.equal(pointCalls, 0);
});

test("the canonical fallback boundary permits one iOS point command only after selector no-dispatch", async () => {
  let calls = 0;
  const failed = { status: "failed", iosFailure: selectorMissFailure() };

  const result = await dispatchWithSafePointFallback({
    platform: "ios",
    kind: "label",
    hasPoint: true,
    attempt: async () => {
      calls += 1;
      return failed;
    },
    failedResult: (outcome) => !interactionSucceeded(outcome),
    failureForResult: (outcome) => outcome.iosFailure,
    pointFallback: async () => {
      calls += 1;
      return { status: "succeeded", iosFailure: undefined };
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { status: "succeeded", iosFailure: undefined });
});

test("the same boundary preserves Android's existing semantic-to-point rescue", async () => {
  let calls = 0;
  const result = await dispatchWithSafePointFallback({
    platform: "android",
    kind: "label",
    hasPoint: true,
    attempt: async () => {
      calls += 1;
      return { status: "failed" };
    },
    failedResult: (outcome) => !interactionSucceeded(outcome),
    failureForResult: () => undefined,
    pointFallback: async () => {
      calls += 1;
      return { status: "succeeded" };
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { status: "succeeded" });
});

test("an unproven platform never authorizes a physical point fallback", async () => {
  let calls = 0;
  type Outcome = { status: "failed" } | { status: "succeeded" };
  const failed: Outcome = { status: "failed" };

  const result = await dispatchWithSafePointFallback<Outcome>({
    platform: undefined,
    kind: "label",
    hasPoint: true,
    attempt: async () => {
      calls += 1;
      return failed;
    },
    failedResult: (outcome) => !interactionSucceeded(outcome),
    failureForResult: () => undefined,
    pointFallback: async () => {
      calls += 1;
      return { status: "succeeded" as const };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result, failed);
});

test("the registered renderer fallback boundary stops one unknown request but retains selector rescue", async () => {
  type RendererOutcome =
    | { status: "failed"; iosFailure: ReturnType<typeof selectorMissFailure> }
    | { status: "succeeded"; iosFailure?: undefined };
  const registry = defineIosMutationTerminalityRegistry([
    {
      id: "app.renderer.safe-point-fallback",
      unknown: async () => {
        const nativeDispatches: string[] = [];
        const error = unknownIosOutcome();
        let terminal: unknown;
        try {
          await dispatchWithSafePointFallback({
            platform: "ios",
            kind: "label",
            hasPoint: true,
            attempt: async () => {
              nativeDispatches.push("semantic-request");
              throw error;
            },
            pointFallback: async () => {
              nativeDispatches.push("point-request");
              return { status: "succeeded" as const };
            },
          });
        } catch (caught) {
          terminal = caught;
        }
        return { nativeDispatches, status: "terminal" as const, error: terminal };
      },
      recovery: {
        expectedStatus: "recovered",
        expectedNativeDispatches: 2,
        run: async () => {
          const nativeDispatches: string[] = [];
          const failed: RendererOutcome = {
            status: "failed",
            iosFailure: selectorMissFailure(),
          };
          const result = await dispatchWithSafePointFallback<RendererOutcome>({
            platform: "ios",
            kind: "label",
            hasPoint: true,
            attempt: async () => {
              nativeDispatches.push("semantic-request");
              return failed;
            },
            failedResult: (outcome) => outcome.status === "failed",
            failureForResult: (outcome) => outcome.iosFailure,
            pointFallback: async () => {
              nativeDispatches.push("point-request");
              return { status: "succeeded" as const, iosFailure: undefined };
            },
          });
          if (!interactionSucceeded(result)) {
            return {
              nativeDispatches,
              status: "recovered" as const,
              error: new Error("selector miss did not keep renderer point rescue"),
            };
          }
          return { nativeDispatches, status: "recovered" as const };
        },
      },
    },
  ]);

  await verifyIosMutationTerminalityRegistry(registry, {
    isOutcomeUnknown: (error) =>
      iosInteractionFailure(error)?.code === "IOS_MUTATION_OUTCOME_UNKNOWN",
  });
});
