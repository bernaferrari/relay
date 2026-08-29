import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CHANGE_PROOF_GOLDEN_LIVE,
  inspectAndroidPrerequisites,
  inspectManagedBrowserTargets,
  parseGoldenLiveArgs,
  runChangeProofGoldenLive,
  startGoldenFixtureServer,
} from "./change-proof-golden-live.mjs";

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
    assert.equal(report.exactProofInputs.oldTracePack.status, "unverified");
    assert.equal(report.exactProofInputs.repairedTracePack.status, "unverified");
    assert.equal(report.status, "insufficient-evidence");
    assert.equal(report.finalProof.status, "not-claimed");
    assert.ok(report.unsupported.some(({ id }) => id === "android.execution.not-run"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
