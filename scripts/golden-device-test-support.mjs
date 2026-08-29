import {
  GoldenAcceptanceError,
  GoldenArtifactWriter,
  fixtureFingerprint,
  parseGoldenFixtureConfig,
} from "./golden-device-lib.mjs";

const pixels = Buffer.from("relay-golden-pixels").toString("base64");

const faultProof = {
  runnerKillMidSession: {
    disruption: "xctest-runner-process-absent",
    restoration: "xctest-session-ready",
  },
  ddiUnmountRecover: {
    disruption: "developer-disk-image-unmounted",
    restoration: "developer-disk-image-mounted",
  },
};

export function fakeGoldenFaultReceipt(input) {
  return {
    schemaVersion: 1,
    invocationId: input.invocationId,
    scenario: input.scenario,
    phase: input.phase,
    target: {
      platform: input.fixture.platform,
      serialFingerprint: fixtureFingerprint(input.fixture.serial),
    },
    status: "confirmed",
    attempts: 1,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    proof: { kind: faultProof[input.scenario][input.phase], observed: true },
  };
}

export function goldenRecipe(id, scenario) {
  const common = {
    id,
    title: id,
    source: "custom",
  };
  switch (scenario) {
    case "proofReplay":
      return {
        ...common,
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          { kind: "tap", target: { identifier: "fixture-open" } },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
        ],
      };
    case "delayedSemanticFallback":
      return {
        ...common,
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
        ...common,
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          { kind: "tap", target: { identifier: "semantic-control" } },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
        ],
      };
    case "pointInput":
      return {
        ...common,
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          { kind: "tap", target: { point: { x: 31, y: 41 } } },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
        ],
      };
    case "parallelScheduling":
      return {
        ...common,
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
        ...common,
        steps: [
          { kind: "expect", target: { identifier: "fixture-home" }, condition: "visible" },
          { kind: "device", action: "keyboard-dismiss" },
          { kind: "expect", target: { identifier: "fixture-detail" }, condition: "visible" },
        ],
      };
    case "appHandoffToSettings":
      return {
        ...common,
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

export function goldenConfig() {
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

/** In-memory adapter for the golden acceptance module's one request interface. */
export function createFakeGoldenApi(options = {}) {
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
  const faultCalls = [];
  const faultReceipt = (input) => {
    const receipt = fakeGoldenFaultReceipt({ ...input, finishedAt: input.startedAt });
    if (
      options.invalidFaultReceiptScenario === input.scenario &&
      options.invalidFaultReceiptPhase === input.phase
    ) {
      if (options.invalidFaultReceiptKind === "extra-field") receipt.unreviewed = true;
      if (options.invalidFaultReceiptKind === "wrong-proof") receipt.proof.kind = "ordinary-recipe";
      if (options.invalidFaultReceiptKind === "wrong-target") {
        receipt.target.serialFingerprint = "not-the-configured-fixture";
      }
      if (options.invalidFaultReceiptKind === "late") {
        receipt.finishedAt = input.deadlineAt + 1;
      }
    }
    return receipt;
  };
  const faults = {
    async disrupt(input) {
      faultCalls.push({ operation: "disrupt", ...input });
      if (options.hangFaultScenario === input.scenario) return new Promise(() => undefined);
      return faultReceipt(input);
    },
    async confirmRestored(input) {
      faultCalls.push({ operation: "confirmRestored", ...input });
      if (options.failFaultRestorationScenario === input.scenario) {
        throw new Error("Simulated host restoration failure");
      }
      return faultReceipt(input);
    },
  };
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
      if (path.startsWith("/snapshot?")) {
        const serial = new URLSearchParams(path.split("?")[1]).get("serial");
        const platform = serial === "ios-fixture" ? "ios" : "android";
        const app = platform === "ios" ? "com.example.RelayFixture" : "com.example.relayfixture";
        return {
          inspectable: true,
          foregroundApp: app,
          nodes: [
            {
              identifier: "fixture-home",
              label: "Fixture home",
              role: "button",
              enabled: true,
              visibleToUser: true,
              rect: { x: 10, y: 10, width: 80, height: 44 },
              bundleId: app,
            },
          ],
          tree: "",
        };
      }
      if (path.startsWith("/screenshot?")) {
        const serial = new URLSearchParams(path.split("?")[1]).get("serial");
        const landscape = orientation.get(serial) !== "portrait";
        if (landscape && options.failLandscapeCapture) {
          return { base64: "", width: 200, height: 100, bytes: 0, mime: "image/png" };
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
        const loaded = goldenRecipe(recipeId, scenarioFromRecipe(recipeId));
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
  return { api, config, faults, faultCalls, parallelJobIds };
}

export function recordingArtifacts(root, events) {
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
