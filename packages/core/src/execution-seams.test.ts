import assert from "node:assert/strict";
import test from "node:test";
import {
  compileBrowserEnvironment,
  executionTargetRefKey,
  type RecipeStep,
  type TargetProfile,
} from "@relay/protocol";
import type { Device } from "./device.js";
import { independentlySourceProvenLeafRecipe } from "./recipe-runner-campaign-support.js";
import { runReusableRecipe } from "./recipe-runner-reusable.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { parseDeviceRecipeStep } from "./recipe-validation-device-steps.js";
import { parseRecordedEvidence } from "./recipe-validation-evidence.js";
import { parseTarget } from "./recipe-validation-primitives.js";
import { createSessionJob, retryInputFromJob } from "./session-job-factory.js";
import { executionTargetSchedulingKey } from "./target-driver.js";

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

test("in-place chrome wait-for is a source-proven leaf", () => {
  const check: NonNullable<RecipeStep["check"]> = {
    id: "ask",
    title: "Ask",
    recovery: {
      groupId: "ask",
      mode: "warm-transition",
      recipeId: "warm-leaf",
      transitionId: "ask-3x5",
    },
    transitionDependencies: [
      {
        connectionId: "ask-3x5",
        originScreenId: "home",
        destination: { kind: "end" },
      },
    ],
  };
  const context = {
    log: () => undefined,
    recipeGraph: {
      "warm-leaf": {
        steps: [{ kind: "wait-for", target: { label: "Library" }, timeoutMs: 5_000 }],
      },
    },
  } as unknown as RecipeStepContext;
  assert.equal(independentlySourceProvenLeafRecipe(check, context), true);
});

test("leftover conversation dest-screen wait-for is a source-proven leaf", () => {
  const check: NonNullable<RecipeStep["check"]> = {
    id: "open-chat",
    title: "Open chat",
    recovery: {
      groupId: "open-chat",
      mode: "warm-transition",
      recipeId: "warm-leaf",
      transitionId: "home-to-conversation",
    },
    transitionDependencies: [
      {
        connectionId: "home-to-conversation",
        originScreenId: "home",
        destination: { kind: "screen", screenId: "conversation" },
      },
    ],
  };
  const context = {
    log: () => undefined,
    recipeGraph: {
      "warm-leaf": {
        steps: [{ kind: "wait-for", target: { label: "Library" }, timeoutMs: 5_000 }],
      },
    },
  } as unknown as RecipeStepContext;
  assert.equal(independentlySourceProvenLeafRecipe(check, context), true);
});

