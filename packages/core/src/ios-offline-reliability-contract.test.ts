import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  IosMutationOutcomeUnknownError,
  IosSnapshotTimedOutError,
  pressPoint,
  type Device,
} from "./device.js";
import { iosVisualVerificationDiagnostic, verifyIosScreenChanged } from "./ios-app-launch.js";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import { runWithTargetContext } from "./target-context.js";
import {
  recordTargetPixelCapture,
  resetTargetRuntimeReadiness,
} from "./target-runtime-readiness.js";
import { captureSnapshot } from "./workspace-capture.js";

test("offline iOS contract keeps pixels, AX latency, exact-once action, and repair evidence separate", async () => {
  const serial = "offline-contract-ipad";
  const evidenceRoot = await mkdtemp(join(tmpdir(), "relay-ios-contract-evidence-"));
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "relay-ios-contract-pixels-"));
  const priorStateRoot = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = evidenceRoot;
  let snapshotReads = 0;
  let nativePresses = 0;
  const commands: string[][] = [];
  const device = {
    capture: {
      snapshot: async () => {
        snapshotReads += 1;
        throw new IosSnapshotTimedOutError(8_000, 8_000);
      },
    },
    interactions: {
      press: async () => {
        nativePresses += 1;
        throw new Error("connection reset after native XCTest press");
      },
    },
  } as unknown as Device;

  try {
    recordTargetPixelCapture({ serial, platform: "ios" }, { at: Date.now(), durationMs: 6 });
    const snapshot = await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
      captureSnapshot({ device }),
    );
    assert.equal(snapshotReads, 1);
    assert.equal(snapshot.source, "pixels-only");
    assert.equal(snapshot.readiness?.previewPixels.state, "proven");
    assert.equal(snapshot.readiness?.evidenceCapture.state, "proven");
    assert.equal(snapshot.readiness?.semanticControl.reason, "probe-in-flight");
    assert.equal(snapshot.iosSessionLifecycle?.outcome, "in-flight");

    const unavailableSerial = "offline-contract-root-only-ipad";
    recordTargetPixelCapture(
      { serial: unavailableSerial, platform: "ios" },
      { at: Date.now(), durationMs: 4 },
    );
    const unavailable = await runWithTargetContext(
      { kind: "device", platform: "ios", serial: unavailableSerial },
      () =>
        captureSnapshot({
          device: {
            capture: {
              snapshot: async () => ({
                nodes: [
                  {
                    type: "Application",
                    label: "Grok",
                    rect: { x: 0, y: 0, width: 834, height: 1112 },
                  },
                ],
              }),
            },
          } as unknown as Device,
        }),
    );
    assert.equal(unavailable.source, "pixels-only");
    assert.equal(unavailable.readiness?.previewPixels.state, "proven");
    assert.equal(unavailable.readiness?.semanticControl.state, "unavailable");
    assert.match(
      unavailable.inspectionError ?? "",
      /did not observe named accessibility controls/i,
    );

    let failure: unknown;
    await assert.rejects(
      verifyIosScreenChanged(
        serial,
        () =>
          runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
            pressPoint(device, 48, 72),
          ),
        {
          bin: "ios",
          settleMs: 0,
          temporaryDirectory,
          run: async (_file, args) => {
            commands.push([...args]);
            const output = args
              .find((arg) => arg.startsWith("--output="))
              ?.slice("--output=".length);
            if (!output) return { exitCode: 1, stdout: "", stderr: "missing output" };
            await writeFile(output, commands.length === 1 ? "before" : "after");
            return { exitCode: 0, stdout: "captured", stderr: "" };
          },
          repair: {
            interaction: {
              id: "offline-unknown-press",
              label: "Tap (48, 72)",
              input: { kind: "point", x: 48, y: 72 },
            },
          },
        },
      ),
      (error: unknown) => {
        failure = error;
        return error instanceof IosMutationOutcomeUnknownError;
      },
    );

    assert.equal(nativePresses, 1, "an uncertain native action is never replayed");
    assert.equal(commands.length, 2, "one before and one after pixel proof are enough");
    assert.ok(commands.every((args) => args[0] === "screenshot"));
    const diagnostic = iosVisualVerificationDiagnostic(failure);
    assert.equal(diagnostic?.failure?.stage, "action");
    assert.equal(diagnostic?.repair?.interaction.id, "offline-unknown-press");
    assert.ok(diagnostic?.repair?.before?.evidence?.sha256);
    assert.ok(diagnostic?.repair?.after?.evidence?.sha256);
    assert.ok(diagnostic?.repair?.manifest.sha256);
    const manifest = JSON.parse(
      (await readAuthoringEvidence(diagnostic?.repair?.manifest.sha256 ?? ""))?.toString() ?? "{}",
    ) as { outcome?: string; failure?: { stage?: string }; interaction?: unknown };
    assert.equal(manifest.outcome, "incomplete");
    assert.equal(manifest.failure?.stage, "action");
    assert.deepEqual(manifest.interaction, diagnostic?.repair?.interaction);
    assert.deepEqual(
      (await readdir(temporaryDirectory)).filter((name) => name.startsWith("relay-tap-")),
      [],
      "temporary pixels are cleaned after immutable repair evidence is stored",
    );
  } finally {
    resetTargetRuntimeReadiness();
    if (priorStateRoot === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = priorStateRoot;
    await rm(evidenceRoot, { recursive: true, force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
