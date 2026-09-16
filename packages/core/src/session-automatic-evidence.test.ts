import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Device } from "./device-capabilities.js";
import {
  recordTargetPixelCapture,
  resetTargetRuntimeReadiness,
} from "./target-runtime-readiness.js";
import { captureAutomaticState } from "./session-automatic-evidence.js";
import type { RecipeRuntimeState } from "./recipe-runner-context.js";
import type { TestJob } from "./session-contract.js";
import { runWithTargetContext } from "./target-context.js";
import type { TraceStep } from "./trace.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Minimal PNG-shaped buffer: signature plus IHDR dimensions at the fixed
 * offsets the evidence pipeline inspects (width @16, height @20). */
function fakePng(label: string): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(4, 0);
  header.writeUInt32BE(2, 4);
  return Buffer.concat([PNG_SIGNATURE, header, Buffer.from(label)]);
}

function stubDevice(): {
  device: Device;
  screenshotCount: () => number;
} {
  let screenshots = 0;
  const device = {
    capture: {
      snapshot: async () => ({ nodes: [] }),
      screenshot: async ({ path }: { path: string }) => {
        screenshots += 1;
        await writeFile(path, fakePng(`sdk-${screenshots}`));
        return {};
      },
    },
  } as unknown as Device;
  return { device, screenshotCount: () => screenshots };
}

function iosJob(serial: string): TestJob {
  return {
    id: "fence-job",
    action: "test",
    platform: "ios",
    serial,
    queuedAt: Date.now(),
    artifacts: [],
    frames: [],
    logs: [],
    steps: [],
    glyphs: [],
  } as unknown as TestJob;
}

function step(title: string): TraceStep {
  return { id: "s1", title, frames: [], glyphs: [] } as unknown as TraceStep;
}

function runtimeWithCachedRaster(base64: string): RecipeRuntimeState {
  return {
    observation: {
      observedAt: Date.now(),
      screenshot: {
        capturedAt: Date.now(),
        mime: "image/png",
        base64,
        path: join(tmpdir(), `relay-fence-ephemeral-${Math.random().toString(16)}.png`),
        bytes: Buffer.byteLength(base64, "base64"),
      },
    },
  };
}

/** Install a shell shim as RELAY_GO_IOS_BIN that writes the given bytes to
 * whatever --output path Relay asks for. Returns a restore function. */
async function withFakeGoIos(nextImage: () => Buffer, run: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "relay-fence-bin-"));
  const bin = join(directory, "ios");
  const script = [
    "#!/bin/sh",
    'OUTPUT_PATH=""',
    'for arg in "$@"; do',
    '  case "$arg" in --output=*) OUTPUT_PATH="${arg#--output=}" ;; esac;',
    "done",
    'printf "%s" "$FAKE_PNG_B64" | base64 -d > "$OUTPUT_PATH"',
    "",
  ].join("\n");
  await writeFile(bin, script);
  await chmod(bin, 0o755);
  const previousBin = process.env.RELAY_GO_IOS_BIN;
  process.env.RELAY_GO_IOS_BIN = bin;
  const previousImage = process.env.RELAY_FAKE_PNG_B64 ?? "";
  try {
    // The shim reads its frame from the environment so each invocation can
    // observe a different screen.
    const originalEnvWrite = process.env;
    const envSetter = {
      set(target: NodeJS.ProcessEnv, key: string, value: string | undefined) {
        if (key === "FAKE_PNG_B64") return true;
        return Reflect.set(target, key, value);
      },
    };
    void envSetter;
    void originalEnvWrite;
    // Simpler: re-export the image before each call by wrapping run().
    process.env.FAKE_PNG_B64 = nextImage().toString("base64");
    await run();
  } finally {
    if (previousBin === undefined) delete process.env.RELAY_GO_IOS_BIN;
    else process.env.RELAY_GO_IOS_BIN = previousBin;
    if (previousImage === "") delete process.env.FAKE_PNG_B64;
    else process.env.FAKE_PNG_B64 = previousImage;
    await rm(directory, { recursive: true, force: true });
  }
}

