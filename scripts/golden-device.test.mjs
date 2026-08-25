import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GoldenAcceptanceError,
  GoldenArtifactWriter,
  createGoldenApi,
  parseGoldenFixtureConfig,
  runGoldenFixtureAcceptance,
  selectConfiguredFixtures,
  validateGoldenScenarioRecipe,
} from "./golden-device-lib.mjs";

const pixels = Buffer.from("relay-golden-pixels").toString("base64");

function recipe(id, scenario) {
  switch (scenario) {
    case "proofReplay":
      return {
        id,
        title: id,
        source: "custom",
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          { kind: "tap", target: { identifier: "fixture-open" } },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
        ],
      };
    case "delayedSemanticFallback":
      return {
        id,
        title: id,
        source: "custom",
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          {
            kind: "tap",
            target: { identifier: "delayed-control" },
            fallbackTargets: [{ point: { x: 20, y: 30 } }],
          },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
        ],
      };
    case "semanticInput":
      return {
        id,
        title: id,
        source: "custom",
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          { kind: "tap", target: { identifier: "semantic-control" } },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
        ],
      };
    case "pointInput":
      return {
        id,
        title: id,
        source: "custom",
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          { kind: "tap", target: { point: { x: 31, y: 41 } } },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
        ],
      };
    case "parallelScheduling":
      return {
        id,
        title: id,
        source: "custom",
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          { kind: "tap", target: { identifier: "fixture-open" } },
          { kind: "sleep", ms: 50 },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
        ],
      };
    case "runnerKillMidSession":
    case "ddiUnmountRecover":
      return {
        id,
        title: id,
        source: "custom",
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          { kind: "device", action: "keyboard-dismiss" },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
        ],
      };
    case "appHandoffToSettings":
      return {
        id,
        title: id,
        source: "custom",
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          { kind: "app", action: "open", app: "com.example.RelayFixture" },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
          { kind: "settings", setting: "appearance", state: "light" },
          { kind: "expect", target: { identifier: "settings-surface" }, condition: "visible" },
        ],
      };
    default:
      throw new Error(`Unknown scenario ${scenario}`);
  }
}

function fixture(platform, serial) {
  const prefix = `golden-${platform}`;
  return {
    serial,
    app: platform === "ios" ? "com.example.RelayFixture" : "com.example.relayfixture",
    expectedName: `${platform} fixture`,
    expectedOsVersion: "18.0",
    rotation: { orientation: "landscape-left", restoreOrientation: "portrait" },
    scenarios: {
      proofReplay: `${prefix}-proof`,
      delayedSemanticFallback: `${prefix}-delayed`,
      semanticInput: `${prefix}-semantic`,
      pointInput: `${prefix}-point`,
      parallelScheduling: `${prefix}-parallel`,
      runnerKillMidSession: `${prefix}-runner-kill`,
      ddiUnmountRecover: `${prefix}-ddi-recover`,
      appHandoffToSettings: `${prefix}-handoff`,
    },
  };
}

function goldenConfig() {
  return {
    schemaVersion: 1,
    fixtures: {
      android: fixture("android", "android-fixture"),
      ios: fixture("ios", "ios-fixture"),
    },
    scheduling: { minimumOverlapMs: 20 },
  };
}

function scenarioFromRecipe(recipeId) {
  if (recipeId.endsWith("-proof")) return "proofReplay";
  if (recipeId.endsWith("-delayed")) return "delayedSemanticFallback";
  if (recipeId.endsWith("-semantic")) return "semanticInput";
  if (recipeId.endsWith("-point")) return "pointInput";
  if (recipeId.endsWith("-parallel")) return "parallelScheduling";
  if (recipeId.endsWith("-runner-kill")) return "runnerKillMidSession";
  if (recipeId.endsWith("-ddi-recover")) return "ddiUnmountRecover";
  if (recipeId.endsWith("-handoff")) return "appHandoffToSettings";
  throw new Error(`Unrecognized test recipe ${recipeId}`);
}

