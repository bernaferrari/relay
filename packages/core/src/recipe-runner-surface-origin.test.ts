import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import type { RecipeStep } from "./recipes.js";
import {
  captureSurfaceBaselineDisposition,
  loadFrozenDocumentOriginForCaptureSurface,
} from "./recipe-runner-extended-steps.js";

function png(width: number, height: number): Buffer {
  const image = new PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = 22;
    image.data[index + 1] = 34;
    image.data[index + 2] = 55;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function trustedSettingsOrigin(): Promise<Extract<RecipeStep, { kind: "capture-surface" }>> {
  const capturedAt = 123;
  const screenshot = await persistAuthoringEvidence({
    kind: "screenshot",
    capturedAt,
    data: png(64, 160),
    mime: "image/png",
  });
  const accessibilityTree = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt,
    data: JSON.stringify({
      capturedAt,
      foregroundApp: "ai.x.GrokApp",
      inspectable: true,
      nodes: [
        {
          identifier: "settings-list",
          type: "ScrollView",
          rect: { x: 0, y: 0, width: 64, height: 160 },
        },
        { label: "Settings", type: "Toolbar", rect: { x: 0, y: 0, width: 64, height: 20 } },
      ],
    }),
    mime: "application/json",
  });
  return {
    kind: "capture-surface",
    screenId: "settings",
    screenTitle: "Settings",
    variantId: "android-en",
    surfaceId: "settings-surface",
    baselineCaptureId: "settings-r1",
    reason: "Settings is a stable product-owned surface.",
    baselineTrust: "trusted",
    documentOrigin: {
      index: 0,
      offsetY: 0,
      appendedHeight: 0,
      capturedAt,
      width: 64,
      height: 160,
      screenshot: {
        id: screenshot.id,
        uri: screenshot.uri,
        sha256: screenshot.sha256!,
        mime: "image/png",
        bytes: screenshot.bytes!,
      },
      accessibilityTree: {
        id: accessibilityTree.id,
        uri: accessibilityTree.uri,
        sha256: accessibilityTree.sha256!,
        mime: "application/json",
        bytes: accessibilityTree.bytes!,
      },
    },
    documentOriginProof: {
      schemaVersion: 1,
      method: "frozen-origin-match",
      firstViewport: {
        screenshotSha256: screenshot.sha256!,
        accessibilityTreeSha256: accessibilityTree.sha256!,
      },
    },
  };
}

test("rehydrates only exact immutable Settings origin evidence for fast restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-surface-origin-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    const step = await trustedSettingsOrigin();
    const origin = await loadFrozenDocumentOriginForCaptureSurface(step, "android-device");
    assert.equal(origin?.screenshot.width, 64);
    assert.equal(origin?.screenshot.height, 160);
    assert.equal(origin?.snapshot.foregroundApp, "ai.x.GrokApp");
    assert.equal(origin?.snapshot.nodes[0]?.identifier, "settings-list");
    assert.equal(captureSurfaceBaselineDisposition(step, origin).requiresRecapture, false);

    const mismatchedDimensions = {
      ...step,
      documentOrigin: { ...step.documentOrigin!, width: 65 },
    };
    assert.equal(
      await loadFrozenDocumentOriginForCaptureSurface(mismatchedDimensions, "android-device"),
      undefined,
    );
    const missingOrigin = await loadFrozenDocumentOriginForCaptureSurface(
      mismatchedDimensions,
      "android-device",
    );
    assert.deepEqual(captureSurfaceBaselineDisposition(mismatchedDimensions, missingOrigin), {
      requiresRecapture: true,
      reason:
        "The frozen document-origin evidence is unavailable or invalid, so this comparison must be recaptured and reviewed.",
    });
    assert.deepEqual(
      captureSurfaceBaselineDisposition(
        (() => {
          const { documentOrigin: _documentOrigin, ...legacyTrusted } = step;
          return legacyTrusted;
        })(),
        undefined,
      ),
      {
        requiresRecapture: true,
        reason:
          "A trusted baseline lacks frozen document-origin evidence, so this comparison must be recaptured and reviewed.",
      },
    );
    assert.equal(
      await loadFrozenDocumentOriginForCaptureSurface(
        {
          ...step,
          documentOrigin: { ...step.documentOrigin!, appendedHeight: 40 },
        },
        "android-device",
      ),
      undefined,
    );
    assert.equal(
      await loadFrozenDocumentOriginForCaptureSurface(
        { ...step, baselineTrust: "recapture-required" },
        "android-device",
      ),
      undefined,
    );
    const { documentOriginProof: _documentOriginProof, ...proofless } = step;
    assert.equal(
      await loadFrozenDocumentOriginForCaptureSurface(proofless, "android-device"),
      undefined,
    );
    const malformedProof = {
      ...step,
      documentOriginProof: {
        schemaVersion: 1,
        method: "frozen-origin-match",
        firstViewport: null,
      } as unknown as NonNullable<typeof step.documentOriginProof>,
    };
    assert.equal(
      await loadFrozenDocumentOriginForCaptureSurface(malformedProof, "android-device"),
      undefined,
      "malformed persisted proof must disable fast restore instead of throwing",
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
