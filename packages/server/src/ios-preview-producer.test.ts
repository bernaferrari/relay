import assert from "node:assert/strict";
import test from "node:test";
import {
  IOS_SAFE_PREVIEW_PRODUCER_ENV,
  IOS_SAFE_PREVIEW_PRODUCER_PACKAGED_ENV,
  IOS_SAFE_PREVIEW_PRODUCER_VERSION,
  IOS_SAFE_PREVIEW_PRODUCER_VERSION_CACHE_MS,
  IOS_SAFE_PREVIEW_PRODUCER_VERSION_TIMEOUT_MS,
  defaultIosPreviewProducerPath,
  iosSafePreviewProducerProvenanceHeaders,
  resolveSafeIosPreviewProducer,
  safeIosPreviewProducerArgs,
  verifySafeIosPreviewProducer,
  type VerifySafeIosPreviewProducerOptions,
} from "./ios-preview-producer.js";

const root = "/workspace/relay";
const defaultPath = "/workspace/relay/.relay/bin/relay-ios-preview";

function safeDefaultOptions(
  overrides: Partial<VerifySafeIosPreviewProducerOptions> = {},
): VerifySafeIosPreviewProducerOptions {
  return {
    root,
    accessible: async (candidate) => assert.equal(candidate, defaultPath),
    fileIdentity: async (candidate) => {
      assert.equal(candidate, defaultPath);
      return "sidecar:one";
    },
    versionProbe: async (candidate, timeoutMs) => {
      assert.equal(candidate, defaultPath);
      assert.equal(timeoutMs, IOS_SAFE_PREVIEW_PRODUCER_VERSION_TIMEOUT_MS);
      return IOS_SAFE_PREVIEW_PRODUCER_VERSION;
    },
    cache: new Map(),
    now: () => 1_000,
    ...overrides,
  };
}

test("proves the reviewed local sidecar version before launch", async () => {
  const verified = await verifySafeIosPreviewProducer(safeDefaultOptions());
  assert.equal(verified.path, defaultPath);
  assert.deepEqual(verified.provenance, {
    source: "default",
    sourceSafety: "pinned-version-match",
    observedVersion: IOS_SAFE_PREVIEW_PRODUCER_VERSION,
  });
  assert.equal(defaultIosPreviewProducerPath(root), verified.path);
});

test("keeps the legacy path resolver behind the same version proof", async () => {
  const path = await resolveSafeIosPreviewProducer(safeDefaultOptions());
  assert.equal(path, defaultPath);
  assert.deepEqual(safeIosPreviewProducerArgs("ipad-1", ["--tunnel-info-port", "28100"]), [
    "--udid",
    "ipad-1",
    "--tunnel-info-port",
    "28100",
  ]);
});

test("rejects a stale default sidecar with rebuild guidance before a target can be used", async () => {
  await assert.rejects(
    () =>
      verifySafeIosPreviewProducer(
        safeDefaultOptions({ versionProbe: async () => "relay-ios-preview/0 go-ios=old" }),
      ),
    (error: unknown) => {
      assert.match(String(error), /not the reviewed pinned build/i);
      assert.match(String(error), /Expected version: relay-ios-preview\/1/i);
      assert.match(String(error), /pnpm ios-preview:build/i);
      return true;
    },
  );
});

test("bounds a timed out version probe and never starts device or tunnel work from verification", async () => {
  let probes = 0;
  const timedOut = Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true });
  const options = safeDefaultOptions({
    cache: new Map(),
    versionProbe: async (candidate, timeoutMs) => {
      probes += 1;
      assert.equal(candidate, defaultPath);
      assert.equal(timeoutMs, IOS_SAFE_PREVIEW_PRODUCER_VERSION_TIMEOUT_MS);
      throw timedOut;
    },
  });
  await assert.rejects(
    () => verifySafeIosPreviewProducer(options),
    /did not report a version within 1000ms/i,
  );
  await assert.rejects(() => verifySafeIosPreviewProducer(options), /within 1000ms/i);
  assert.equal(probes, 1);
});

test("caches a version proof only while the exact executable identity remains current", async () => {
  let now = 1_000;
  let identity = "sidecar:one";
  let probes = 0;
  const cache = new Map();
  const options = safeDefaultOptions({
    cache,
    now: () => now,
    fileIdentity: async () => identity,
    versionProbe: async () => {
      probes += 1;
      return IOS_SAFE_PREVIEW_PRODUCER_VERSION;
    },
  });

  await verifySafeIosPreviewProducer(options);
  await verifySafeIosPreviewProducer(options);
  assert.equal(probes, 1);

  identity = "sidecar:replacement";
  await verifySafeIosPreviewProducer(options);
  assert.equal(probes, 2);

  now += IOS_SAFE_PREVIEW_PRODUCER_VERSION_CACHE_MS;
  await verifySafeIosPreviewProducer(options);
  assert.equal(probes, 3);
});

test("allows a deliberate override while making its observed provenance visibly unverified", async () => {
  const path = "/opt/relay/ios-preview";
  const verified = await verifySafeIosPreviewProducer({
    env: { [IOS_SAFE_PREVIEW_PRODUCER_ENV]: path },
    accessible: async (candidate) => assert.equal(candidate, path),
    fileIdentity: async () => "override:one",
    versionProbe: async (candidate, timeoutMs) => {
      assert.equal(candidate, path);
      assert.equal(timeoutMs, IOS_SAFE_PREVIEW_PRODUCER_VERSION_TIMEOUT_MS);
      return "custom preview build 2026-08-20\n";
    },
    cache: new Map(),
  });

  assert.deepEqual(verified.provenance, {
    source: "explicit-override",
    sourceSafety: "override-unverified",
    observedVersion: "custom preview build 2026-08-20",
  });
  assert.deepEqual(iosSafePreviewProducerProvenanceHeaders(verified.provenance), {
    "X-Relay-Ios-Preview-Producer-Provenance": "explicit-override",
    "X-Relay-Ios-Preview-Producer-Safety": "override-unverified",
    "X-Relay-Ios-Preview-Producer-Version": "custom preview build 2026-08-20",
  });
});

test("gives packaged Relay a reinstall path instead of an automatic source build", async () => {
  await assert.rejects(
    () =>
      verifySafeIosPreviewProducer({
        env: { [IOS_SAFE_PREVIEW_PRODUCER_PACKAGED_ENV]: "1" },
        root,
        accessible: async () => Promise.reject(new Error("missing")),
      }),
    (error: unknown) => {
      assert.match(String(error), /Reinstall Relay/i);
      assert.doesNotMatch(String(error), /pnpm ios-preview:build/i);
      return true;
    },
  );
});

test("fails closed when a source checkout has not built the sidecar", async () => {
  await assert.rejects(
    () =>
      resolveSafeIosPreviewProducer({
        root,
        accessible: async () => Promise.reject(new Error("missing")),
      }),
    /will not fall back to go-ios `screenshot --stream`/i,
  );
});
