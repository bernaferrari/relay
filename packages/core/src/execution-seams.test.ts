import assert from "node:assert/strict";
import test from "node:test";
import type { RecipeStep } from "@relay/protocol";
import type { Device } from "./device.js";
import { independentlySourceProvenLeafRecipe } from "./recipe-runner-campaign-support.js";
import { runReusableRecipe } from "./recipe-runner-reusable.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { parseDeviceRecipeStep } from "./recipe-validation-device-steps.js";
import { parseRecordedEvidence } from "./recipe-validation-evidence.js";
import { parseTarget } from "./recipe-validation-primitives.js";
import { createSessionJob } from "./session-job-factory.js";

test("campaign firewall recognizes only a frozen source-proven warm leaf", () => {
  const check: NonNullable<RecipeStep["check"]> = {
    id: "usage",
    title: "Usage",
    recovery: {
      groupId: "settings",
      mode: "warm-transition",
      recipeId: "warm-leaf",
      transitionId: "settings-to-usage",
    },
    transitionDependencies: [
      {
        connectionId: "settings-to-usage",
        originScreenId: "settings",
        destination: { kind: "screen", screenId: "usage" },
      },
    ],
  };
  const context = {
    log: () => undefined,
    recipeGraph: {
      "warm-leaf": {
        steps: [
          {
            kind: "expect-screen",
            screenId: "settings",
            screenTitle: "Settings",
            fingerprint: "a".repeat(64),
          },
        ],
      },
    },
  } as unknown as RecipeStepContext;

  assert.equal(independentlySourceProvenLeafRecipe(check, context), true);
  context.recipeGraph!["warm-leaf"]!.steps[0] = {
    kind: "expect-screen",
    screenId: "other",
    screenTitle: "Other",
    fingerprint: "b".repeat(64),
  };
  assert.equal(independentlySourceProvenLeafRecipe(check, context), false);
});

test("reusable flow scopes inherited inputs and delegates nested steps", async () => {
  const resolvedInputs = { inherited: "outside" };
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  const context = {
    log: () => undefined,
    job: { resolvedInputs, artifacts },
    recipeGraph: {
      reusable: {
        id: "reusable",
        title: "Reusable",
        variables: { inherited: "default" },
        parameters: [{ name: "name", required: true }],
        steps: [{ kind: "sleep", ms: 0 }],
      },
    },
  } as unknown as RecipeStepContext;
  const received: string[] = [];

  await runReusableRecipe(
    {} as Device,
    "reusable",
    context,
    async (_device, step, childContext) => {
      received.push(step.kind);
      assert.equal(childContext.job?.resolvedInputs.name, "Ada");
      assert.equal(childContext.job?.resolvedInputs.inherited, "default");
    },
    { name: "Ada" },
  );

  assert.deepEqual(received, ["sleep"]);
  assert.deepEqual(resolvedInputs, { inherited: "outside" });
  assert.equal(artifacts[0]?.kind, "reusable-flow-inputs");
});

test("validation seams preserve selector evidence and device-step parsing", () => {
  assert.deepEqual(parseTarget({ label: "Continue", point: { x: 4, y: 8 } }, 1, "target"), {
    label: "Continue",
    point: { x: 4, y: 8 },
  });
  assert.deepEqual(
    parseRecordedEvidence(
      {
        id: "evidence-1",
        recordedAt: 1,
        candidates: [
          {
            strategy: "label",
            label: "Continue",
            source: "element",
            confidence: "high",
            target: { label: "Continue" },
          },
        ],
      },
      1,
    ),
    {
      id: "evidence-1",
      recordedAt: 1,
      candidates: [
        {
          strategy: "label",
          label: "Continue",
          source: "element",
          confidence: "high",
          target: { label: "Continue" },
        },
      ],
    },
  );
  assert.deepEqual(parseDeviceRecipeStep({ action: "open", app: "com.example.app" }, "app", 1), {
    kind: "app",
    action: "open",
    app: "com.example.app",
  });
  assert.equal(parseDeviceRecipeStep({}, "sleep", 1), undefined);
});

test("session factory freezes target selection behind an injected transport projection", () => {
  const job = createSessionJob(
    {
      recipe: "settings-tour",
      serial: "emulator-5554",
      platform: "android",
      variables: { locale: "en" },
    },
    {
      findJob: () => undefined,
      toTransport: (value) => ({ ...value, title: "transport projection" }),
    },
  );

  assert.equal(job.targetContext.kind, "device");
  assert.equal(job.targetContext.platform, "android");
  assert.equal(job.targetContext.serial, "emulator-5554");
  assert.equal(JSON.parse(JSON.stringify(job)).title, "transport projection");
});
