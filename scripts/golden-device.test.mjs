import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GoldenAcceptanceError,
  GoldenArtifactWriter,
  assertGoldenSemanticSnapshot,
  createGoldenApi,
  parseGoldenFixtureConfig,
  runGoldenFixtureAcceptance,
  selectConfiguredFixtures,
  validateGoldenFaultReceipt,
  validateGoldenScenarioRecipe,
} from "./golden-device-lib.mjs";
import {
  createFakeGoldenApi,
  fakeGoldenFaultReceipt,
  goldenConfig,
  goldenRecipe,
  recordingArtifacts,
} from "./golden-device-test-support.mjs";

const strictFixture = {
  platform: "android",
  app: "com.example.relayfixture",
};

test("strict golden semantics reject empty, uninspectable, and wrong-app snapshots", () => {
  const usableNode = {
    identifier: "fixture-home",
    role: "button",
    rect: { x: 1, y: 1, width: 44, height: 44 },
    bundleId: strictFixture.app,
  };
  assert.throws(
    () =>
      assertGoldenSemanticSnapshot(
        { inspectable: true, foregroundApp: strictFixture.app, nodes: [] },
        strictFixture,
      ),
    (error) => error instanceof GoldenAcceptanceError && error.code === "GOLDEN_SNAPSHOT_UNUSABLE",
  );
  assert.throws(
    () =>
      assertGoldenSemanticSnapshot(
        { inspectable: false, foregroundApp: strictFixture.app, nodes: [usableNode] },
        strictFixture,
      ),
    (error) => error instanceof GoldenAcceptanceError && error.code === "GOLDEN_SNAPSHOT_UNUSABLE",
  );
  assert.throws(
    () =>
      assertGoldenSemanticSnapshot(
        {
          inspectable: true,
          foregroundApp: "com.example.other",
          nodes: [{ ...usableNode, bundleId: "com.example.other" }],
        },
        strictFixture,
      ),
    (error) => error instanceof GoldenAcceptanceError && error.code === "GOLDEN_SNAPSHOT_WRONG_APP",
  );
});

test("strict acceptance executes exact Android+iOS fixtures and preserves an evidence bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults, faultCalls } = createFakeGoldenApi();
    const summary = await runGoldenFixtureAcceptance({
      config,
      api,
      faults,
      artifacts: new GoldenArtifactWriter(root),
      jobTimeoutMs: 100,
      pollIntervalMs: 1,
      now: () => 2_000,
      sleep: async () => undefined,
    });
    assert.equal(summary.status, "passed");
    assert.equal(summary.parallelScheduling.overlapMs, 100);
    assert.deepEqual(summary.parallelScheduling.workerIds.sort(), [
      "local:android:target:android-fixture",
      "local:ios:target:ios-fixture",
    ]);
    assert.ok(api.calls.some((call) => call.operationId === "target.recover"));
    assert.ok(api.calls.some((call) => call.operationId === "run.replay"));
    assert.ok(api.calls.some((call) => call.operationId === "step.run"));
    assert.equal(
      faultCalls.filter((call) => call.operation === "disrupt").length,
      4,
      "both exact host faults are injected once per configured fixture",
    );
    const lastRecipeValidation = Math.max(
      ...api.calls
        .map((call, index) => (call.operationId === "recipe.get" ? index : -1))
        .filter((index) => index >= 0),
    );
    const firstFixtureMutation = api.calls.findIndex(
      (call) => call.operationId === "target.recover" || call.operationId === "target.app.launch",
    );
    assert.ok(lastRecipeValidation >= 0);
    assert.ok(
      firstFixtureMutation > lastRecipeValidation,
      "all recipe contracts are checked before either fixture is recovered or launched",
    );
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "passed");
    assert.equal(manifest.config.fixtures.ios.serial, undefined);
    await readFile(join(root, "fixtures/ios/preflight/before.png"));
    await readFile(join(root, "fixtures/android/preflight/tree.json"));
    await readFile(join(root, "fixtures/android/jobs/pointInput-finished.json"));
    await readFile(join(root, "fixtures/ios/faults/runnerKillMidSession/disruption-receipt.json"));
    await readFile(join(root, "fixtures/ios/faults/ddiUnmountRecover/restoration-receipt.json"));
    await readFile(join(root, "fixtures/ios/faults/ddiUnmountRecover/post-fault-proof.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ordinary recipes cannot impersonate required host fault injection", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config } = createFakeGoldenApi();
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_FAULT_INJECTOR_MISSING",
    );
    assert.equal(
      api.calls.some(
        (call) => call.operationId === "target.recover" || call.operationId === "job.start",
      ),
      false,
      "fault injection is required before either fixture is touched",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fault receipts are exact, target-bound, single-attempt, and bounded", () => {
  const fixture = parseGoldenFixtureConfig(goldenConfig()).fixtures.ios;
  const expected = {
    invocationId: "fault-invocation",
    scenario: "ddiUnmountRecover",
    phase: "disruption",
    fixture,
    startedAt: 1_000,
    deadlineAt: 1_100,
  };
  const valid = fakeGoldenFaultReceipt({ ...expected, finishedAt: 1_050 });
  assert.equal(validateGoldenFaultReceipt(valid, expected), valid);

  for (const invalid of [
    { ...valid, attempts: 2 },
    { ...valid, finishedAt: 1_101 },
    { ...valid, target: { ...valid.target, serialFingerprint: "different-target" } },
    { ...valid, proof: { kind: "ordinary-recipe", observed: true } },
    { ...valid, unexpected: true },
  ]) {
    assert.throws(
      () => validateGoldenFaultReceipt(invalid, expected),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_FAULT_DISRUPTION_UNPROVEN",
    );
  }
});

