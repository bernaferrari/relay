import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapCompiledTest, Connection } from "@relay/protocol";
import { proposeAppMapTestExecutionSchedule } from "./app-map-test-schedule.js";
import type { Device } from "./device.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";
import { replayPersistedRunOffline } from "./offline-run-replay.js";
import { runCampaignCheck } from "./recipe-runner-campaign-checks.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { Recipe, RecipeStep } from "./recipes.js";
import type { PersistedRun } from "./runs.js";
import type { TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";

/**
 * This is deliberately a fixture set, not another execution engine. Each seed
 * builds a small frozen App Map plan and runs the production scheduler,
 * preflight, replay, and cursor firewall against it. The diagnostic is kept
 * compact so a failed CI seed is a repair package instead of a giant random
 * fixture dump.
 */

const at = 1_800_000_000_000;
const scope = {
  organizationId: "fixture-org",
  projectId: "fixture-project",
  appMapId: "cursor-map",
};
const SEEDS = Array.from({ length: 128 }, (_, seed) => seed);

type Check = NonNullable<RecipeStep["check"]>;

type FixtureDescriptor = {
  seed: number;
  repeatedTerminal: boolean;
  alphaHasDirectReturn: boolean;
  alphaHasInverseReturn: boolean;
  betaMissingReturn: boolean;
  mismatchedOrigin: boolean;
  externalHandoff: boolean;
  selectorBlocked: boolean;
};

type FixtureFixture = {
  descriptor: FixtureDescriptor;
  map: AppMap;
  graph: Record<string, Recipe>;
  plan: AppMapCompiledTest;
  evidence: Parameters<typeof preflightCompiledAppMapTestOffline>[1];
  replayRun: PersistedRun;
};

function descriptor(seed: number): FixtureDescriptor {
  return {
    seed,
    repeatedTerminal: Boolean(seed & 1),
    alphaHasDirectReturn: Boolean(seed & 2),
    alphaHasInverseReturn: Boolean(seed & 4),
    betaMissingReturn: Boolean(seed & 8),
    mismatchedOrigin: Boolean(seed & 16),
    externalHandoff: Boolean(seed & 32),
    selectorBlocked: Boolean(seed & 64),
  };
}

function screen(id: string, options: { external?: boolean } = {}) {
  return {
    ...scope,
    id,
    title: id,
    identity: { schemaVersion: 1 as const, fingerprint: id.padEnd(64, id[0] ?? "x").slice(0, 64) },
    ...(options.external
      ? { handoff: { ownerApp: "com.apple.Preferences", returnAction: "back" as const } }
      : {}),
    variantIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function fixtureMap(input: FixtureDescriptor): AppMap {
  const screens = {
    settings: screen("settings"),
    alpha: screen("alpha"),
    beta: screen("beta"),
    repeated: screen("repeated"),
    cold: screen("cold"),
    external: screen("external", { external: input.externalHandoff }),
    mismatch: screen("mismatch"),
    cleanup: screen("cleanup"),
  };
  const anchors = [
    ["Beta", 0, 180],
    ["Alpha", 1, 420],
    ["Cold", 2, 700],
    ["External", 3, 980],
    ["Mismatch", 4, 1_260],
  ].map(([label, order, documentY]) => ({
    order: order as number,
    documentY: documentY as number,
    target: { label: label as string },
    label: label as string,
  }));
  return {
    schemaVersion: 1,
    id: scope.appMapId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    name: "Proof cursor fixture",
    revision: 1,
    notes: {},
    groups: {},
    screens,
    screenVariants: {
      "settings-en": {
        ...scope,
        id: "settings-en",
        screenId: "settings",
        targetProfile: {
          id: "fixture-ios",
          targetId: "fixture-tablet",
          source: "device",
          platform: "ios",
          name: "Fixture tablet",
          capabilities: [],
          observedAt: at,
        },
        evidenceIds: [],
        scrollSurfaces: [
          {
            id: "settings-surface",
            captureId: "settings-capture",
            capturedAt: at,
            semanticIndex: {
              schemaVersion: 1,
              documentHeight: 2_000,
              viewportHeight: 600,
              anchors,
            },
          },
        ],
        createdAt: at,
        updatedAt: at,
      } as unknown as AppMap["screenVariants"][string],
    },
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

function leaf(
  map: AppMap,
  input: {
    id: string;
    label: string;
    destinationScreenId: string;
    fromScreenId?: string;
    returnKind?: "back" | "none";
    external?: boolean;
  },
): Connection {
  const fromScreenId = input.fromScreenId ?? "settings";
  const result: Connection = {
    ...scope,
    id: input.id,
    fromScreenId,
    destination: { kind: "screen", screenId: input.destinationScreenId },
    state: "ready",
    actions: [
      {
        id: `tap-${input.id}`,
        kind: "tap",
        target: { label: input.label },
        ...(input.external ? { expectedApp: "com.apple.Preferences" } : {}),
      },
    ],
    navigation: {
      targetAlternatives: [{ kind: "accessibility", label: input.label }],
      expectedDestination: {
        screenId: input.destinationScreenId,
        identity: structuredClone(map.screens[input.destinationScreenId]!.identity!),
        evidenceIds: [],
      },
    },
    createdAt: at,
    updatedAt: at,
  };
  if (input.returnKind !== "none") {
    result.return = {
      kind: "back",
      expectedDestination: {
        screenId: fromScreenId,
        identity: structuredClone(map.screens[fromScreenId]!.identity!),
        evidenceIds: [],
      },
    };
  }
  return result;
}

function check(
  id: string,
  input: {
    originScreenId?: string;
    destinationScreenId?: string;
    warmSourceScreenId?: string;
    cleanup?: Check["cleanup"];
    coldRecipeId?: string;
    dependencies?: Check["transitionDependencies"];
  } = {},
): Check {
  const originScreenId = input.originScreenId ?? "settings";
  const destinationScreenId = input.destinationScreenId ?? id;
  return {
    id,
    title: `Check ${id}`,
    ...(input.warmSourceScreenId ? { warmSourceScreenId: input.warmSourceScreenId } : {}),
    transitionDependencies: input.dependencies ?? [
      {
        connectionId: id,
        originScreenId,
        destination: { kind: "screen", screenId: destinationScreenId },
      },
    ],
    ...(input.cleanup ? { cleanup: input.cleanup } : {}),
    ...(input.coldRecipeId
      ? {
          recovery: {
            groupId: `group:${id}`,
            recipeId: `confirm-${id}`,
            transitionId: id,
            mode: "warm-transition" as const,
            coldRecipeId: input.coldRecipeId,
          },
        }
      : {}),
  };
}

function recipe(id: string, steps: RecipeStep[]): Recipe {
  return { id, title: id, source: "custom", steps, createdAt: at, updatedAt: at };
}

function module(recipeId: string, value: Check): RecipeStep {
  return { kind: "module", recipeId, check: value };
}

function checkRecipe(
  id: string,
  label: string,
  options: { unresolvedReturn?: boolean; selector?: boolean } = {},
): Recipe {
  return recipe(id, [
    {
      kind: "expect-screen",
      id: `expect-settings-${id}`,
      screenId: "settings",
      screenTitle: "Settings",
      fingerprint: "settings".padEnd(64, "s"),
      ...(options.unresolvedReturn
        ? {
            returnRequirement: {
              connectionId: id,
              fromScreenId: id,
              destinationScreenId: "settings",
            },
          }
        : {}),
    },
    ...(options.selector
      ? [
          {
            kind: "tap" as const,
            id: `tap-${id}`,
            target: { label, role: "button" },
          },
        ]
      : []),
  ]);
}

/** Two leaves may intentionally converge on the same terminal state. In that
 * narrow case one exact ready inverse proves the return for both leaves; a
 * missing inline Back does not make the second leaf unsafe. */
function betaHasReviewedReturn(input: FixtureDescriptor): boolean {
  return (
    !input.betaMissingReturn ||
    (input.repeatedTerminal && !input.alphaHasDirectReturn && input.alphaHasInverseReturn)
  );
}

function compileFixture(seed: number): FixtureFixture {
  const input = descriptor(seed);
  const map = fixtureMap(input);
  const alphaTerminal = input.repeatedTerminal ? "repeated" : "alpha";
  const betaTerminal = input.repeatedTerminal ? "repeated" : "beta";
  map.connections.alpha = leaf(map, {
    id: "alpha",
    label: "Alpha",
    destinationScreenId: alphaTerminal,
    returnKind: input.alphaHasDirectReturn ? "back" : "none",
  });
  map.connections.beta = leaf(map, {
    id: "beta",
    label: "Beta",
    destinationScreenId: betaTerminal,
    returnKind: input.betaMissingReturn ? "none" : "back",
  });
  if (!input.alphaHasDirectReturn && input.alphaHasInverseReturn) {
    map.connections["alpha-return"] = leaf(map, {
      id: "alpha-return",
      label: "Done",
      fromScreenId: alphaTerminal,
      destinationScreenId: "settings",
      returnKind: "none",
    });
  }
  map.connections.cold = leaf(map, {
    id: "cold",
    label: "Cold",
    destinationScreenId: "cold",
  });
  map.connections.external = leaf(map, {
    id: "external",
    label: "External",
    destinationScreenId: "external",
    external: input.externalHandoff,
  });
  map.connections.mismatch = leaf(map, {
    id: "mismatch",
    label: "Mismatch",
    destinationScreenId: "mismatch",
  });

  const alpha = check("alpha", { destinationScreenId: alphaTerminal });
  const beta = check("beta", {
    destinationScreenId: betaTerminal,
    warmSourceScreenId: alphaTerminal,
  });
  const cold = check("cold", {
    warmSourceScreenId: betaTerminal,
    coldRecipeId: "cold-review-only",
  });
  const external = check("external", { warmSourceScreenId: "cold" });
  const mismatch = check("mismatch", {
    originScreenId: input.mismatchedOrigin ? "not-settings" : "settings",
    warmSourceScreenId: "settings",
  });
  const cleanup = check("cleanup", {
    cleanup: { recipeId: "ensure-cleanup", terminalScreenId: "cleanup", onCancel: "skip" },
  });
  const selector = check("selector", { dependencies: [] });
  const graph: Record<string, Recipe> = {
    root: recipe("root", [
      module("alpha", alpha),
      module("beta", beta),
      module("cold", cold),
      module("external", external),
      module("mismatch", mismatch),
      module("cleanup", cleanup),
      module("selector", selector),
    ]),
    alpha: checkRecipe("alpha", "Alpha"),
    beta: checkRecipe("beta", "Beta", { unresolvedReturn: !betaHasReviewedReturn(input) }),
    cold: checkRecipe("cold", "Cold"),
    external: checkRecipe("external", "External"),
    mismatch: checkRecipe("mismatch", "Mismatch"),
    cleanup: checkRecipe("cleanup", "Cleanup"),
    selector: checkRecipe("selector", "Duplicate", { selector: true }),
    "confirm-cold": recipe("confirm-cold", [
      {
        kind: "expect-screen",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint: "settings".padEnd(64, "s"),
      },
    ]),
    "cold-review-only": recipe("cold-review-only", [
      { kind: "app", action: "open", app: "com.example.app", relaunch: true },
      { kind: "key", key: "back" },
    ]),
    "ensure-cleanup": recipe("ensure-cleanup", [
      {
        kind: "expect-screen",
        screenId: "cleanup",
        screenTitle: "Cleanup",
        fingerprint: "cleanup".padEnd(64, "c"),
      },
    ]),
  };
  const scheduler = proposeAppMapTestExecutionSchedule(map, "root", graph);
  const plan: AppMapCompiledTest = {
    schemaVersion: 1,
    appMapId: map.id,
    appMapRevision: map.revision,
    test: {
      id: `cursor-fixture-${seed}`,
      name: `Cursor fixture ${seed}`,
      kind: "scenario",
      intentSchemaVersion: 1,
    },
    executionSchedule: scheduler,
    rootRecipeId: "root",
    recipes: Object.fromEntries(
      Object.values(graph).map((entry) => [
        entry.id,
        { id: entry.id, title: entry.title, parameters: [], steps: structuredClone(entry.steps) },
      ]),
    ),
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  };
  const duplicateNodes = input.selectorBlocked
    ? [
        {
          role: "button",
          label: "Duplicate",
          hittable: true,
          rect: { x: 20, y: 100, width: 320, height: 48 },
        },
        {
          role: "button",
          label: "Duplicate",
          hittable: true,
          rect: { x: 20, y: 200, width: 320, height: 48 },
        },
      ]
    : [
        {
          role: "button",
          label: "Duplicate",
          hittable: true,
          rect: { x: 20, y: 100, width: 320, height: 48 },
        },
      ];
  const evidence = {
    rawObservationsByScreenId: { settings: [duplicateNodes] },
    rawEvidenceReferencesByScreenId: { settings: [`fixture:${seed}:settings:raw-ax`] },
  } satisfies NonNullable<FixtureFixture["evidence"]>;
  const replayRun = replayFixture(plan, seed);
  return { descriptor: input, map, graph, plan, evidence, replayRun };
}

function replayFixture(plan: AppMapCompiledTest, seed: number): PersistedRun {
  const check = (
    id: string,
    title: string,
    status: "passed" | "failed",
    source: string,
    destination: string,
  ) => ({
    kind: "campaign-check-result" as const,
    capturedAt: at,
    data: {
      id,
      title,
      status,
      warmSourceScreenId: source,
      transitionDependencies: [
        {
          connectionId: id,
          originScreenId: source,
          destination: { kind: "screen", screenId: destination },
        },
      ],
    },
  });
  return {
    schemaVersion: 5,
    id: `cursor-fixture-run-${seed}`,
    action: "app-map:cursor-fixture",
    status: "error",
    attempts: 1,
    queuedAt: at,
    logs: [],
    steps: [],
    frames: [],
    dir: "/offline/cursor-fixture",
    writtenAt: at + 100,
    artifacts: [
      { kind: "app-map-test-plan", capturedAt: at, data: structuredClone(plan) },
      {
        kind: "navigation-proof-cursor",
        capturedAt: at + 1,
        data: {
          schemaVersion: 1,
          status: "proven",
          screenId: "settings",
          source: "screen-observation",
        },
      },
      {
        kind: "campaign-transition-proof",
        capturedAt: at + 2,
        data: { checkId: "alpha", connectionId: "alpha", status: "verified" },
      },
      { ...check("alpha", "Alpha", "passed", "settings", "alpha"), capturedAt: at + 3 },
      {
        kind: "navigation-proof-cursor",
        capturedAt: at + 4,
        data: { schemaVersion: 1, status: "proven", screenId: "alpha", source: "transition" },
      },
      // Its only proof arrives after this result. A replay may explain it,
      // but must never retroactively upgrade the pass to `proved`.
      { ...check("unproved-pass", "Unproved pass", "passed", "alpha", "beta"), capturedAt: at + 5 },
      {
        kind: "campaign-transition-proof",
        capturedAt: at + 6,
        data: { checkId: "unproved-pass", connectionId: "unproved-pass", status: "verified" },
      },
      {
        kind: "navigation-proof-cursor",
        capturedAt: at + 7,
        data: {
          schemaVersion: 1,
          status: "unknown",
          reason: "Unproved branch",
          previous: { screenId: "alpha" },
        },
      },
      {
        ...check("stale-descendant", "Stale descendant", "failed", "beta", "cold"),
        capturedAt: at + 8,
      },
      {
        ...check("independent-leaf", "Independent leaf", "failed", "alpha", "external"),
        capturedAt: at + 9,
      },
    ],
    inputDigest: "cursor-fixture",
    resolvedInputs: {},
  };
}

function compactDiagnostic(input: {
  fixture: FixtureFixture;
  schedule: ReturnType<typeof proposeAppMapTestExecutionSchedule>;
  preflight: ReturnType<typeof preflightCompiledAppMapTestOffline>;
  replay: ReturnType<typeof replayPersistedRunOffline>;
}): string {
  return JSON.stringify({
    seed: input.fixture.descriptor.seed,
    flags: input.fixture.descriptor,
    root: input.fixture.graph.root!.steps.map((step) =>
      step.kind === "module" && step.check
        ? {
            check: step.check.id,
            recipe: step.recipeId,
            origin: step.check.transitionDependencies?.[0]?.originScreenId,
          }
        : { kind: step.kind },
    ),
    schedule: input.schedule.checks.map((entry) => [
      entry.checkId,
      entry.authoredIndex,
      entry.proposedIndex,
      entry.disposition,
      entry.reason,
      entry.returnToSource?.kind,
    ]),
    deferred: input.schedule.deferredBranches,
    preflight: {
      summary: input.preflight.summary,
      findings: input.preflight.findings.map((finding) => [
        finding.severity,
        finding.code,
        finding.recipeId,
      ]),
    },
    replay: {
      summary: input.replay.summary,
      checks: input.replay.checks.map((entry) => [
        entry.id,
        entry.recordedStatus,
        entry.replayStatus,
      ]),
    },
  });
}

function assertScheduledProofs(
  fixture: FixtureFixture,
  schedule: ReturnType<typeof proposeAppMapTestExecutionSchedule>,
): void {
  for (const scheduled of schedule.checks.filter((entry) => entry.disposition === "scheduled")) {
    const dependency = fixture.graph.root!.steps.find(
      (step): step is RecipeStep & { check: Check } =>
        step.kind === "module" && step.check?.id === scheduled.checkId,
    )?.check.transitionDependencies?.[0];
    assert.ok(dependency, `${scheduled.checkId} scheduled without one direct dependency`);
    const connection = fixture.map.connections[dependency.connectionId];
    assert.ok(connection, `${scheduled.checkId} scheduled without its exact connection`);
    assert.equal(connection.state, "ready");
    assert.equal(connection.fromScreenId, dependency.originScreenId);
    assert.deepEqual(connection.destination, dependency.destination);
    assert.equal(scheduled.sourceScreenId, connection.fromScreenId);
    assert.ok(
      scheduled.returnToSource,
      `${scheduled.checkId} scheduled without reviewed return proof`,
    );
    assert.equal(scheduled.returnToSource?.sourceScreenId, connection.fromScreenId);
    assert.equal(
      scheduled.returnToSource?.terminalScreenId,
      connection.destination.kind === "screen" ? connection.destination.screenId : undefined,
    );
    if (scheduled.returnToSource?.kind === "back") {
      assert.equal(connection.return?.kind, "back", `${scheduled.checkId} invented a Back return`);
      assert.equal(connection.return?.expectedDestination.screenId, connection.fromScreenId);
    } else if (scheduled.returnToSource?.kind === "connection") {
      const inverseId = scheduled.returnToSource.connectionIds[0];
      const inverse = inverseId ? fixture.map.connections[inverseId] : undefined;
      assert.ok(inverse, `${scheduled.checkId} named a missing inverse return`);
      assert.equal(inverse?.state, "ready");
      assert.equal(
        inverse?.fromScreenId,
        connection.destination.kind === "screen" ? connection.destination.screenId : undefined,
      );
      assert.deepEqual(inverse?.destination, { kind: "screen", screenId: connection.fromScreenId });
    }
  }
}

function assertStaticFixtureFixture(fixture: FixtureFixture): void {
  const mapBefore = structuredClone(fixture.map);
  const graphBefore = structuredClone(fixture.graph);
  const planBefore = structuredClone(fixture.plan);
  const runBefore = structuredClone(fixture.replayRun);
  const schedule = proposeAppMapTestExecutionSchedule(fixture.map, "root", fixture.graph);
  const secondSchedule = proposeAppMapTestExecutionSchedule(
    structuredClone(fixture.map),
    "root",
    structuredClone(fixture.graph),
  );
  const preflight = preflightCompiledAppMapTestOffline(fixture.plan, fixture.evidence);
  const replay = replayPersistedRunOffline(fixture.replayRun);
  const secondReplay = replayPersistedRunOffline(structuredClone(fixture.replayRun));
  const explain = () =>
    compactDiagnostic({
      fixture,
      schedule,
      preflight,
      replay,
    });
  try {
    assert.deepEqual(fixture.map, mapBefore, "scheduler may not mutate an App Map");
    assert.deepEqual(fixture.graph, graphBefore, "scheduler may not rewrite a compiled graph");
    assert.deepEqual(fixture.plan, planBefore, "preflight may not rewrite a frozen plan");
    assert.deepEqual(fixture.replayRun, runBefore, "replay may not rewrite a persisted run");
    assert.deepEqual(secondSchedule, schedule, "one seed must produce one schedule");
    assert.deepEqual(secondReplay, replay, "one seed must produce one replay explanation");
    assertScheduledProofs(fixture, schedule);

    const byId = new Map(schedule.checks.map((entry) => [entry.checkId, entry]));
    const alpha = byId.get("alpha");
    const beta = byId.get("beta");
    const external = byId.get("external");
    const mismatch = byId.get("mismatch");
    const cleanup = byId.get("cleanup");
    const selector = byId.get("selector");
    assert.equal(cleanup?.disposition, "fixed");
    assert.equal(cleanup?.reason, "cleanup-boundary");
    assert.equal(selector?.disposition, "fixed");
    assert.equal(selector?.reason, "prerequisite-boundary");
    assert.ok(
      schedule.deferredBranches.some(
        (branch) => branch.checkId === "cold" && branch.recipeId === "cold-review-only",
      ),
      "cold recovery belongs to review-only branches",
    );
    assert.equal(
      schedule.checks.some((entry) => entry.recipeId === "cold-review-only"),
      false,
      "a proposed cold recipe must never join the warm schedule",
    );
    assert.ok(
      schedule.checks
        .filter((entry) => entry.returnToSource?.kind === "back")
        .every((entry) => fixture.map.connections[entry.checkId]?.return?.kind === "back"),
      "the scheduler cannot synthesize hidden Back navigation",
    );
    if (fixture.descriptor.externalHandoff) {
      assert.deepEqual([external?.disposition, external?.reason], ["deferred", "external-handoff"]);
    }
    if (fixture.descriptor.mismatchedOrigin) {
      assert.deepEqual([mismatch?.disposition, mismatch?.reason], ["deferred", "unknown-cursor"]);
    }
    if (!fixture.descriptor.alphaHasDirectReturn && !fixture.descriptor.alphaHasInverseReturn) {
      assert.deepEqual([alpha?.disposition, alpha?.reason], ["fixed", "missing-reviewed-return"]);
    }
    if (!betaHasReviewedReturn(fixture.descriptor)) {
      assert.deepEqual([beta?.disposition, beta?.reason], ["fixed", "missing-reviewed-return"]);
    }
    const canReorder =
      (fixture.descriptor.alphaHasDirectReturn || fixture.descriptor.alphaHasInverseReturn) &&
      betaHasReviewedReturn(fixture.descriptor);
    if (canReorder) {
      assert.equal(alpha?.disposition, "scheduled");
      assert.equal(beta?.disposition, "scheduled");
      assert.ok(
        (beta?.proposedIndex ?? Number.MAX_SAFE_INTEGER) < (alpha?.proposedIndex ?? -1),
        "reviewed sibling leaves should use frozen document order",
      );
    }
    if (fixture.descriptor.repeatedTerminal && canReorder) {
      assert.equal(alpha?.returnToSource?.terminalScreenId, "repeated");
      assert.equal(beta?.returnToSource?.terminalScreenId, "repeated");
      assert.notEqual(
        alpha?.checkId,
        beta?.checkId,
        "repeated states never merge independent checks",
      );
    }

    assert.ok(
      preflight.cursorTimeline.every((cursor) =>
        ["expected", "unknown", "return-required"].includes(cursor.state),
      ),
      "offline preflight may describe proof requirements but never grant a pass",
    );
    const selectorReport = preflight.selectors.find((entry) => entry.recipeId === "selector");
    if (fixture.descriptor.selectorBlocked) {
      assert.equal(selectorReport?.status, "ambiguous");
      assert.ok(
        preflight.findings.some(
          (finding) => finding.code === "selector-ambiguous" && finding.severity === "blocker",
        ),
      );
    } else {
      assert.equal(selectorReport?.status, "resolved");
    }
    if (!betaHasReviewedReturn(fixture.descriptor)) {
      assert.ok(
        preflight.findings.some((finding) => finding.code === "unresolved-return"),
        "a missing reviewed return must remain an explicit blocker",
      );
    }

    assert.deepEqual(replay.summary, {
      checks: 4,
      proved: 1,
      rootFailures: 1,
      invalidCascades: 1,
      independentFailures: 1,
    });
    assert.equal(
      replay.checks.find((entry) => entry.id === "unproved-pass")?.replayStatus,
      "root-failure",
    );
    assert.equal(replay.firstRootFailure?.kind, "unproved-pass");
    assert.equal(
      replay.checks.find((entry) => entry.id === "stale-descendant")?.replayStatus,
      "invalid-cascade",
    );
    assert.equal(
      replay.checks.find((entry) => entry.id === "independent-leaf")?.replayStatus,
      "independent-failure",
    );
    assert.ok(
      replay.repairProposals.every(
        (proposal) => proposal.mutation === "none" && proposal.requiresReview,
      ),
      "offline replay must only propose reviewed repair work",
    );
  } catch (error) {
    throw new Error(`proof-cursor fixture seed failed: ${explain()}`, { cause: error });
  }
}

function observationOnlyDevice(): Device {
  return {
    capture: {
      snapshot: async () => ({
        nodes: [
          {
            role: "button",
            identifier: "settings",
            label: "Settings",
            hittable: true,
            rect: { x: 20, y: 40, width: 300, height: 48 },
          },
        ],
      }),
      // Failure packages deliberately attempt to attach pixels. This fake is
      // a browser target, so a missing raster is captured as unavailable and
      // cannot fall through to adb/go-ios during an offline contract test.
      screenshot: async () => {
        throw new Error("offline proof-cursor fixture has no pixel source");
      },
    },
  } as unknown as Device;
}

function runtimeContext(id: string): RecipeStepContext & { job: TestJob } {
  return {
    log: () => {},
    runtime: {},
    job: { id, artifacts: [] } as unknown as TestJob,
  };
}

function sourceProofRecipe(id: string, screenId: string): Recipe {
  return recipe(id, [
    {
      kind: "expect-screen",
      id: `source-${id}`,
      screenId,
      screenTitle: screenId,
      fingerprint: screenId.padEnd(64, screenId[0] ?? "x"),
    },
  ]);
}

async function runRuntimeCheck(
  ctx: RecipeStepContext,
  value: Check,
  execute: (recipeId?: string) => Promise<void>,
): Promise<void> {
  await runWithTargetContext(
    { kind: "browser", platform: "browser", targetId: "cursor-fixture" },
    () =>
      runCampaignCheck(
        observationOnlyDevice(),
        { kind: "sleep", ms: 1, check: value },
        ctx,
        execute,
      ),
  );
}

test("proof-cursor fixture is deterministic, device-free, and proof-preserving", () => {
  const first = SEEDS.map((seed) => compileFixture(seed));
  const second = SEEDS.map((seed) => compileFixture(seed));
  assert.deepEqual(
    second.map((fixture) => fixture.descriptor),
    first.map((fixture) => fixture.descriptor),
    "fixture inputs are seeded and reproducible",
  );
  for (const fixture of first) assertStaticFixtureFixture(fixture);
});

test("cursor firewall blocks unproven warm mutations but permits one exact source-confirmed leaf", async () => {
  const sourceToChild = {
    connectionId: "open-child",
    originScreenId: "settings",
    destination: { kind: "screen" as const, screenId: "child" },
  };
  const canonicalRecovery = {
    groupId: "open-child",
    recipeId: "confirm-settings-to-child",
    transitionId: "open-child",
    mode: "warm-transition" as const,
    coldRecipeId: "cold-review-only",
  };

  const unknown = runtimeContext("cursor-unknown");
  unknown.runtime!.navigationCursor = {
    status: "unknown",
    reason: "A destination did not prove its reviewed return.",
    updatedAt: at,
  };
  const blockedMutations: string[] = [];
  await runRuntimeCheck(
    unknown,
    {
      id: "unsafe",
      title: "Unsafe",
      warmSourceScreenId: "settings",
      transitionDependencies: [sourceToChild],
    },
    async (recipeId) => {
      blockedMutations.push(recipeId ?? "warm");
    },
  );
  assert.deepEqual(blockedMutations, []);

  const external = runtimeContext("cursor-external");
  external.runtime!.navigationCursor = {
    status: "external-handoff",
    foregroundApp: "com.apple.Preferences",
    reason: "Settings opened system preferences.",
    updatedAt: at,
    previous: { screenId: "settings", proofToken: "previous-settings" },
  };
  external.recipeGraph = {
    [canonicalRecovery.recipeId]: sourceProofRecipe(canonicalRecovery.recipeId, "settings"),
  };
  const externalMutations: string[] = [];
  await runRuntimeCheck(
    external,
    {
      id: "external-canonical",
      title: "External canonical",
      warmSourceScreenId: "settings",
      transitionDependencies: [sourceToChild],
      recovery: canonicalRecovery,
    },
    async (recipeId) => {
      externalMutations.push(recipeId ?? "warm");
    },
  );
  assert.deepEqual(
    externalMutations,
    [],
    "an external handoff cannot authorize an in-app warm leaf",
  );

  const canonical = runtimeContext("cursor-canonical");
  canonical.runtime!.navigationCursor = {
    status: "unknown",
    reason: "The previous child return was not proved.",
    updatedAt: at,
  };
  canonical.recipeGraph = {
    [canonicalRecovery.recipeId]: sourceProofRecipe(canonicalRecovery.recipeId, "settings"),
  };
  const canonicalExecutions: string[] = [];
  await runRuntimeCheck(
    canonical,
    {
      id: "source-proven-leaf",
      title: "Source proven leaf",
      warmSourceScreenId: "settings",
      transitionDependencies: [sourceToChild],
      recovery: canonicalRecovery,
    },
    async (recipeId) => {
      canonicalExecutions.push(recipeId ?? "warm");
    },
  );
  assert.deepEqual(canonicalExecutions, [canonicalRecovery.recipeId]);
  assert.equal(
    canonical.runtime?.campaignTransitionProofs?.[sourceToChild.connectionId]?.status,
    "verified",
  );
  assert.equal(canonical.runtime?.navigationCursor?.status, "proven");

  const cleanup = runtimeContext("cursor-cleanup");
  cleanup.runtime!.navigationCursor = {
    status: "proven",
    screenId: "settings",
    proofToken: "settings-proof",
    source: "screen-observation",
    updatedAt: at,
  };
  const cleanupExecutions: string[] = [];
  await runRuntimeCheck(
    cleanup,
    {
      id: "stateful-cleanup",
      title: "Stateful cleanup",
      warmSourceScreenId: "settings",
      transitionDependencies: [sourceToChild],
      cleanup: { recipeId: "ensure-off", terminalScreenId: "off", onCancel: "skip" },
    },
    async (recipeId) => {
      cleanupExecutions.push(recipeId ?? "warm");
      if (recipeId === "ensure-off") throw new Error("Cleanup terminal did not prove off");
    },
  );
  assert.equal(cleanup.runtime?.navigationCursor?.status, "unknown");
  await runRuntimeCheck(
    cleanup,
    {
      id: "after-cleanup",
      title: "After cleanup",
      warmSourceScreenId: "settings",
      transitionDependencies: [sourceToChild],
    },
    async (recipeId) => {
      cleanupExecutions.push(recipeId ?? "warm-after-cleanup");
    },
  );
  assert.deepEqual(cleanupExecutions, ["warm", "ensure-off"]);
  assert.ok(
    cleanup.job.artifacts.some((artifact) => artifact.kind === "campaign-cursor-firewall"),
    "a failed cleanup leaves one durable no-mutation firewall package",
  );
});
