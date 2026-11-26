import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ScreenshotPayload, SnapshotPayload } from "@relay/core";
import { captureDurableTargetObservation } from "./target-observation-route.js";

function shot(capturedAt = 10, bytes = Buffer.from("visible-pixels")): ScreenshotPayload {
  return {
    serial: "pixel-9",
    capturedAt,
    mime: "image/png",
    base64: bytes.toString("base64"),
    path: `/private/transient/${capturedAt}.png`,
    bytes: bytes.byteLength,
    width: 1080,
    height: 2400,
    foregroundApp: "com.example.app",
  };
}

function snap(capturedAt = 11): SnapshotPayload {
  return {
    serial: "pixel-9",
    capturedAt,
    nodes: [{ label: "Settings", role: "button" }],
    interactive: [{ label: "Settings", role: "button", enabled: true }],
    bounds: { width: 1080, height: 2400 },
    inspectable: true,
    source: "android-system",
    inspectionState: "active",
    foregroundApp: "com.example.app",
    screenIdentity: {
      fingerprint: "semantic-settings",
      nodes: [],
      volatileSignals: [],
    },
  };
}

async function isolated<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.RELAY_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "relay-target-observation-test-"));
  process.env.RELAY_STATE_DIR = root;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("durable observation serializes planes and closes pixels and semantics by digest", async () => {
  await isolated(async () => {
    const order: string[] = [];
    const cleaned: string[] = [];
    const result = await captureDurableTargetObservation("pixel-9", {
      async platformForSerial() {
        return "android";
      },
      async capturePixels() {
        order.push("pixels");
        return shot();
      },
      async captureSemantics() {
        order.push("semantics");
        return snap();
      },
      async cleanupPixels(path) {
        cleaned.push(path);
      },
    });

    assert.deepEqual(order, ["pixels", "semantics"]);
    assert.deepEqual(cleaned, ["/private/transient/10.png"]);
    assert.equal(result.pixels.status, "captured");
    assert.equal(
      result.pixels.status === "captured" ? result.pixels.artifact.status : "",
      "available",
    );
    assert.equal(result.semantics.artifact.status, "available");
    assert.equal(result.semantics.status, "current");
    assert.equal(result.semantics.controls.length, 1);
    assert.equal(JSON.stringify(result).includes("/private/transient"), false);
  });
});

test("durable observation preserves pixel-only evidence when semantics fail", async () => {
  await isolated(async () => {
    const result = await captureDurableTargetObservation("pixel-9", {
      async platformForSerial() {
        return "android";
      },
      async capturePixels() {
        return shot();
      },
      async captureSemantics() {
        throw new Error("Accessibility is temporarily unavailable.");
      },
      async cleanupPixels() {},
    });

    assert.equal(result.pixels.status, "captured");
    assert.equal(result.semantics.status, "unavailable");
    assert.equal(result.semantics.artifact.status, "available");
    assert.match(result.semantics.message ?? "", /temporarily unavailable/u);
  });
});

test("iOS observation brackets one semantic traversal without overlapping it", async () => {
  await isolated(async () => {
    const order: string[] = [];
    const result = await captureDurableTargetObservation("ipad", {
      async platformForSerial() {
        return "ios";
      },
      async capturePixels() {
        order.push("pixels");
        return shot(order.length === 1 ? 10 : 12);
      },
      async captureSemantics() {
        order.push("semantics");
        return snap(11);
      },
      async cleanupPixels() {},
    });

    assert.deepEqual(order, ["pixels", "semantics", "pixels"]);
    assert.equal(result.semantics.status, "current");
  });
});