test("a malformed disruption receipt blocks the recipe but still proves restoration", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults, faultCalls } = createFakeGoldenApi({
      invalidFaultReceiptScenario: "runnerKillMidSession",
      invalidFaultReceiptPhase: "disruption",
      invalidFaultReceiptKind: "wrong-proof",
    });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_FAULT_DISRUPTION_UNPROVEN",
    );
    assert.equal(
      api.calls.some(
        (call) =>
          call.operationId === "job.start" && String(call.body?.recipe).endsWith("-runner-kill"),
      ),
      false,
      "an ordinary runner-kill recipe never starts without exact disruption proof",
    );
    assert.equal(
      faultCalls.filter((call) => call.operation === "confirmRestored").length,
      2,
      "both fixtures are restored after their disruption attempts",
    );
    await readFile(join(root, "fixtures/ios/faults/runnerKillMidSession/restoration-receipt.json"));
    await readFile(join(root, "fixtures/ios/restored-runnerKillMidSession/after.png"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a post-fault recipe cannot pass when host restoration is unproven", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults } = createFakeGoldenApi({
      failFaultRestorationScenario: "runnerKillMidSession",
    });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      /restoration/u,
    );
    await readFile(join(root, "fixtures/ios/faults/runnerKillMidSession/post-fault-proof.json"));
    await readFile(join(root, "fixtures/ios/faults/runnerKillMidSession/restoration-error.json"));
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host disruption is actively timed out and then restored", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults, faultCalls } = createFakeGoldenApi({
      hangFaultScenario: "runnerKillMidSession",
    });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        faultTimeoutMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) => error instanceof GoldenAcceptanceError && error.code === "GOLDEN_FAULT_TIMEOUT",
    );
    assert.equal(faultCalls.filter((call) => call.operation === "confirmRestored").length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a terminal normal job routed to another fixture fails closed after durable drain", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults } = createFakeGoldenApi({
      wrongTerminalTarget: "proofReplay",
    });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_JOB_TARGET_MISMATCH",
    );
    await readFile(join(root, "fixtures/android/jobs/proofReplay-finished.json"));
    await readFile(join(root, "fixtures/ios/jobs/proofReplay-finished.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a terminal replay job routed to another fixture fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults } = createFakeGoldenApi({ wrongReplayTerminalTarget: true });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_JOB_TARGET_MISMATCH",
    );
    await readFile(join(root, "fixtures/android/jobs/proof-replay-finished.json"));
    await readFile(join(root, "fixtures/ios/jobs/proof-replay-finished.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a rejected parallel start drains sibling jobs and their evidence before final capture", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults, parallelJobIds } = createFakeGoldenApi({
      failParallelStartPlatform: "ios",
    });
    const events = [];
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: recordingArtifacts(root, events),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RELAY_REQUEST_FAILED",
    );
    assert.equal(parallelJobIds.length, 1);
    const parallelJobId = parallelJobIds[0];
    assert.equal(typeof parallelJobId, "string");
    assert.ok(
      api.calls.some(
        (call) => call.operationId === "job.get" && call.path === `/jobs/${parallelJobId}`,
      ),
      "a sibling job is polled to durable terminal completion after the other admission fails",
    );
    const finishedEvidence = "json:fixtures/android/jobs/parallel-scheduling-finished.json";
    const finalCapture = "screenshot:fixtures/android/final/screen.png";
    assert.ok(events.includes(finishedEvidence));
    assert.ok(events.indexOf(finishedEvidence) < events.indexOf(finalCapture));
    await readFile(join(root, "fixtures/android/jobs/parallel-scheduling-finished.json"));
    await readFile(join(root, "fixtures/ios/jobs/parallel-scheduling-start-error.json"));
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a misrouted parallel start response fails after every fixture job drains", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults, parallelJobIds } = createFakeGoldenApi({
      wrongParallelStartPlatform: "ios",
    });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_JOB_TARGET_MISMATCH",
    );
    assert.equal(parallelJobIds.length, 2);
    for (const jobId of parallelJobIds) {
      assert.ok(
        api.calls.some((call) => call.operationId === "job.get" && call.path === `/jobs/${jobId}`),
      );
    }
    await readFile(join(root, "fixtures/android/jobs/parallel-scheduling-finished.json"));
    await readFile(join(root, "fixtures/ios/jobs/parallel-scheduling-finished.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("configured hardware never falls back to another ready target", () => {
  const config = parseGoldenFixtureConfig(goldenConfig());
  assert.throws(
    () =>
      selectConfiguredFixtures(
        [
          {
            serial: "android-fixture",
            platform: "android",
            name: "android fixture",
            kind: "Physical device",
            osVersion: "18.0",
            booted: true,
          },
          {
            serial: "some-other-ios-device",
            platform: "ios",
            name: "ios fixture",
            kind: "Physical device",
            osVersion: "18.0",
            booted: true,
            developerMode: "enabled",
            developerServicesAvailable: true,
          },
        ],
        config,
      ),
    (error) => error instanceof GoldenAcceptanceError && error.code === "GOLDEN_FIXTURE_MISSING",
  );
});

