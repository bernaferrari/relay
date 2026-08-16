import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ScreenshotPayload } from "./workspace-capture.js";
import { awaitStableDestinationEvidence } from "./destination-evidence.js";

function raster(fingerprint: string): ScreenshotPayload {
  return {
    capturedAt: 1,
    mime: "image/png",
    base64: Buffer.from(fingerprint).toString("base64"),
    path: `/tmp/${fingerprint}.png`,
    bytes: fingerprint.length,
    screenMatch: {
      fingerprint,
      visualFingerprint: fingerprint,
      matchedScreenId: null,
      status: "observed",
    },
  };
}

describe("stable destination evidence", () => {
  it("uses semantic quiescence without a fixed delay for ordinary screens", async () => {
    let waits = 0;
    let observations = 0;
    const stable = await awaitStableDestinationEvidence({
      surface: "ordinary",
      navigationStartedAt: 0,
      observe: async (includeRaster) => {
        observations += 1;
        assert.equal(includeRaster, false);
        return { nodes: [{ role: "heading", label: "Settings" }] };
      },
      wait: async () => {
        waits += 1;
      },
      clock: () => 0,
    });

    assert.equal(observations, 2);
    assert.equal(waits, 0);
    assert.equal(stable.timing.evidenceDwellMs, 0);
    assert.equal(stable.timing.stableObservationCount, 2);
  });

  it("resets the review dwell when semantic or raster evidence changes", async () => {
    let clock = 0;
    let index = 0;
    const observations = [
      { label: "Preview", raster: "a".repeat(64) },
      { label: "Preview", raster: "a".repeat(64) },
      { label: "Preview ready", raster: "b".repeat(64) },
      { label: "Preview ready", raster: "b".repeat(64) },
      { label: "Preview ready", raster: "b".repeat(64) },
    ];
    const stable = await awaitStableDestinationEvidence({
      surface: "preview",
      navigationStartedAt: 0,
      observe: async () => {
        const observation = observations[index++]!;
        return {
          nodes: [{ role: "heading", label: observation.label }],
          screenshot: raster(observation.raster),
        };
      },
      wait: async (durationMs) => {
        clock += durationMs;
      },
      clock: () => clock,
    });

    assert.equal(index, 5, "the changed preview must establish a new stable pair");
    assert.ok(stable.timing.evidenceDwellMs >= 500);
    assert.equal(stable.timing.surface, "preview");
  });
});