test("cached iOS raster is reused while the sampled pixels still match", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-fence-reuse-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  resetTargetRuntimeReadiness();
  const cachedBytes = fakePng("same-screen");
  const runtime = runtimeWithCachedRaster(cachedBytes.toString("base64"));
  const originalCapturedAt = runtime.observation!.screenshot!.capturedAt;
  const job = iosJob("fence-udid-1");
  const { device, screenshotCount } = stubDevice();
  try {
    await withFakeGoIos(
      () => fakePng("same-screen"),
      () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial: "fence-udid-1" }, () =>
          captureAutomaticState(job, device, step("One"), "before", () => {}, runtime),
        ),
    );
    assert.equal(screenshotCount(), 0, "unchanged pixels must not force an SDK recapture");
    assert.equal(runtime.observation?.screenshot?.framePath !== undefined, true);
    assert.equal(job.frames[0]?.capturedAt, originalCapturedAt);
  } finally {
    resetTargetRuntimeReadiness();
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

test("changed pixels behind the same stream force a fresh capture", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-fence-change-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  resetTargetRuntimeReadiness();
  const runtime = runtimeWithCachedRaster(fakePng("stale-screen").toString("base64"));
  const { device, screenshotCount } = stubDevice();
  try {
    await withFakeGoIos(
      () => fakePng("moved-on"),
      () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial: "fence-udid-2" }, () =>
          captureAutomaticState(
            iosJob("fence-udid-2"),
            device,
            step("Two"),
            "after",
            () => {},
            runtime,
          ),
        ),
    );
    assert.equal(screenshotCount(), 0, "go-ios path captures directly without the SDK");
    assert.notEqual(
      runtime.observation?.screenshot?.base64,
      fakePng("stale-screen").toString("base64"),
      "the observation must hold the new raster, not the stale one",
    );
    assert.equal(runtime.observation?.screenshot?.base64, fakePng("moved-on").toString("base64"));
  } finally {
    resetTargetRuntimeReadiness();
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

test("an advanced observation epoch invalidates the cache without sampling pixels", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-fence-epoch-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  resetTargetRuntimeReadiness();
  const serial = "fence-udid-3";
  const runtime = runtimeWithCachedRaster(fakePng("same-screen").toString("base64"));
  const { device, screenshotCount } = stubDevice();
  try {
    await withFakeGoIos(
      () => fakePng("same-screen"),
      () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
          captureAutomaticState(iosJob(serial), device, step("Warm"), "before", () => {}, runtime),
        ),
    );
    // Another capture happens after the cached raster was taken: even though
    // the sampled pixels would match, the epoch alone makes the cache stale.
    recordTargetPixelCapture({ serial, platform: "ios" }, { at: Date.now() + 10 });
    await withFakeGoIos(
      () => fakePng("post-epoch"),
      () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
          captureAutomaticState(iosJob(serial), device, step("After"), "after", () => {}, runtime),
        ),
    );
    assert.equal(
      runtime.observation?.screenshot?.base64,
      fakePng("post-epoch").toString("base64"),
      "the observation must hold a freshly captured raster after the epoch advanced",
    );
    void screenshotCount;
  } finally {
    resetTargetRuntimeReadiness();
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

test("Android after evidence refreshes a cached before raster", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-after-fresh-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  const runtime = runtimeWithCachedRaster(fakePng("before").toString("base64"));
  const job = { ...iosJob("android-test"), platform: "android" as const };
  const resultStep = step("Tap Continue");
  let captures = 0;
  const device = {
    capture: {
      snapshot: async () => ({ nodes: [] }),
      screenshot: async () => {
        captures++;
        return { base64: fakePng("after").toString("base64") };
      },
    },
  } as unknown as Device;
  try {
    await runWithTargetContext(
      { kind: "device", platform: "android", serial: "android-test" },
      () => captureAutomaticState(job, device, resultStep, "after", () => {}, runtime),
    );
    assert.equal(captures, 1);
    assert.equal(runtime.observation?.screenshot?.base64, fakePng("after").toString("base64"));
    assert.ok(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "visual-settling" &&
          (artifact.data as { settled: boolean; samples: number; stabilityMeasured?: boolean })
            .settled === false &&
          (artifact.data as { samples: number }).samples === 1 &&
          (artifact.data as { stabilityMeasured?: boolean }).stabilityMeasured === false,
      ),
    );
  } finally {
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed iOS freshness probe recaptures instead of certifying the cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-fence-probe-fail-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  resetTargetRuntimeReadiness();
  const runtime = runtimeWithCachedRaster(fakePng("cached").toString("base64"));
  const { device, screenshotCount } = stubDevice();
  const directory = await mkdtemp(join(tmpdir(), "relay-fence-bin-fail-"));
  const bin = join(directory, "ios");
  await writeFile(bin, "#!/bin/sh\nexit 1\n");
  await chmod(bin, 0o755);
  const previousBin = process.env.RELAY_GO_IOS_BIN;
  process.env.RELAY_GO_IOS_BIN = bin;
  try {
    await runWithTargetContext(
      { kind: "device", platform: "ios", serial: "fence-udid-probe" },
      () =>
        captureAutomaticState(
          iosJob("fence-udid-probe"),
          device,
          step("Before"),
          "before",
          () => {},
          runtime,
        ),
    );
    assert.ok(screenshotCount() >= 1, "a failed freshness probe must recapture");
  } finally {
    if (previousBin === undefined) delete process.env.RELAY_GO_IOS_BIN;
    else process.env.RELAY_GO_IOS_BIN = previousBin;
    resetTargetRuntimeReadiness();
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("UI-tree capture logs the runner message instead of [object Object]", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-tree-objerr-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  const logs: string[] = [];
  const device = {
    capture: {
      snapshot: async () => {
        throw {
          message: "find could not read the current accessibility tree",
          code: "COMMAND_FAILED",
        };
      },
      screenshot: async ({ path }: { path: string }) => {
        await writeFile(path, fakePng("tree-err"));
        return {};
      },
    },
  } as unknown as Device;
  try {
    await runWithTargetContext({ kind: "device", platform: "ios", serial: "tree-err-ipad" }, () =>
      captureAutomaticState(iosJob("tree-err-ipad"), device, step("Wait"), "before", (line) =>
        logs.push(line),
      ),
    );
    assert.ok(
      logs.some((line) => line.includes("find could not read the current accessibility tree")),
      logs.join("\n"),
    );
    assert.equal(
      logs.some((line) => line.includes("[object Object]")),
      false,
    );
  } finally {
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

test("iOS after UI-tree skips catalog snapshot so an open library cannot kill the runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-after-skip-catalog-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  let snapshots = 0;
  const job = iosJob("after-skip-ipad");
  const device = {
    capture: {
      snapshot: async () => {
        snapshots += 1;
        throw new Error("catalog snapshot must not run after an iOS mutation");
      },
      screenshot: async ({ path }: { path: string }) => {
        await writeFile(path, fakePng("after-pixels"));
        return { base64: fakePng("after-pixels").toString("base64") };
      },
    },
  } as unknown as Device;
  try {
    await runWithTargetContext({ kind: "device", platform: "ios", serial: "after-skip-ipad" }, () =>
      captureAutomaticState(job, device, step("Tap sidebar"), "after", () => {}),
    );
    assert.equal(snapshots, 0);
    const tree = job.artifacts.find((artifact) => artifact.kind === "ui-tree");
    assert.deepEqual(tree?.data?.nodes, []);
  } finally {
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});