test("a missing configured fixture fails closed and still writes the inventory manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults } = createFakeGoldenApi({ missingFixture: "ios" });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) => error instanceof GoldenAcceptanceError && error.code === "GOLDEN_FIXTURE_MISSING",
    );
    assert.equal(
      api.calls.some(
        (call) => call.operationId === "target.recover" || call.operationId === "target.app.launch",
      ),
      false,
    );
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "failed");
    assert.equal(manifest.error.code, "GOLDEN_FIXTURE_MISSING");
    await readFile(join(root, "fixture-contract.json"));
    await readFile(join(root, "devices.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hardware acceptance rejects an ambiguous duplicate fixture inventory", () => {
  const config = parseGoldenFixtureConfig(goldenConfig());
  const android = {
    serial: "android-fixture",
    platform: "android",
    name: "android fixture",
    kind: "Physical device",
    osVersion: "18.0",
    booted: true,
    connectionState: "connected",
  };
  assert.throws(
    () =>
      selectConfiguredFixtures(
        [
          android,
          { ...android },
          {
            serial: "ios-fixture",
            platform: "ios",
            name: "ios fixture",
            kind: "Physical device",
            osVersion: "18.0",
            booted: true,
            developerMode: "enabled",
            developerServicesAvailable: true,
          },
        ],
        config,
      ),
    (error) => error instanceof GoldenAcceptanceError && error.code === "GOLDEN_FIXTURE_AMBIGUOUS",
  );
});

test("quarantined acceptance rejects unexpected attached physical hardware", () => {
  const config = parseGoldenFixtureConfig(goldenConfig());
  assert.throws(
    () =>
      selectConfiguredFixtures(
        [
          {
            serial: "android-fixture",
            platform: "android",
            name: "android fixture",
            kind: "Physical device",
            osVersion: "18.0",
            booted: true,
            connectionState: "connected",
          },
          {
            serial: "ios-fixture",
            platform: "ios",
            name: "ios fixture",
            kind: "Physical device",
            osVersion: "18.0",
            booted: true,
            developerMode: "enabled",
            developerServicesAvailable: true,
          },
          {
            serial: "unexpected-private-serial",
            platform: "android",
            name: "unrelated phone",
            kind: "Physical device",
            booted: true,
            connectionState: "connected",
          },
        ],
        config,
      ),
    (error) => {
      assert.ok(error instanceof GoldenAcceptanceError);
      assert.equal(error.code, "GOLDEN_FIXTURE_UNEXPECTED");
      assert.doesNotMatch(error.message, /unexpected-private-serial/u);
      return true;
    },
  );
});

test("a relation-based semantic resolution is accepted as semantic evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults } = createFakeGoldenApi({
      semanticResolutionStrategy: "relation",
    });
    const summary = await runGoldenFixtureAcceptance({
      config,
      api,
      faults,
      artifacts: new GoldenArtifactWriter(root),
      jobTimeoutMs: 100,
      pollIntervalMs: 1,
      now: () => 2_000,
      sleep: async () => undefined,
    });
    assert.equal(summary.status, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hardware acceptance refuses an emulator even when its configured serial is present", () => {
  const config = parseGoldenFixtureConfig(goldenConfig());
  assert.throws(
    () =>
      selectConfiguredFixtures(
        [
          {
            serial: "android-fixture",
            platform: "android",
            name: "android fixture",
            kind: "Emulator",
            osVersion: "18.0",
            booted: true,
            connectionState: "connected",
          },
          {
            serial: "ios-fixture",
            platform: "ios",
            name: "ios fixture",
            kind: "Physical device",
            osVersion: "18.0",
            booted: true,
            developerMode: "enabled",
            developerServicesAvailable: true,
          },
        ],
        config,
      ),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_FIXTURE_NOT_HARDWARE",
  );
});

