import assert from "node:assert/strict";
import test from "node:test";
import {
  preDispatchProblem,
  preDispatchProblemReason,
  selectDeviceTargetProfile,
} from "./run-workflow-support.js";

test("offline preflight rejection projects only concrete bounded blocker messages and recovery", () => {
  const problem = preDispatchProblem(
    Object.assign(new Error("Offline Test preflight is blocked"), {
      status: 409,
      body: {
        details: {
          code: "TEST_OFFLINE_PREFLIGHT_BLOCKED",
          preflight: {
            findings: [
              {
                severity: "blocker",
                code: "selector-absent",
                message: 'Saved control "Ask Grok" is absent from the recorded screen.',
                candidates: [{ value: "private candidate" }],
              },
              { severity: "warning", code: "point-only-selector", message: "Unrelated warning" },
              {
                severity: "blocker",
                code: "raw-evidence-variant-recapture-required",
                message: "The selected iPad capture needs review.",
              },
            ],
          },
          recovery: "Open the Test editor and recapture the affected iPad screen.",
          rawAccessibility: "private raw tree",
          token: "private token",
        },
      },
    }),
  );
  assert.equal(problem.sourceCode, "TEST_OFFLINE_PREFLIGHT_BLOCKED");
  assert.match(problem.detail, /Ask Grok.*absent/);
  assert.match(problem.detail, /new recording for the selected setup/);
  assert.match(problem.recovery, /Record the affected step.*Test editor/);
  assert.equal(problem.retryable, false);
  assert.doesNotMatch(JSON.stringify(problem), /private|Unrelated warning/);
});

test("known recapture blockers name the saved screen in plain language without runtime profile ids", () => {
  const problem = preDispatchProblem({
    body: {
      details: {
        code: "TEST_OFFLINE_PREFLIGHT_BLOCKED",
        preflight: {
          cursorTimeline: [{ screenId: "home-id", screenTitle: "Grok home" }],
          findings: [
            {
              severity: "blocker",
              code: "raw-evidence-recapture-required",
              screenId: "home-id",
              message:
                "Grok home's frozen raw accessibility tree is not bound to its current observation for selected runtime Variant device:opaque-profile; recapture this screen before relying on offline geometry.",
            },
          ],
        },
        recovery: "Relay inherited runtime profile device:opaque-profile for ios:private-serial.",
      },
    },
  });
  assert.equal(problem.detail, "Grok home’s recorded controls don’t match its saved step.");
  assert.equal(
    problem.recovery,
    "Record the affected step again in the Test editor before running.",
  );
  assert.equal(problem.sourceCode, "TEST_OFFLINE_PREFLIGHT_BLOCKED");
  assert.doesNotMatch(
    `${problem.detail} ${problem.recovery}`,
    /raw accessibility|geometry|frozen|runtime|opaque|private-serial|raw-evidence/,
  );
});

test("offline preflight rejection bounds and redacts diagnostics without requiring a valid finding", () => {
  const problem = preDispatchProblem(
    Object.assign(new Error("generic failure"), {
      body: {
        code: "TEST_OFFLINE_PREFLIGHT_BLOCKED",
        detail: `Invalid plan Authorization: Bearer sensitive-token https://example.com/run?token=private ${"x".repeat(2_000)}`,
        recovery: "Review the Test. ".repeat(100),
      },
    }),
  );
  assert.match(problem.detail, /Invalid plan/);
  assert.ok(problem.detail.length <= 600);
  assert.ok(problem.recovery.length <= 300);
  assert.doesNotMatch(problem.detail, /sensitive-token|token=private/);
  assert.ok(preDispatchProblemReason(problem).length <= 1_000);
});

test("expected-screen intersections do not prove the current native runtime", () => {
  const variant = (id: string) => ({ targetProfileId: id, platform: "android", targetId: "phone" });
  const compiled = {
    plan: {
      rawAccessibilityTargetProfiles: [
        { id: "old", platform: "android", targetId: "phone" },
        { id: "recorded", platform: "android", targetId: "phone" },
      ],
      rawAccessibilityVariantsByScreenId: {
        start: [variant("recorded")],
        settings: [variant("old"), variant("recorded")],
      },
      recipes: {
        route: {
          steps: [
            { kind: "expect-screen", screenId: "start" },
            { kind: "expect-screen", screenId: "settings" },
          ],
        },
      },
    },
  } as unknown as Parameters<typeof selectDeviceTargetProfile>[0];
  assert.throws(
    () =>
      selectDeviceTargetProfile(compiled, {
        kind: "device",
        platform: "android",
        targetId: "phone",
      }),
    /viewport is unavailable/,
  );
  const variants = compiled.plan.rawAccessibilityVariantsByScreenId!;
  variants.start = [variant("old")] as typeof variants.start;
  assert.throws(
    () =>
      selectDeviceTargetProfile(compiled, {
        kind: "device",
        platform: "android",
        targetId: "phone",
      }),
    /viewport is unavailable/,
  );
});

test("passive current facts select complete physical capture evidence after merging screens", () => {
  const compiled = {
    plan: {
      rawAccessibilityTargetProfiles: [
        {
          id: "device:phone-old",
          platform: "android",
          targetId: "phone",
          viewport: { width: 1080, height: 2340 },
          osVersion: "16",
        },
        {
          id: "device:phone",
          platform: "android",
          targetId: "phone",
          viewport: { width: 1080, height: 2340 },
        },
      ],
    },
  } as unknown as Parameters<typeof selectDeviceTargetProfile>[0];
  assert.throws(
    () =>
      selectDeviceTargetProfile(compiled, {
        kind: "device",
        platform: "android",
        targetId: "phone",
      }),
    /viewport is unavailable/,
  );
  assert.equal(
    selectDeviceTargetProfile(
      compiled,
      { kind: "device", platform: "android", targetId: "phone" },
      {
        serial: "phone",
        platform: "android",
        osVersion: "16",
        viewport: { width: 1080, height: 2340 },
      },
    ),
    "device:phone-old",
  );
  compiled.plan.rawAccessibilityTargetProfiles![0]!.viewport = { width: 2340, height: 1080 };
  assert.throws(
    () =>
      selectDeviceTargetProfile(compiled, {
        kind: "device",
        platform: "android",
        targetId: "phone",
      }),
    /viewport is unavailable/,
  );
  assert.throws(
    () =>
      selectDeviceTargetProfile(
        compiled,
        { kind: "device", platform: "android", targetId: "phone" },
        {
          serial: "phone",
          platform: "android",
          osVersion: "16",
          viewport: { width: 1080, height: 2340 },
        },
      ),
    /no longer matches/,
  );
});
