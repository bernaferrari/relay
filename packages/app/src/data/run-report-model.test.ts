import { projectRunReport } from "./run-report-projection";
import { describe, expect, it } from "vitest";
import { traceVideoInterval } from "./run-report-media";
import { mapDiagnosticEventsToVideo } from "./run-product-service";

it("retains the original cause for exact story joins while keeping public copy readable", () => {
  const technicalCause =
    "layout assertion: identifier team-seats overlaps identifier save-settings by 44×44 px";
  const report = projectRunReport("layout", { error: technicalCause }, {});
  expect(report.technicalCause).toBe(technicalCause);
  expect(report.cause).toBe("Relay could not complete this test with the saved recording.");
});

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

describe("recorded HTTP errors", () => {
  it("shows a nearby matching request without claiming it caused the log", () => {
    const report = projectRunReport(
      "run",
      {},
      {
        channels: { logs: { channel: "logs", status: "captured", entries: 1 } },
        logs: [
          {
            id: "log",
            at: 2000,
            level: "error",
            message: "Failed to load resource: the server responded with a status of 404 ()",
          },
        ],
        network: [{ at: 1800, status: 404, method: "GET", url: "https://example.com/missing.png" }],
      },
    );
    expect(JSON.stringify(report)).toContain(
      "Request recorded at the same time: GET https://example.com/missing.png",
    );
  });
  it("does not attribute an ambiguous error to one of several requests", () => {
    const report = projectRunReport(
      "run",
      {},
      {
        channels: { logs: { channel: "logs", status: "captured", entries: 1 } },
        logs: [
          {
            at: 2000,
            message: "Failed to load resource: the server responded with a status of 404 ()",
          },
        ],
        network: ["a", "b"].map((name) => ({
          at: 1800,
          status: 404,
          url: `https://example.com/${name}`,
        })),
      },
    );
    expect(JSON.stringify(report)).not.toContain("Request recorded at the same time:");
    expect(JSON.stringify(report)).toContain("Check Network for the request URL.");
  });
});