function fakeApi(options = {}) {
  const config = parseGoldenFixtureConfig(goldenConfig());
  const calls = [];
  const jobs = new Map();
  const jobMetadata = new Map();
  const parallelJobIds = [];
  const orientation = new Map([
    ["android-fixture", "portrait"],
    ["ios-fixture", "portrait"],
  ]);
  let sequence = 0;
  const deviceFor = (platform, serial) => ({
    id: serial,
    serial,
    platform,
    name: `${platform} fixture`,
    kind: "Physical device",
    osVersion: "18.0",
    booted: true,
    connectionState: "device",
    developerMode: platform === "ios" ? "enabled" : undefined,
    developerServicesAvailable: platform === "ios" ? true : undefined,
  });
  const api = {
    calls,
    async request(request) {
      calls.push(request);
      const path = request.path;
      if (path === "/doctor") return { checks: [{ id: "fake", ok: true }] };
      if (path === "/devices") {
        const devices = [deviceFor("android", "android-fixture"), deviceFor("ios", "ios-fixture")];
        return {
          devices: options.missingFixture
            ? devices.filter((device) => device.platform !== options.missingFixture)
            : devices,
        };
      }
      if (path === "/device/recover") {
        return { recovery: { serial: request.body.serial, ready: true } };
      }
      if (path === "/device/app/launch") {
        return {
          launched: {
            ...request.body,
            platform: request.body.serial === "ios-fixture" ? "ios" : "android",
          },
        };
      }
      if (path === "/step/run") {
        const nextOrientation = request.body.step.orientation;
        if (nextOrientation !== "portrait") {
          orientation.set(request.body.serial, nextOrientation);
          if (options.failLandscapeRotation) return { ok: false, durationMs: 1, logs: [] };
        } else if (options.failPortraitRestore) {
          return { ok: false, durationMs: 1, logs: [] };
        } else {
          orientation.set(request.body.serial, nextOrientation);
        }
        return { ok: true, durationMs: 1, logs: [] };
      }
      if (path.startsWith("/snapshot?")) return { nodes: [], tree: "" };
      if (path.startsWith("/screenshot?")) {
        const serial = new URLSearchParams(path.split("?")[1]).get("serial");
        const landscape = orientation.get(serial) !== "portrait";
        if (landscape && options.failLandscapeCapture) {
          return {
            base64: "",
            width: 200,
            height: 100,
            bytes: 0,
            mime: "image/png",
          };
        }
        return {
          base64: pixels,
          width: landscape ? 200 : 100,
          height: landscape ? 100 : 200,
          bytes: 20,
          mime: "image/png",
        };
      }
      if (path.startsWith("/recipes/")) {
        const recipeId = decodeURIComponent(path.split("/").at(-1));
        if (options.missingRecipe === recipeId) return { recipe: undefined };
        const loaded = recipe(recipeId, scenarioFromRecipe(recipeId));
        return { recipe: { ...loaded, source: options.recipeSource ?? loaded.source } };
      }
      if (path === "/jobs") {
        const scenario = scenarioFromRecipe(request.body.recipe);
        if (
          scenario === "parallelScheduling" &&
          options.failParallelStartPlatform === request.body.platform
        ) {
          throw new GoldenAcceptanceError(
            "Simulated parallel scheduling admission failure",
            "GOLDEN_RELAY_REQUEST_FAILED",
          );
        }
        const id = `job-${++sequence}`;
        const parallel = scenario === "parallelScheduling";
        const job = {
          id,
          serial: request.body.serial,
          platform: request.body.platform,
          workerId: `local:${request.body.platform}:target:${request.body.serial}`,
          status: "ok",
          persisted: true,
          startedAt: parallel ? 1_000 : sequence * 1_000,
          finishedAt: parallel ? 1_100 : sequence * 1_000 + 100,
          artifacts:
            scenario === "delayedSemanticFallback" && !options.omitDelayedFallback
              ? [
                  {
                    kind: "target-resolution-attempt",
                    data: { status: "failed", target: { identifier: "delayed-control" } },
                  },
                  {
                    kind: "locator-fallback",
                    data: {
                      original: {
                        identifier: options.unrelatedDelayedFallback
                          ? "unrelated-control"
                          : "delayed-control",
                      },
                      replacement: { point: { x: 20, y: 30 } },
                    },
                  },
                ]
              : scenario === "semanticInput"
                ? [
                    {
                      kind: "target-resolution",
                      data: { strategy: options.semanticResolutionStrategy ?? "identifier" },
                    },
                  ]
                : scenario === "pointInput"
                  ? [{ kind: "target-resolution", data: { strategy: "point" } }]
                  : [],
        };
        jobs.set(id, job);
        jobMetadata.set(id, { scenario, replay: false });
        if (parallel) parallelJobIds.push(id);
        return {
          job:
            parallel && options.wrongParallelStartPlatform === request.body.platform
              ? {
                  ...job,
                  serial: "other-fixture",
                  platform: job.platform === "ios" ? "android" : "ios",
                }
              : job,
        };
      }
      if (path.startsWith("/runs/") && path.endsWith("/replay")) {
        const source = path.split("/")[2];
        const original = jobs.get(source);
        const id = `job-${++sequence}`;
        const job = {
          ...original,
          id,
          status: "ok",
          startedAt: sequence * 1_000,
          finishedAt: sequence * 1_000 + 100,
        };
        jobs.set(id, job);
        jobMetadata.set(id, { ...jobMetadata.get(source), replay: true });
        return { job };
      }
      if (path.startsWith("/jobs/")) {
        const id = path.split("/").at(-1);
        const job = jobs.get(id);
        const metadata = jobMetadata.get(id);
        const wrongTerminalTarget =
          (options.wrongTerminalTarget === metadata?.scenario && !metadata?.replay) ||
          (options.wrongReplayTerminalTarget === true && metadata?.replay);
        return {
          job:
            wrongTerminalTarget && job
              ? {
                  ...job,
                  serial: "other-fixture",
                  platform: job.platform === "ios" ? "android" : "ios",
                }
              : job,
        };
      }
      throw new Error(`Unhandled API request ${request.operationId} ${path}`);
    },
  };
  return { api, config, parallelJobIds };
}

