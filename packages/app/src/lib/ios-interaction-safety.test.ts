import assert from "node:assert/strict";
import test from "node:test";
import {
  canFallbackToPointAfterFailedInteraction,
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

test("only a canonical no-dispatch diagnostic permits a renderer iOS point fallback", () => {
  const input = { platform: "ios", kind: "label", hasPoint: true };
  assert.equal(canFallbackToPointAfterFailedInteraction(input), false);
  assert.equal(
    canFallbackToPointAfterFailedInteraction({
      ...input,
      failure: iosInteractionFailure(new Error("did not change the screen")),
    }),
    false,
  );
  assert.equal(
    canFallbackToPointAfterFailedInteraction({
      ...input,
      failure: iosInteractionFailure(new Error("expired ref")),
    }),
    false,
  );
  assert.equal(
    canFallbackToPointAfterFailedInteraction({
      ...input,
      failure: iosInteractionFailure(
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
      ),
    }),
    true,
  );
  assert.equal(
    canFallbackToPointAfterFailedInteraction({
      platform: "android",
      kind: "label",
      hasPoint: true,
    }),
    true,
  );
});
