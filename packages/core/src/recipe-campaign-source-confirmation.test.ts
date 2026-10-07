import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, RecipeStep, Screen } from "@relay/protocol";
import { compileAppMapTest } from "./map-work.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { runRecipeStep } from "./recipe-runner.js";
import { observeScreenIdentity } from "./screen-identity.js";
import type { TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";
import { deviceTestDouble } from "./testing.js";

const scope = { organizationId: "org", projectId: "project", appMapId: "source-confirmation" };
const home = [{ type: "Button", identifier: "home.control", label: "Home", hittable: true }];
const typed = [{ type: "StaticText", identifier: "typed.message", label: "Typed" }];

function screen(id: string, nodes: typeof home | typeof typed): Screen {
  return {
    ...scope,
    id,
    title: id,
    identity: { schemaVersion: 1, fingerprint: observeScreenIdentity(nodes).fingerprint },
    evidenceSurface: "ordinary",
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function compile(withSetup = false) {
  const map: AppMap = {
    ...scope,
    id: scope.appMapId,
    schemaVersion: 1,
    name: "Source confirmation",
    revision: 1,
    notes: {},
    groups: {},
    screens: { home: screen("home", home), typed: screen("typed", typed) },
    screenVariants: {},
    connections: {
      ready: {
        ...scope,
        id: "ready",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "home" },
        label: "Verify Home",
        state: "ready",
        actions: [{ id: "observe", kind: "passive", reason: "observe-only" }],
        createdAt: 1,
        updatedAt: 1,
      },
      type: {
        ...scope,
        id: "type",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "typed" },
        label: "Type prompt",
        state: "ready",
        actions: [
          {
            id: "recorded-type",
            kind: "recorded",
            takeId: "recorded-take",
            takeRevision: 2,
            steps: [{ id: "type-prompt", kind: "type", text: "Public fixture prompt" }],
            evidenceIds: [],
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {
      setup: {
        ...scope,
        id: "setup",
        name: "Setup",
        parameters: [],
        actions: [{ id: "setup-wait", kind: "wait", ms: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
  const scenario: AppMapScenarioTest = {
    ...scope,
    id: "prompt",
    name: "Prompt",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      ...(withSetup
        ? [
            {
              id: "setup",
              kind: "module" as const,
              intent: "Setup",
              binding: {
                status: "resolved" as const,
                kind: "routine" as const,
                routineId: "setup",
              },
            },
          ]
        : []),
      {
        id: "home",
        kind: "instruction",
        intent: "Reach Home",
        binding: { status: "resolved", kind: "connections", connectionIds: ["ready"] },
      },
      {
        id: "copy-gone",
        kind: "validation",
        intent: "Previous Copy is gone",
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: { kind: "expect", target: { text: "Copy" }, condition: "gone", timeoutMs: 100 },
        },
      },
      {
        id: "type",
        kind: "instruction",
        intent: "Type prompt",
        binding: { status: "resolved", kind: "connections", connectionIds: ["type"] },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const compiled = compileAppMapTest(map, scenario);
  // Zero authored wait budgets keep negative source observations deterministic;
  // the exact compiled identities and canonical recipe relationship stay intact.
  for (const recipe of Object.values(compiled.graph)) {
    for (const step of recipe.steps) if (step.kind === "expect-screen") step.timeoutMs = 0;
  }
  const check = compiled.root.steps.find((step) => step.check?.id === "type");
  assert.ok(check?.check);
  return { ...compiled, check, checkMetadata: check.check };
}

function execution(compiled: ReturnType<typeof compile>) {
  const events: string[] = [];
  let current = home as typeof home | typeof typed;
  let readFailure: "empty" | "failed" | undefined;
  const targetContext = { kind: "browser", platform: "browser", targetId: "fixture" } as const;
  const job: TestJob = {
    id: "source-confirmation",
    targetContext,
    action: compiled.root.id,
    title: "Prompt",
    status: "running",
    queuedAt: 1,
    attempts: 1,
    platform: "browser",
    targetKind: "browser",
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Verify",
    tone: "dim",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
  const device = deviceTestDouble({
    capture: {
      snapshot: async () => {
        events.push(`tree:${current === home ? "home" : "typed"}`);
        if (readFailure === "failed") throw new Error("accessibility permission denied");
        return { nodes: readFailure === "empty" ? [] : current };
      },
      screenshot: async () => {
        throw new Error("fixture raster unavailable");
      },
    },
    interactions: {
      find: async () => {
        events.push("presence:Copy");
        throw new Error("element not found");
      },
      type: async () => {
        events.push("input:type");
        current = typed;
      },
      press: async () => {
        events.push("input:press");
      },
    },
    command: { wait: async () => {} },
  });
  const ctx: RecipeStepContext = {
    job,
    runtime: {},
    recipeGraph: compiled.graph,
    log: (message) => {
      events.push(message);
      job.logs.push(message);
    },
  };
  const run = (step: RecipeStep) =>
    runWithTargetContext(targetContext, () => runRecipeStep(device, step, ctx));
  const prefix = async () => {
    for (const step of compiled.root.steps) {
      if (step === compiled.check) break;
      await run(step);
    }
    assert.equal(
      ctx.runtime?.navigationCursor?.status,
      "unknown",
      "Copy read still invalidates proof",
    );
    assert.equal(ctx.runtime?.observation, undefined);
  };
  return {
    events,
    ctx,
    job,
    run,
    prefix,
    failRead: (value: typeof readFailure) => {
      readFailure = value;
    },
  };
}

test("a no-setup recorded leaf freezes warm confirmation without inventing cold setup", () => {
  const value = compile();
  const recovery = value.checkMetadata.recovery;
  assert.equal(recovery?.transitionId, "type");
  assert.equal(recovery?.mode, "warm-transition");
  assert.equal(recovery?.coldRecipeId, undefined);
  assert.ok(recovery);
  const confirmation = value.graph[recovery.recipeId];
  assert.equal(confirmation?.steps[0]?.kind, "expect-screen");
  if (confirmation?.steps[0]?.kind === "expect-screen")
    assert.equal(confirmation.steps[0].screenId, "home");
  assert.deepEqual(
    confirmation?.steps.map((step) => step.kind),
    ["expect-screen", "type", "expect-screen"],
  );
});

test("setup Tests retain a separate review-only cold recipe, never setup in warm confirmation", () => {
  const value = compile(true);
  const recovery = value.checkMetadata.recovery;
  assert.ok(recovery?.coldRecipeId);
  assert.equal(value.graph[recovery.coldRecipeId]?.steps[0]?.kind, "module");
  assert.deepEqual(
    value.graph[recovery.recipeId]?.steps.map((step) => step.kind),
    ["expect-screen", "type", "expect-screen"],
  );
});

test("actual Copy-gone then recorded Type re-proves the frozen source before one input", async () => {
  const compiled = compile();
  const value = execution(compiled);
  await value.prefix();
  const before = value.events.length;
  await value.run(compiled.check);
  const events = value.events.slice(before);
  assert.ok(events.includes("check recovery: Type prompt — one canonical path"));
  assert.ok(events.indexOf("tree:home") < events.indexOf("input:type"));
  assert.ok(events.indexOf("screen: reached home") < events.indexOf("input:type"));
  assert.equal(events.filter((event) => event === "input:type").length, 1);
  assert.equal(events.includes("input:press"), false);
  assert.equal(value.ctx.runtime?.navigationCursor?.status, "proven");
  assert.equal(
    value.job.artifacts.some(
      (artifact) =>
        artifact.kind === "campaign-check-result" &&
        (artifact.data as { id?: string; status?: string }).id === "type" &&
        (artifact.data as { status?: string }).status === "passed",
    ),
    true,
  );
});

for (const state of ["empty", "failed"] as const) {
  test(`fresh ${state} source inspection remains primary and stops downstream wait before input`, async () => {
    const compiled = compile();
    const value = execution(compiled);
    await value.prefix();
    value.failRead(state);
    let dependentWaits = 0;
    await assert.rejects(async () => {
      await value.run(compiled.check);
      dependentWaits += 1;
      await value.run({ kind: "wait-response", target: { label: "Copy" }, timeoutMs: 1 });
    }, /^RecipeScreenInspectionError: screen-inspection-unavailable:/);
    assert.equal(dependentWaits, 0);
    assert.equal(
      value.events.some((event) => event.startsWith("input:")),
      false,
    );
    assert.equal(value.ctx.runtime?.navigationCursor?.status, "unknown");
    assert.equal(value.ctx.runtime?.observation, undefined);
    const result = value.job.artifacts.find(
      (artifact) =>
        artifact.kind === "campaign-check-result" &&
        (artifact.data as { id?: string }).id === "type",
    );
    assert.equal((result?.data as { status?: string })?.status, "failed");
  });
}

for (const reason of ["missing", "wrong-source", "external"] as const) {
  test(`${reason} source proof retains blocked evidence and terminal prerequisite without input`, async () => {
    const compiled = compile();
    const value = execution(compiled);
    await value.prefix();
    const recovery = compiled.checkMetadata.recovery;
    if (reason === "missing" && recovery) delete compiled.graph[recovery.recipeId];
    if (reason === "wrong-source" && recovery) {
      const source = compiled.graph[recovery.recipeId]?.steps[0];
      if (source?.kind === "expect-screen") source.screenId = "another-origin";
    }
    if (reason === "external")
      value.ctx.runtime!.navigationCursor = {
        status: "external-handoff",
        foregroundApp: "foreign.app",
        reason: "Observed handoff",
        updatedAt: Date.now(),
      };
    let dependentWaits = 0;
    await assert.rejects(async () => {
      await value.run(compiled.check);
      dependentWaits += 1;
      await value.run({ kind: "wait-response", target: { label: "Copy" }, timeoutMs: 1 });
    }, /^RecipeNavigationPrerequisiteError: navigation-proof-unavailable:/);
    assert.equal(dependentWaits, 0);
    assert.equal(
      value.events.some((event) => event.startsWith("input:")),
      false,
    );
    const result = value.job.artifacts.find(
      (artifact) =>
        artifact.kind === "campaign-check-result" &&
        (artifact.data as { id?: string }).id === "type",
    );
    assert.equal((result?.data as { status?: string })?.status, "blocked");
    assert.equal(
      value.job.artifacts.some((artifact) => artifact.kind === "campaign-cursor-firewall"),
      true,
    );
  });
}

test("nested source refusal remains the parent's primary failure and cannot invoke compensating input", async () => {
  const compiled = compile();
  const value = execution(compiled);
  await value.run(compiled.root.steps[0]!);
  const recovery = compiled.checkMetadata.recovery;
  assert.ok(recovery);
  delete compiled.graph[recovery.recipeId];
  compiled.graph.parent = {
    id: "parent",
    title: "Outer campaign check",
    source: "custom",
    steps: [compiled.root.steps[1]!, compiled.check],
    createdAt: 1,
    updatedAt: 1,
  };
  compiled.graph.cleanup = {
    id: "cleanup",
    title: "Compensating input",
    source: "custom",
    steps: [{ kind: "type", text: "Must not dispatch" }],
    createdAt: 1,
    updatedAt: 1,
  };
  let primary: Error | undefined;
  let dependentWaits = 0;
  await assert.rejects(
    async () => {
      await value.run({
        kind: "module",
        recipeId: "parent",
        check: {
          id: "outer",
          title: "Outer",
          warmSourceScreenId: "home",
          cleanup: { recipeId: "cleanup", terminalScreenId: "home", onCancel: "skip" },
        },
      });
      dependentWaits += 1;
      await value.run({ kind: "wait-response", target: { label: "Copy" }, timeoutMs: 1 });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      primary = error;
      return error.name === "RecipeNavigationPrerequisiteError";
    },
  );
  assert.equal(dependentWaits, 0);
  assert.equal(
    value.events.some((event) => event.startsWith("input:")),
    false,
  );
  const result = value.job.artifacts.find(
    (artifact) =>
      artifact.kind === "campaign-check-result" &&
      (artifact.data as { id?: string }).id === "outer",
  );
  assert.equal((result?.data as { status?: string })?.status, "failed");
  assert.equal((result?.data as { error?: string })?.error, primary?.message);
  assert.equal((result?.data as { prerequisiteCheckId?: string })?.prerequisiteCheckId, "type");
  const cleanup = value.job.artifacts.find(
    (artifact) =>
      artifact.kind === "campaign-check-cleanup" &&
      (artifact.data as { checkId?: string }).checkId === "outer",
  );
  assert.equal((cleanup?.data as { status?: string })?.status, "skipped");
  assert.equal(value.ctx.runtime?.navigationCursor?.status, "unknown");
});
