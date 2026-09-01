import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  CHANGE_PROOF_GOLDEN_LIVE,
  exportTracePackFromRun,
  inspectAndroidPrerequisites,
  inspectManagedBrowserTargets,
  inspectPersistedRun,
  inspectTracePack,
  parseGoldenLiveArgs,
  runChangeProofGoldenLive,
  startGoldenFixtureServer,
} from "./change-proof-golden-live.mjs";

const execFileAsync = promisify(execFile);

async function writeCanonicalTracePack(path, overrides = {}) {
  const sourceSha = overrides.sourceSha ?? "b".repeat(40);
  const artifactDigest = overrides.artifactDigest ?? `sha256:${"c".repeat(64)}`;
  const runId = overrides.runId ?? "run-golden-old";
  const targetProfile = overrides.targetProfile ?? {
    id: "android-medium-phone",
    targetId: "emulator-5554",
    source: "device",
    platform: "android",
    name: "medium_phone",
    viewport: { width: 1080, height: 2400 },
    capabilities: ["screenshot", "snapshot"],
    observedAt: 1,
  };
  const run = {
    schemaVersion: 5,
    id: runId,
    projectId: "default",
    action: "app-map:settings:settings-language-arabic",
    status: "ok",
    attempts: 1,
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 3,
    logs: [],
    steps: [],
    frames: [],
    dir: "",
    writtenAt: 4,
    targetProfile,
    sourceRevision: { vcs: "git", sha: sourceSha, artifactDigest, buildId: "android-old" },
    artifacts: [
      {
        kind: "app-map-test-plan",
        capturedAt: 2,
        data: {
          schemaVersion: 1,
          appMapId: "settings",
          appMapRevision: 1,
          test: {
            id: "settings-language-arabic",
            name: "Settings → Language → Arabic",
            kind: "scenario",
            intentSchemaVersion: 1,
          },
          rootRecipeId: "settings:settings-language-arabic:root",
          recipes: {
            "settings:settings-language-arabic:root": {
              id: "settings:settings-language-arabic:root",
              title: "Settings → Language → Arabic",
              parameters: [],
              steps: [],
            },
          },
          stepProvenance: [],
          performance: {
            executableOperations: 0,
            moduleCalls: 0,
            operationCounts: {},
            screenshotCount: 0,
            destinationProofCount: 0,
          },
          startup: { mode: "cold" },
        },
      },
    ],
    inputDigest: "d".repeat(64),
    resolvedInputs: {},
    evidence: {
      schemaVersion: 1,
      runId,
      target: { kind: "device", platform: "android" },
      startedAt: 2,
      finishedAt: 3,
      channels: {},
      events: [],
    },
  };
  const script = `import { writeFile } from "node:fs/promises"; import { exportTracePack } from "./packages/core/src/trace-pack.ts"; (async()=>{const run=JSON.parse(process.env.RUN); const pack=await exportTracePack(run); await writeFile(process.env.OUT, JSON.stringify(pack)); if (process.env.RUN_OUT) await writeFile(process.env.RUN_OUT, JSON.stringify(pack.objects.find((object)=>object.kind === "frozen-run").content));})().catch(error=>{console.error(error);process.exitCode=1});`;
  await execFileAsync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--eval", script], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      RUN: JSON.stringify(run),
      OUT: path,
      ...(overrides.runPath ? { RUN_OUT: overrides.runPath } : {}),
    },
  });
  return { sourceSha, artifactDigest, runId, targetProfile, runPath: overrides.runPath ?? null };
}

test("golden live arguments require explicit web execution", () => {
  assert.deepEqual(parseGoldenLiveArgs([]).runWeb, false);
  assert.equal(parseGoldenLiveArgs(["--run-web"]).runWeb, true);
  assert.throws(() => parseGoldenLiveArgs(["--unknown"]), /Unknown argument/u);
});

