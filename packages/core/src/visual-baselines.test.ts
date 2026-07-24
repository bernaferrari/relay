import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { approveVisualBaseline, getVisualBaseline, visualTargetKey } from "./visual-baselines.js";

test("visual baselines are scoped to a recipe and target, and replace only that scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-visual-baselines-"));
  try {
    const first = await approveVisualBaseline(root, {
      id: "run-1",
      action: "custom-sign-in",
      serial: "pixel-1",
    });
    assert.equal(first.runId, "run-1");
    assert.equal((await getVisualBaseline(root, "custom-sign-in", "pixel-1"))?.runId, "run-1");
    await approveVisualBaseline(root, {
      id: "run-2",
      action: "custom-sign-in",
      serial: "pixel-1",
    });
    await approveVisualBaseline(root, {
      id: "run-3",
      action: "custom-sign-in",
      serial: "pixel-2",
    });
    assert.equal((await getVisualBaseline(root, "custom-sign-in", "pixel-1"))?.runId, "run-2");
    assert.equal((await getVisualBaseline(root, "custom-sign-in", "pixel-2"))?.runId, "run-3");
    assert.equal(
      visualTargetKey({
        targetProfile: {
          id: "android-15",
          targetId: "pixel-1",
          source: "device",
          platform: "android",
          name: "Pixel",
          capabilities: [],
          observedAt: 0,
        },
      }),
      "android-15",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
