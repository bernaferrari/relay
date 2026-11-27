import assert from "node:assert/strict";
import test from "node:test";
import { captureScrollableSurvey } from "../scroll/scrollable-survey.js";
import {
  registerScrollSurfaceOpeningPolicy,
  scrollSurfaceOpeningPolicy,
} from "./scroll-surface-opening-policy.js";

test("scroll surface opening policies register once and unregister cleanly", () => {
  const policy = {
    kind: "example-opening",
    matches: () => false,
    assessOpening: () => ({ kind: "stable" as const }),
    unstableMessage: () => "unstable",
  };
  assert.equal(scrollSurfaceOpeningPolicy("example-opening"), undefined);
  const unregister = registerScrollSurfaceOpeningPolicy(policy);
  assert.equal(scrollSurfaceOpeningPolicy("example-opening")?.kind, "example-opening");
  assert.throws(() => registerScrollSurfaceOpeningPolicy(policy), /already registered/u);
  unregister();
  assert.equal(scrollSurfaceOpeningPolicy("example-opening"), undefined);
});

test("an unknown surface expectation fails before capturing a viewport", async () => {
  let captures = 0;
  await assert.rejects(
    captureScrollableSurvey(
      {
        capture: async () => {
          captures += 1;
          throw new Error("must not capture");
        },
        scrollDown: async () => {},
        scrollUp: async () => {},
        settle: async () => {},
      },
      { surfaceExpectation: { kind: "missing-opening-policy" } },
    ),
    /No scroll surface opening policy is registered/u,
  );
  assert.equal(captures, 0);
});
