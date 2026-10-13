import { expect, it } from "vitest";
import { projectRunReport } from "./run-report-projection";

it("keeps a nested checkpoint's retained image beside an authored-step capture", () => {
  const frames = [
    { path: "frames/001.png", caption: "Settings layout", mime: "image/png" },
    { path: "frames/002.png", caption: "step:settings:Open settings", mime: "image/png" },
  ];
  const report = projectRunReport(
    "run",
    {
      frames,
      steps: [{ title: "Capture for review · step:settings:Open settings", frames: [frames[1]] }],
      artifacts: frames.map((frame, index) => ({
        kind: "capture-review",
        data: {
          status: "pending",
          caption: frame.caption,
          framePath: frame.path,
          imageSha256: String(index + 1).repeat(64),
          stepId: index ? "settings" : "nested-settings",
        },
      })),
    },
    { channels: { screenshot: { channel: "screenshot", status: "captured", entries: 2 } } },
  );
  expect(report.captureReview?.items.map((item) => item.framePath)).toEqual([
    "frames/001.png",
    "frames/002.png",
  ]);
  expect(
    report.evidence.find((section) => section.id === "screenshot")?.items.map((item) => item.id),
  ).toEqual(["frames/001.png", "frames/002.png"]);
});

it("keeps leftover navigation images out of the destination review", () => {
  const frames = [
    { path: "frames/001.png", caption: "After Close", mime: "image/png" },
    { path: "frames/002.png", caption: "Settings", mime: "image/png" },
  ];
  const report = projectRunReport(
    "run",
    {
      frames,
      artifacts: frames.map((frame, index) => ({
        kind: "capture-review",
        data: {
          status: "pending",
          caption: frame.caption,
          framePath: frame.path,
          imageSha256: String(index + 1).repeat(64),
          phase: index ? "dest" : "leftover",
        },
      })),
    },
    { channels: { screenshot: { channel: "screenshot", status: "captured", entries: 2 } } },
  );
  expect(
    report.evidence.find((section) => section.id === "screenshot")?.items.map((item) => item.id),
  ).toEqual(["frames/002.png"]);
});