test("leftover New Chat before wait-for is still a source-proven leaf", () => {
  const check: NonNullable<RecipeStep["check"]> = {
    id: "open-chat",
    title: "Open chat",
    recovery: {
      groupId: "open-chat",
      mode: "warm-transition",
      recipeId: "warm-leaf",
      transitionId: "home-to-conversation",
    },
    transitionDependencies: [
      {
        connectionId: "home-to-conversation",
        originScreenId: "home",
        destination: { kind: "screen", screenId: "conversation" },
      },
    ],
  };
  const context = {
    log: () => undefined,
    recipeGraph: {
      "warm-leaf": {
        steps: [
          { kind: "tap", target: { identifier: "new-chat", label: "Chat" } },
          { kind: "wait-for", target: { label: "Library" }, timeoutMs: 5_000 },
        ],
      },
    },
  } as unknown as RecipeStepContext;
  assert.equal(independentlySourceProvenLeafRecipe(check, context), true);
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

test("session factory separates a physical target lane from a legacy host ceiling", () => {
  const first = createSessionJob(
    {
      recipe: "settings-tour",
      serial: "ipad-a",
      platform: "ios",
      workerId: "mac-xcode",
      workerCapacity: 2,
    },
    { findJob: () => undefined, toTransport: (value) => value },
  );

  assert.equal(first.workerId, "local:ios:target:ipad-a");
  assert.equal(first.workerCapacity, 1);
  assert.equal(first.hostWorkerId, "mac-xcode");
  assert.equal(first.hostWorkerCapacity, 2);

  const retry = createSessionJob(
    {
      recipe: "settings-tour",
      serial: "ipad-a",
      platform: "ios",
      retryOf: first.id,
    },
    { findJob: (id) => (id === first.id ? first : undefined), toTransport: (value) => value },
  );

  assert.equal(retry.workerId, "local:ios:target:ipad-a");
  assert.equal(retry.hostWorkerId, "mac-xcode");
  assert.equal(retry.hostWorkerCapacity, 2);
  assert.deepEqual(retry.executionTarget, first.executionTarget);
});

test("session factory freezes provider-scoped targets and rejects split-brain input", () => {
  const target = {
    schemaVersion: 1 as const,
    kind: "provider-session" as const,
    provider: { key: "example.farm", scope: "remote" as const },
    targetId: "session-42",
    platform: "ios" as const,
    identity: { kind: "provider-session" as const, value: "session-42" },
  };
  const job = createSessionJob(
    { recipe: "settings-tour", executionTarget: target },
    { findJob: () => undefined, toTransport: (value) => value },
  );

  assert.deepEqual(job.targetContext, {
    kind: "cloud",
    provider: "example.farm",
    sessionId: "session-42",
    platform: "ios",
  });
  assert.equal(job.platform, "ios", "legacy reports retain the frozen remote platform");
  assert.deepEqual(job.executionTarget, target);
  assert.notEqual(job.executionTarget, target, "factory owns an immutable target copy");
  assert.equal(
    job.workerId,
    "remote:example.farm:ios:target:session-42",
    "provider sessions cannot share a local target lane with the same session text",
  );
  assert.equal(
    executionTargetSchedulingKey(job.executionTarget!),
    `remote:${executionTargetRefKey(target)}`,
  );
  const retry = createSessionJob(
    {
      ...retryInputFromJob(job),
    },
    { findJob: (id) => (id === job.id ? job : undefined), toTransport: (value) => value },
  );
  assert.equal(retry.platform, "ios");
  assert.deepEqual(retry.targetContext, job.targetContext);
  assert.deepEqual(retry.executionTarget, job.executionTarget);
  assert.equal(retry.workerId, job.workerId, "retry keeps the frozen provider lane");
  assert.throws(
    () =>
      createSessionJob(
        { recipe: "settings-tour", executionTarget: target, serial: "local-ios" },
        { findJob: () => undefined, toTransport: (value) => value },
      ),
    /executionTarget must agree/i,
  );
});

test("session factory freezes browser environment identity across queue and retry", () => {
  const mutableProfile = structuredClone(
    compileBrowserEnvironment({
      viewport: { width: 390, height: 844 },
      locale: "pt-BR",
      timezoneId: "America/Maceio",
      touch: true,
    }),
  );
  const targetProfile: TargetProfile = {
    id: "browser:chat",
    targetId: "chat",
    source: "browser",
    platform: "browser",
    name: "Chat",
    browserCaseProfile: mutableProfile,
    capabilities: ["snapshot", "tap", "type"],
    observedAt: 1,
  };
  const job = createSessionJob(
    { recipe: "browser-proof", targetKind: "browser", browserTargetId: "chat", targetProfile },
    { findJob: () => undefined, toTransport: (value) => value },
  );

  mutableProfile.locale = "en-US";
  assert.equal(job.browserCaseProfile?.locale, "pt-BR");
  assert(Object.isFrozen(job.browserCaseProfile));
  assert(Object.isFrozen(job.browserCaseProfile?.viewport));
  assert.equal(job.targetProfile?.browserCaseProfile?.locale, "pt-BR");
  assert(Object.isFrozen(job.targetProfile));
  assert.equal(job.workerId, "local:browser:target:chat%23signed-out");
  assert.equal(job.hostWorkerId, "local:browser:host");
  assert.equal(job.hostWorkerCapacity, 8);

  const parallel = createSessionJob(
    {
      recipe: "browser-proof",
      targetKind: "browser",
      browserTargetId: "chat",
      targetProfile,
      unsignedLaneId: "grok-daily-b",
    },
    { findJob: () => undefined, toTransport: (value) => value },
  );
  assert.equal(parallel.unsignedLaneId, "grok-daily-b");
  assert.equal(parallel.laneId, "grok-daily-b");
  assert.equal(parallel.workerId, "local:browser:target:chat%23signed-out%3Agrok-daily-b");

  const labProfile: TargetProfile = {
    ...targetProfile,
    id: "browser:grok-com-1280x800-339a5a430a41",
    browserCaseProfile: {
      ...mutableProfile,
      authenticationFixtureId: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
    },
  };
  const lab = createSessionJob(
    {
      recipe: "browser-proof",
      targetKind: "browser",
      browserTargetId: "chat",
      targetProfile: labProfile,
      laneId: "grok-lab",
    },
    { findJob: () => undefined, toTransport: (value) => value },
  );
  assert.equal(lab.laneId, "grok-lab");
  assert.equal(lab.unsignedLaneId, undefined);
  const labRetry = createSessionJob(retryInputFromJob(lab), {
    findJob: (id) => (id === lab.id ? lab : undefined),
    toTransport: (value) => value,
  });
  assert.equal(labRetry.laneId, "grok-lab");
  assert.equal(labRetry.unsignedLaneId, undefined);

  const retry = createSessionJob(retryInputFromJob(job), {
    findJob: (id) => (id === job.id ? job : undefined),
    toTransport: (value) => value,
  });
  assert.deepEqual(retry.browserCaseProfile, job.browserCaseProfile);
  assert.notEqual(retry.browserCaseProfile, job.browserCaseProfile);

  assert.throws(
    () =>
      createSessionJob(
        { recipe: "unsafe-browser-proof", targetKind: "browser", browserTargetId: "chat" },
        { findJob: () => undefined, toTransport: (value) => value },
      ),
    /require a frozen browser case profile/u,
  );
  assert.throws(
    () =>
      createSessionJob(
        {
          recipe: "mismatched-browser-proof",
          targetKind: "browser",
          browserTargetId: "chat",
          browserCaseProfile: { ...mutableProfile, locale: "it-IT" },
          targetProfile,
        },
        { findJob: () => undefined, toTransport: (value) => value },
      ),
    /does not match its frozen target profile/u,
  );
});