test("fixture server exposes the same journey with a seeded old-head regression", async () => {
  const fixture = await startGoldenFixtureServer();
  try {
    const old = await fetch(`${fixture.baseUrl}/settings?head=old`);
    const repaired = await fetch(`${fixture.baseUrl}/settings?head=repaired`);
    assert.equal(old.status, 200);
    assert.equal(repaired.status, 200);
    assert.match(await old.text(), /Primary action overlaps the Arabic description by 22 px/u);
    assert.doesNotMatch(
      await repaired.text(),
      /Primary action overlaps the Arabic description by 22 px/u,
    );
  } finally {
    await fixture.close();
  }
});

test("Android preflight reports exact missing target and fixture prerequisites", async () => {
  const command = async (name) => {
    if (name === "adb") return { code: 0, stdout: "List of devices attached\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const result = await inspectAndroidPrerequisites({ env: {}, command });
  assert.equal(result.status, "unsupported");
  assert.ok(result.blockers.some(({ id }) => id === "android.serial.missing"));
  assert.ok(result.blockers.some(({ id }) => id === "android.fixture-apk.missing"));
  assert.ok(result.blockers.some(({ id }) => id === "android.runtime.none"));
});

test("managed browser preflight reports an empty local target registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-change-proof-target-registry-"));
  try {
    const result = await inspectManagedBrowserTargets({
      targetFile: join(root, "targets.json"),
      env: {},
    });
    assert.equal(result.status, "missing");
    assert.deepEqual(result.browserTargetIds, []);
    assert.equal(result.blockers[0]?.id, "browser.targets.registry.missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical TracePack verification binds every declared frozen identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-change-proof-tracepack-"));
  try {
    const path = join(root, "old.json");
    const identity = await writeCanonicalTracePack(path);
    const expected = {
      ...identity,
      appMapId: "settings",
      testId: "settings-language-arabic",
    };
    const verified = await inspectTracePack(path, root, "old", expected);
    assert.equal(verified.status, "verified", JSON.stringify(verified));
    assert.equal(verified.projection.run.id, identity.runId);

    const wrongSource = await inspectTracePack(path, root, "old", {
      ...expected,
      sourceSha: "e".repeat(40),
    });
    assert.equal(wrongSource.status, "identity-mismatch");
    assert.match(wrongSource.error, /source SHA/u);

    for (const [field, value, message] of [
      ["appMapId", "other-map", /App Map\/Test identity/u],
      ["testId", "other-test", /App Map\/Test identity/u],
      ["artifactDigest", `sha256:${"f".repeat(64)}`, /build artifact digest/u],
      ["runId", "other-run", /run identity/u],
      ["targetProfile", { ...identity.targetProfile, observedAt: 2 }, /target profile/u],
    ]) {
      const mismatch = await inspectTracePack(path, root, "old", {
        ...expected,
        [field]: value,
      });
      assert.equal(mismatch.status, "identity-mismatch");
      assert.match(mismatch.error, message);
    }

    const parsed = JSON.parse(await readFile(path, "utf8"));
    parsed.objects.push({ ...parsed.objects[0], path: parsed.objects[0].path });
    await writeFile(path, JSON.stringify(parsed));
    const duplicate = await inspectTracePack(path, root, "old", expected);
    assert.equal(duplicate.status, "invalid");
    assert.match(duplicate.error, /Canonical TracePack verification failed/u);

    await writeCanonicalTracePack(path);
    const tamperedPack = JSON.parse(await readFile(path, "utf8"));
    tamperedPack.objects[0].content.status = "error";
    await writeFile(path, JSON.stringify(tamperedPack));
    const tampered = await inspectTracePack(path, root, "old", expected);
    assert.equal(tampered.status, "invalid");
    assert.match(tampered.error, /Canonical TracePack verification failed/u);

    const oversizedPath = join(root, "oversized.json");
    await writeFile(oversizedPath, Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
    const oversized = await inspectTracePack(oversizedPath, root, "old", expected);
    assert.equal(oversized.status, "missing");
    assert.match(oversized.error, /exceeds/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted Android Runs import through the canonical TracePack exporter", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-change-proof-run-import-"));
  try {
    const tracePackPath = join(root, "source-pack.json");
    const runPath = join(root, "android-run.json");
    const identity = await writeCanonicalTracePack(tracePackPath, { runPath });
    const expected = {
      ...identity,
      appMapId: "settings",
      testId: "settings-language-arabic",
    };
    const inspected = await inspectPersistedRun(runPath, root, "repaired", expected);
    assert.equal(inspected.status, "verified", JSON.stringify(inspected));
    assert.equal(inspected.run.id, identity.runId);

    const imported = await exportTracePackFromRun(runPath, root, "repaired", expected);
    assert.equal(imported.status, "verified", JSON.stringify(imported));
    assert.equal(imported.sourceRun.status, "verified");
    assert.equal(imported.projection.run.id, identity.runId);
    assert.equal(imported.projection.run.sourceRevision.sha, identity.sourceSha);
    assert.ok(imported.path);
    assert.ok(imported.sourceRun.path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function fakeBrowserInvoker() {
  let baseUrl = "";
  const state = new Map();
  const session = (targetId, phase) => {
    const step = state.get(targetId) ?? 0;
    const title =
      step < 2
        ? step === 0
          ? "Settings"
          : "Language"
        : phase === "old"
          ? "Arabic — RTL regression"
          : "Arabic — RTL fixed";
    return {
      schemaVersion: 1,
      sessionId: `session-${targetId}`,
      targetId,
      status: "streaming",
      ownership: "controlled",
      sequence: step + 1,
      activePageId: "page-1",
      pages: [
        {
          id: "page-1",
          kind: "page",
          title,
          url: `${baseUrl}/settings?head=${phase}`,
          active: true,
          closed: false,
        },
      ],
      profile: {
        schemaVersion: 1,
        engine: "chromium",
        viewport: CHANGE_PROOF_GOLDEN_LIVE.browser.viewport,
        deviceScaleFactor: 1,
        mobile: false,
        touch: false,
        locale: "ar",
        timezoneId: "UTC",
        colorScheme: "light",
        reducedMotion: "no-preference",
        permissions: [],
        offline: false,
        environmentRevision: CHANGE_PROOF_GOLDEN_LIVE.browser.environmentRevision,
      },
      startedAt: 1,
    };
  };
  const frame = (targetId, phase) => {
    const current = session(targetId, phase);
    const bytes = Buffer.from("frame");
    return {
      session: current,
      frame: {
        sessionId: current.sessionId,
        sequence: current.sequence,
        pageId: "page-1",
        pageUrl: current.pages[0].url,
        visualFingerprint: `fingerprint-${current.sequence}`,
        capturedAt: current.sequence,
        mime: "image/jpeg",
        base64: bytes.toString("base64"),
        bytes: bytes.length,
        width: 390,
        height: 844,
      },
    };
  };
  return async (operationId, input) => {
    if (operationId === "target.create") {
      baseUrl = new URL(input.startUrl).origin;
      state.set(input.id, 0);
      return { target: { id: input.id } };
    }
    if (operationId === "target.delete") return { ok: true };
    const targetId = input.targetId;
    const phase = targetId.includes("-old-") ? "old" : "repaired";
    if (operationId === "target.browser-device.open") return { session: session(targetId, phase) };
    if (operationId === "target.browser-device.frame") return frame(targetId, phase);
    if (operationId === "target.browser-device.inspect") {
      const step = state.get(targetId) ?? 0;
      const label = step === 0 ? "Language" : "Arabic";
      return {
        overlay: {
          schemaVersion: 1,
          sessionId: `session-${targetId}`,
          pageId: "page-1",
          sequence: step + 1,
          visualFingerprint: `fingerprint-${step + 1}`,
          capturedAt: step + 1,
          candidates: [
            {
              id: label.toLowerCase(),
              role: "button",
              label,
              rect: { x: 0, y: 0, width: 100, height: 50 },
              enabled: true,
              selected: false,
              focused: false,
              reasoning: "fixture",
            },
          ],
          truncated: false,
        },
      };
    }
    if (operationId === "target.browser-device.control") {
      state.set(targetId, (state.get(targetId) ?? 0) + 1);
      return { ok: true, session: session(targetId, phase) };
    }
    throw new Error(`unexpected operation ${operationId}`);
  };
}

test("live harness executes web evidence but refuses a cross-platform claim without Android/TracePacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-change-proof-golden-live-"));
  try {
    const report = await runChangeProofGoldenLive({
      runWeb: true,
      artifactDir: root,
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, product: "relay", version: "test" }), {
          status: 200,
        }),
      invoke: fakeBrowserInvoker(),
      command: async (name) =>
        name === "adb"
          ? { code: 0, stdout: "List of devices attached\n", stderr: "" }
          : { code: 0, stdout: "", stderr: "" },
      env: {},
    });
    assert.equal(report.status, "insufficient-evidence");
    assert.equal(report.web.status, "passed");
    assert.equal(report.seededRegression.detected, true);
    assert.equal(report.seededRegression.blocked, true);
    assert.equal(report.finalProof.status, "not-claimed");
    assert.ok(
      report.android.blockers.some(
        ({ id }) => id === "android.device.not-attached" || id === "android.serial.missing",
      ),
    );
    const saved = JSON.parse(await readFile(join(root, "report.json"), "utf8"));
    assert.equal(saved.status, "insufficient-evidence");
    assert.ok(saved.repairPacket);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixture cleanup failure downgrades the completed web lane", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-change-proof-golden-cleanup-"));
  try {
    const report = await runChangeProofGoldenLive({
      runWeb: true,
      artifactDir: root,
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, product: "relay", version: "test" }), {
          status: 200,
        }),
      invoke: fakeBrowserInvoker(),
      startFixture: async () => ({
        baseUrl: "http://fixture.invalid",
        close: async () => {
          throw new Error("fixture close failed");
        },
      }),
      command: async (name) =>
        name === "adb"
          ? { code: 0, stdout: "List of devices attached\n", stderr: "" }
          : { code: 0, stdout: "", stderr: "" },
      env: {},
    });
    assert.equal(report.web.status, "failed");
    assert.ok(report.web.blockers.some(({ id }) => id === "browser.fixture.cleanup.failed"));
    assert.ok(report.finalProof.blockers.some(({ id }) => id === "browser.fixture.cleanup.failed"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("apparently ready Android and exact-head inputs still cannot produce a false green", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-change-proof-golden-ready-"));
  const apk = join(root, "settings-fixture.apk");
  const oldTracePack = join(root, "old-tracepack.json");
  const repairedTracePack = join(root, "repaired-tracepack.json");
  await writeFile(apk, "fixture-apk");
  await writeFile(oldTracePack, JSON.stringify({ digest: "not-canonical" }));
  await writeFile(repairedTracePack, JSON.stringify({ digest: "not-canonical" }));
  const env = {
    RELAY_GOLDEN_ANDROID_SERIAL: "emulator-5554",
    RELAY_GOLDEN_ANDROID_APP_PATH: apk,
    RELAY_GOLDEN_ANDROID_APP_ID: "com.example.settings",
    RELAY_GOLDEN_ANDROID_APP_MAP_ID: "settings",
    RELAY_GOLDEN_ANDROID_TEST_ID: "settings-language-arabic",
    RELAY_GOLDEN_BASE_HEAD: "a".repeat(40),
    RELAY_GOLDEN_OLD_HEAD: "b".repeat(40),
    RELAY_GOLDEN_REPAIRED_HEAD: "c".repeat(40),
    RELAY_GOLDEN_OLD_TRACEPACK: oldTracePack,
    RELAY_GOLDEN_REPAIRED_TRACEPACK: repairedTracePack,
  };
  try {
    const report = await runChangeProofGoldenLive({
      artifactDir: root,
      env,
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, product: "relay" }), { status: 200 }),
      command: async (name, args) => {
        if (name === "adb" && args?.[0] === "devices")
          return {
            code: 0,
            stdout: "List of devices attached\nemulator-5554 device\n",
            stderr: "",
          };
        if (name === "adb")
          return { code: 0, stdout: "package:/data/app/settings.apk\n", stderr: "" };
        return { code: 0, stdout: "golden-avd\n", stderr: "" };
      },
      invoke: async () => ({}),
    });
    assert.equal(report.android.status, "ready");
    assert.equal(report.exactProofInputs.oldTracePack.status, "invalid");
    assert.equal(report.exactProofInputs.repairedTracePack.status, "invalid");
    assert.equal(report.status, "insufficient-evidence");
    assert.equal(report.finalProof.status, "not-claimed");
    assert.ok(report.unsupported.some(({ id }) => id === "android.execution.old.invalid"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("live harness consumes retained Android Run inputs and can prove the cross-platform journey", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-change-proof-golden-consume-run-"));
  const apk = join(root, "settings-fixture.apk");
  const oldRunPath = join(root, "android-old-run.json");
  const repairedRunPath = join(root, "android-repaired-run.json");
  await writeFile(apk, "fixture-apk");
  const oldSha = "a".repeat(40);
  const repairedSha = "b".repeat(40);
  const oldDigest = `sha256:${"c".repeat(64)}`;
  const repairedDigest = `sha256:${"d".repeat(64)}`;
  const old = await writeCanonicalTracePack(join(root, "old-source-pack.json"), {
    sourceSha: oldSha,
    artifactDigest: oldDigest,
    runId: "android-old-run",
    runPath: oldRunPath,
  });
  const repaired = await writeCanonicalTracePack(join(root, "repaired-source-pack.json"), {
    sourceSha: repairedSha,
    artifactDigest: repairedDigest,
    runId: "android-repaired-run",
    runPath: repairedRunPath,
  });
  const env = {
    RELAY_GOLDEN_ANDROID_SERIAL: "emulator-5554",
    RELAY_GOLDEN_ANDROID_APP_PATH: apk,
    RELAY_GOLDEN_ANDROID_APP_ID: "com.example.settings",
    RELAY_GOLDEN_ANDROID_APP_MAP_ID: "settings",
    RELAY_GOLDEN_ANDROID_TEST_ID: "settings-language-arabic",
    RELAY_GOLDEN_BASE_HEAD: "0".repeat(40),
    RELAY_GOLDEN_OLD_HEAD: oldSha,
    RELAY_GOLDEN_REPAIRED_HEAD: repairedSha,
    RELAY_GOLDEN_OLD_RUN_ID: old.runId,
    RELAY_GOLDEN_REPAIRED_RUN_ID: repaired.runId,
    RELAY_GOLDEN_OLD_BUILD_DIGEST: oldDigest,
    RELAY_GOLDEN_REPAIRED_BUILD_DIGEST: repairedDigest,
    RELAY_GOLDEN_OLD_TARGET_PROFILE: JSON.stringify(old.targetProfile),
    RELAY_GOLDEN_REPAIRED_TARGET_PROFILE: JSON.stringify(repaired.targetProfile),
    RELAY_GOLDEN_OLD_RUN_PATH: oldRunPath,
    RELAY_GOLDEN_REPAIRED_RUN_PATH: repairedRunPath,
  };
  try {
    const report = await runChangeProofGoldenLive({
      runWeb: true,
      artifactDir: root,
      env,
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, product: "relay", version: "test" }), {
          status: 200,
        }),
      invoke: fakeBrowserInvoker(),
      command: async (name, args) => {
        if (name === "adb" && args?.[0] === "devices")
          return {
            code: 0,
            stdout: "List of devices attached\nemulator-5554 device\n",
            stderr: "",
          };
        if (name === "adb")
          return { code: 0, stdout: "package:/data/app/settings.apk\n", stderr: "" };
        return { code: 0, stdout: "golden-avd\n", stderr: "" };
      },
    });
    assert.equal(report.status, "proved");
    assert.equal(report.androidExecution.status, "verified");
    assert.equal(report.androidExecution.old.status, "verified");
    assert.equal(report.androidExecution.repaired.status, "verified");
    assert.equal(report.exactProofInputs.oldTracePack.status, "verified");
    assert.equal(report.exactProofInputs.repairedTracePack.status, "verified");
    assert.equal(report.finalProof.status, "proved");
    const retained = JSON.parse(await readFile(join(root, "golden-inputs.json"), "utf8"));
    assert.equal(retained.kind, "change-proof-golden-inputs");
    assert.equal(retained.phases.old.run.runId, old.runId);
    assert.equal(retained.phases.repaired.tracePack.runId, repaired.runId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
