import { describe, expect, it } from "vitest";
import { traceVideoInterval } from "./run-report-media";
import { mapDiagnosticEventsToVideo } from "./run-product-service";

describe("Run report video clock mapping", () => {
  it("maps diagnostic wall-clock events to bounded video offsets", () => {
    expect(
      mapDiagnosticEventsToVideo(
        [
          { id: "d1", title: "tap failed", at: 12_500 },
          { id: "d2", title: "unknown" },
        ],
        { startedAt: 10_000 },
      ),
    ).toEqual([
      { id: "d1", title: "tap failed", at: 12_500, videoTimeMs: 2_500 },
      { id: "d2", title: "unknown" },
    ]);
  });
});

describe("trace video intervals", () => {
  it("seeks using capture-relative time, never epoch milliseconds", () => {
    const start = 1_800_000_000_000;
    expect(
      traceVideoInterval(
        { startedAt: start + 2500, finishedAt: start + 4000 },
        { startedAt: start, finishedAt: start + 5000 },
      ),
    ).toEqual({ startMs: 2500, endMs: 4000 });
  });
  it("does not invent synchronization for an unknown clock or out-of-capture step", () => {
    expect(traceVideoInterval({ startedAt: 500 }, {})).toBeUndefined();
    expect(traceVideoInterval({ startedAt: 500 }, { startedAt: 1000 })).toBeUndefined();
    expect(
      traceVideoInterval({ startedAt: 3000 }, { startedAt: 1000, finishedAt: 2000 }),
    ).toBeUndefined();
  });
});