function recordingArtifacts(root, events) {
  const writer = new GoldenArtifactWriter(root);
  const json = writer.json.bind(writer);
  const screenshot = writer.screenshot.bind(writer);
  writer.json = async (relativePath, value) => {
    events.push(`json:${relativePath}`);
    return json(relativePath, value);
  };
  writer.screenshot = async (relativePath, value) => {
    events.push(`screenshot:${relativePath}`);
    return screenshot(relativePath, value);
  };
  return writer;
}

test("strict acceptance executes exact Android+iOS fixtures and preserves an evidence bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config } = fakeApi();
    const summary = await runGoldenFixtureAcceptance({
      config,
      api,
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a terminal normal job routed to another fixture fails closed after durable drain", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config } = fakeApi({ wrongTerminalTarget: "proofReplay" });
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
    const { api, config } = fakeApi({ wrongReplayTerminalTarget: true });
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
    const { api, config, parallelJobIds } = fakeApi({ failParallelStartPlatform: "ios" });
    const events = [];
    await assert.rejects(
      runGoldenFixtureAcceptance({
        config,
        api,
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
    const { api, config, parallelJobIds } = fakeApi({ wrongParallelStartPlatform: "ios" });
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
    const { api, config } = fakeApi({ missingFixture: "ios" });
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
    const { api, config } = fakeApi({ semanticResolutionStrategy: "relation" });
    const summary = await runGoldenFixtureAcceptance({
      config,
      api,
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
  const semanticWithCoordinateFallback = recipe("semantic-coordinate-fallback", "semanticInput");
  semanticWithCoordinateFallback.steps[1].fallbackTargets = [{ point: { x: 20, y: 30 } }];
  assert.throws(
    () => validateGoldenScenarioRecipe(semanticWithCoordinateFallback, "semanticInput", 20),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
  );

  const semanticWithEvidencePoint = recipe("semantic-evidence-point", "semanticInput");
  semanticWithEvidencePoint.steps[1].evidence = {
    candidates: [{ target: { point: { x: 20, y: 30 } } }],
  };
  assert.throws(
    () => validateGoldenScenarioRecipe(semanticWithEvidencePoint, "semanticInput", 20),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
  );

  const pointWithSemanticFallback = recipe("point-semantic-fallback", "pointInput");
  pointWithSemanticFallback.steps[1].fallbackTargets = [{ identifier: "semantic-escape" }];
  assert.throws(
    () => validateGoldenScenarioRecipe(pointWithSemanticFallback, "pointInput", 20),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
  );

  const semanticWithPointTap = recipe("semantic-with-point-tap", "semanticInput");
  semanticWithPointTap.steps.push(
    { kind: "tap", target: { point: { x: 20, y: 30 } } },
    { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
  );
  assert.throws(
    () => validateGoldenScenarioRecipe(semanticWithPointTap, "semanticInput", 20),
    (error) =>
      error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
  );

  const pointWithSemanticTap = recipe("point-with-semantic-tap", "pointInput");
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
    const unproven = recipe(`unproven-${scenario}`, scenario);
    unproven.steps = unproven.steps.filter((step) => step.kind !== "expect");
    assert.throws(
      () => validateGoldenScenarioRecipe(unproven, scenario, 20),
      (error) =>
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_RECIPE_CONTRACT_INVALID",
      `${scenario} must not accept input without proof`,
    );
  }

  const chainedInputs = recipe("unproven-chain", "proofReplay");
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
    const unbracketed = recipe(`unbracketed-${physicalInput.kind}`, "proofReplay");
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
    const opaque = recipe(`opaque-${kind}`, "proofReplay");
    opaque.steps[1] = { kind };
    assert.throws(
      () => validateGoldenScenarioRecipe(opaque, "proofReplay", 20),
      new RegExp(kind, "u"),
    );
  }

  const conditional = recipe("conditional-input", "proofReplay");
  conditional.steps[1].when = {
    target: { identifier: "fixture-home" },
    condition: "present",
  };
  assert.throws(() => validateGoldenScenarioRecipe(conditional, "proofReplay", 20), /conditional/u);
});

test("a normal semantic pass cannot falsely satisfy the delayed-tree fallback scenario", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config } = fakeApi({ omitDelayedFallback: true });
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
    const { api, config } = fakeApi({ unrelatedDelayedFallback: true });
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
        error instanceof GoldenAcceptanceError && error.code === "GOLDEN_SCENARIO_UNPROVEN",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing recipe prevents every recovery, launch, and fixture evidence claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-test-"));
  try {
    const { api, config } = fakeApi({ missingRecipe: "golden-ios-point" });
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
    const { api, config } = fakeApi({ recipeSource: "builtin" });
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
    const { api, config } = fakeApi({ failLandscapeCapture: true });
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
