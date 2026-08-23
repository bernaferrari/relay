import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestJob } from "./session.js";
import {
  RelayRunBundleError,
  exportRelayRunBundle,
  persistRun,
  verifyRelayRunBundle,
  writeFramePng,
} from "./runs.js";

function completedJob(runDir: string): TestJob {
  const at = Date.now();
  return {
    id: "bundle-run",
    action: "bundle-test",
    platform: "android",
    targetContext: { kind: "device", platform: "android", serial: "bundle-device" },
    targetKind: "device",
    status: "ok",
    queuedAt: at - 30,
    startedAt: at - 20,
    finishedAt: at,
    logs: ["started", "finished"],
    attempts: 1,
    steps: [],
    frames: [],
    artifacts: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Bundle test",
    runDir,
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

async function fixture(root: string): Promise<{ runDir: string; files: string[] }> {
  const runDir = join(root, "run");
  const job = completedJob(runDir);
  await writeFramePng(job, Buffer.from("png evidence").toString("base64"), "screen");
  await mkdir(join(runDir, "video"), { recursive: true });
  await writeFile(join(runDir, "video", "run.mp4"), Buffer.from("video evidence"));
  await persistRun(job);
  return {
    runDir,
    files: [
      ".complete",
      "frames/001.png",
      "log.txt",
      "run.json",
      "video/run.mp4",
    ],
  };
}

test("relayrun export is deterministic and digests every finalized artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-bundle-"));
  try {
    const { runDir, files } = await fixture(root);
    const first = await exportRelayRunBundle(runDir, join(root, "first.relayrun"));
    const second = await exportRelayRunBundle(runDir, join(root, "second.relayrun"));
    const verified = await verifyRelayRunBundle(first.path);

    assert.equal(first.bundleSha256, second.bundleSha256);
    assert.deepEqual(await readFile(first.path), await readFile(second.path));
    assert.deepEqual(
      first.manifest.entries.map((entry) => entry.path),
      files,
    );
    assert.deepEqual(verified, {
      bytes: first.bytes,
      manifest: first.manifest,
      manifestSha256: first.manifestSha256,
      bundleSha256: first.bundleSha256,
    });
    for (const entry of first.manifest.entries) {
      const source = await readFile(join(runDir, ...entry.path.split("/")));
      assert.equal(entry.bytes, source.byteLength);
      assert.equal(entry.sha256, createHash("sha256").update(source).digest("hex"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("relayrun verification rejects artifact tampering and configured size overruns", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-bundle-tamper-"));
  try {
    const { runDir } = await fixture(root);
    const result = await exportRelayRunBundle(runDir, join(root, "run.relayrun"));
    const tampered = Buffer.from(await readFile(result.path));
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    const tamperedPath = join(root, "tampered.relayrun");
    await writeFile(tamperedPath, tampered);
    const truncatedPath = join(root, "truncated.relayrun");
    await writeFile(truncatedPath, tampered.subarray(0, tampered.byteLength - 1));

    await assert.rejects(
      verifyRelayRunBundle(tamperedPath),
      (error: unknown) => error instanceof RelayRunBundleError && error.code === "DIGEST_MISMATCH",
    );
    await assert.rejects(
      verifyRelayRunBundle(truncatedPath),
      (error: unknown) => error instanceof RelayRunBundleError && error.code === "INVALID_BUNDLE",
    );
    await assert.rejects(
      verifyRelayRunBundle(result.path, { maxBundleBytes: result.bytes - 1 }),
      (error: unknown) => error instanceof RelayRunBundleError && error.code === "LIMIT_EXCEEDED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("relayrun verification rejects traversal paths before reading artifact data", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-bundle-path-"));
  try {
    const manifest = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        format: "relayrun",
        digestAlgorithm: "sha256",
        run: {
          id: "unsafe",
          schemaVersion: 5,
          inputDigest: "0".repeat(64),
        },
        entries: [
          {
            path: "../run.json",
            bytes: 0,
            sha256: createHash("sha256").digest("hex"),
            mediaType: "application/json",
          },
        ],
      }),
    );
    const header = Buffer.alloc(Buffer.byteLength("RELAYRUN\x01\n", "binary") + 8);
    header.write("RELAYRUN\x01\n", 0, "binary");
    header.writeBigUInt64BE(BigInt(manifest.byteLength), header.byteLength - 8);
    const path = join(root, "unsafe.relayrun");
    await writeFile(path, Buffer.concat([header, manifest]));

    await assert.rejects(
      verifyRelayRunBundle(path),
      (error: unknown) => error instanceof RelayRunBundleError && error.code === "UNSAFE_PATH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("relayrun export rejects incomplete runs and unsafe destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-bundle-source-"));
  try {
    const incomplete = join(root, "incomplete");
    await mkdir(incomplete);
    await assert.rejects(
      exportRelayRunBundle(incomplete, join(root, "incomplete.relayrun")),
      (error: unknown) => error instanceof RelayRunBundleError && error.code === "INCOMPLETE_RUN",
    );

    const { runDir } = await fixture(root);
    await assert.rejects(
      exportRelayRunBundle(runDir, join(runDir, "nested.relayrun")),
      (error: unknown) => error instanceof RelayRunBundleError && error.code === "UNSAFE_PATH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