test("transport does not echo sensitive Relay error payloads into CI output", async () => {
  const api = createGoldenApi({
    baseUrl: "http://relay.example.test",
    fetch: async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: "fixture serial TOP-SECRET-UDID" }),
    }),
  });
  await assert.rejects(
    api.request({
      operationId: "target.snapshot.capture",
      path: "/snapshot?serial=TOP-SECRET-UDID",
    }),
    (error) => {
      assert.ok(error instanceof GoldenAcceptanceError);
      assert.doesNotMatch(error.message, /TOP-SECRET-UDID/u);
      assert.match(error.message, /HTTP 409/u);
      return true;
    },
  );
});

test("fixture configuration requires every real acceptance scenario", () => {
  const invalid = goldenConfig();
  delete invalid.fixtures.ios.scenarios.pointInput;
  assert.throws(
    () => parseGoldenFixtureConfig(invalid),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_FIXTURE_CONFIG_INVALID",
  );
});

test("recipe contract refuses a mislabeled delayed semantic fallback", () => {
  assert.throws(
    () =>
      validateGoldenScenarioRecipe(
        {
          id: "bad",
          steps: [
            { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
            { kind: "tap", target: { identifier: "only-semantic" } },
            { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
          ],
        },
        "delayedSemanticFallback",
        20,
      ),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
  );
});

test("semantic-only and point-only recipes reject hidden cross-mode fallbacks", () => {
  const semanticWithCoordinateFallback = goldenRecipe(
    "semantic-coordinate-fallback",
    "semanticInput",
  );
  semanticWithCoordinateFallback.steps[1].fallbackTargets = [{ point: { x: 20, y: 30 } }];
  assert.throws(
    () => validateGoldenScenarioRecipe(semanticWithCoordinateFallback, "semanticInput", 20),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
  );

  const semanticWithEvidencePoint = goldenRecipe("semantic-evidence-point", "semanticInput");
  semanticWithEvidencePoint.steps[1].evidence = {
    candidates: [{ target: { point: { x: 20, y: 30 } } }],
  };
  assert.throws(
    () => validateGoldenScenarioRecipe(semanticWithEvidencePoint, "semanticInput", 20),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
  );

  const pointWithSemanticFallback = goldenRecipe("point-semantic-fallback", "pointInput");
  pointWithSemanticFallback.steps[1].fallbackTargets = [{ identifier: "semantic-escape" }];
  assert.throws(
    () => validateGoldenScenarioRecipe(pointWithSemanticFallback, "pointInput", 20),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
  );

  const semanticWithPointTap = goldenRecipe("semantic-with-point-tap", "semanticInput");
  semanticWithPointTap.steps.push(
    { kind: "tap", target: { point: { x: 20, y: 30 } } },
    { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
  );
  assert.throws(
    () => validateGoldenScenarioRecipe(semanticWithPointTap, "semanticInput", 20),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
  );

  const pointWithSemanticTap = goldenRecipe("point-with-semantic-tap", "pointInput");
  pointWithSemanticTap.steps.push(
    { kind: "tap", target: { identifier: "semantic-escape" } },
    { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
  );
  assert.throws(
    () => validateGoldenScenarioRecipe(pointWithSemanticTap, "pointInput", 20),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
  );
});

test("every golden scenario brackets every physical input with entrance and exit proof", () => {
  for (const scenario of [
    "proofReplay",
    "delayedSemanticFallback",
    "semanticInput",
    "pointInput",
    "parallelScheduling",
  ]) {
    const unproven = goldenRecipe(`unproven-${scenario}`, scenario);
    unproven.steps = unproven.steps.filter((step) => step.kind !== "expect");
    assert.throws(
      () => validateGoldenScenarioRecipe(unproven, scenario, 20),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
      `${scenario} must not accept input without proof`,
    );
  }

  const chainedInputs = goldenRecipe("unproven-chain", "proofReplay");
  chainedInputs.steps = [
    { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
    { kind: "tap", target: { identifier: "first-input" } },
    { kind: "tap", target: { identifier: "second-input" } },
    { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
  ];
  assert.throws(
    () => validateGoldenScenarioRecipe(chainedInputs, "proofReplay", 20),
    /physical input 1/u,
  );
});

test("strict golden recipes cover every direct device mutator and reject opaque control flow", () => {
  const physicalInputs = [
    { kind: "tap", target: { identifier: "tap-control" } },
    { kind: "type", text: "fixture text", target: { identifier: "field" } },
    { kind: "scroll", direction: "down" },
    { kind: "reveal", target: { identifier: "revealed-control" } },
    { kind: "swipe", from: { x: 20, y: 80 }, to: { x: 20, y: 20 } },
    { kind: "key", key: "back" },
    { kind: "clipboard", action: "paste", target: { identifier: "field" } },
    { kind: "app", action: "open", app: "com.example.fixture" },
    { kind: "device", action: "keyboard-dismiss" },
    { kind: "rotate", orientation: "landscape-left" },
    { kind: "settings", setting: "wifi", state: "on" },
    { kind: "location", latitude: 1, longitude: 2 },
    { kind: "permission", action: "grant", permission: "camera" },
    { kind: "alert", action: "accept" },
  ];
  for (const physicalInput of physicalInputs) {
    const unbracketed = goldenRecipe(`unbracketed-${physicalInput.kind}`, "proofReplay");
    unbracketed.steps = [
      { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
      physicalInput,
      { kind: "tap", target: { identifier: "next-control" } },
      { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
    ];
    assert.throws(
      () => validateGoldenScenarioRecipe(unbracketed, "proofReplay", 20),
      /physical input 1/u,
      `${physicalInput.kind} cannot bypass an exit assertion`,
    );
  }

  for (const kind of ["capture-surface", "tour", "flow", "module", "branch", "repeat", "script"]) {
    const opaque = goldenRecipe(`opaque-${kind}`, "proofReplay");
    opaque.steps[1] = { kind };
    assert.throws(
      () => validateGoldenScenarioRecipe(opaque, "proofReplay", 20),
      new RegExp(kind, "u"),
    );
  }

  const conditional = goldenRecipe("conditional-input", "proofReplay");
  conditional.steps[1].when = {
    target: { identifier: "fixture-home" },
    condition: "present",
  };
  assert.throws(() => validateGoldenScenarioRecipe(conditional, "proofReplay", 20), /conditional/u);
});

test("a normal semantic pass cannot falsely satisfy the delayed-tree fallback scenario", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults } = createFakeGoldenApi({ omitDelayedFallback: true });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_SCENARIO_UNPROVEN",
    );
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "failed");
    await readFile(join(root, "fixtures/android/final/screen.png"));
    await readFile(join(root, "fixtures/ios/final/tree.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unrelated failed semantic target cannot prove the delayed fallback path", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults } = createFakeGoldenApi({ unrelatedDelayedFallback: true });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_SCENARIO_UNPROVEN",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing recipe prevents every recovery, launch, and fixture evidence claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults } = createFakeGoldenApi({
      missingRecipe: "golden-ios-point",
    });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
    );
    assert.equal(
      api.calls.some(
        (call) =>
          call.operationId === "target.recover" ||
          call.operationId === "target.app.launch" ||
          call.operationId === "target.snapshot.capture" ||
          call.operationId === "target.screenshot.capture",
      ),
      false,
    );
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "failed");
    assert.equal(manifest.recipeValidationFailures.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a packaged flow cannot impersonate a reviewed fixture recipe", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults } = createFakeGoldenApi({ recipeSource: "builtin" });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
    );
    assert.equal(
      api.calls.some(
        (call) => call.operationId === "target.recover" || call.operationId === "target.app.launch",
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed landscape capture restores portrait and still collects final fixture evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config, faults } = createFakeGoldenApi({ failLandscapeCapture: true });
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
        faults,
        artifacts: new GoldenArtifactWriter(root),
        jobTimeoutMs: 100,
        pollIntervalMs: 1,
        now: () => 2_000,
        sleep: async () => undefined,
      }),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_SCREENSHOT_MISSING",
    );
    const androidRotationCalls = api.calls.filter(
      (call) => call.path === "/step/run" && call.body.serial === "android-fixture",
    );
    const landscapeIndex = androidRotationCalls.findIndex(
      (call) => call.body.step.orientation === "landscape-left",
    );
    const restoreIndex = androidRotationCalls.findIndex(
      (call) => call.body.step.orientation === "portrait",
    );
    assert.ok(landscapeIndex >= 0);
    assert.ok(
      restoreIndex > landscapeIndex,
      "portrait restoration runs after failed landscape proof",
    );

    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "failed");
    assert.equal(manifest.fixtureSuiteFailures.length, 2);
    await readFile(join(root, "fixtures/android/rotation-entrance/screen.png"));
    await readFile(join(root, "fixtures/android/rotation-landscape-error.json"));
    await readFile(join(root, "fixtures/android/rotation-restore.json"));
    await readFile(join(root, "fixtures/android/final/screen.png"));
    await readFile(join(root, "fixtures/ios/final/tree.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
