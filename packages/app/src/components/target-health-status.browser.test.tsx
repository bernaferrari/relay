import { expect, test } from "vitest";
import { render } from "solid-js/web";
import type { TargetSupervisorHealth } from "@relay/protocol";
import { TargetHealthStatus } from "./target-health-status";

const health = {
  schemaVersion: 1,
  target: { id: "ipad", kind: "ios" },
  observedAt: 1,
  epochs: { target: 1, semanticSession: 2 },
  pixels: { state: "ready" },
  semantics: { state: "unavailable" },
  input: { state: "uncertain" },
  control: { state: "owned" },
  overall: "pixel-only",
  context: {},
  counters: {
    pixelCaptures: 1,
    semanticTraversals: 1,
    semanticTimeouts: 0,
    semanticWedges: 0,
    uncertainMutations: 1,
    reconciliations: 0,
    recoveryAttempts: 0,
    recoveryFailures: 0,
  },
  latency: {
    pixels: { count: 1 },
    semantics: { count: 1 },
    recovery: { count: 0 },
  },
  readiness: {
    previewPixels: {
      mode: "pixels",
      state: "proven",
      freshness: "current",
      proof: { at: 1 },
    },
    semanticControl: {
      mode: "accessibility",
      state: "unavailable",
      freshness: "unproven",
    },
    evidenceCapture: {
      mode: "evidence",
      state: "proven",
      freshness: "current",
      proof: { at: 1 },
    },
  },
  events: [],
} satisfies TargetSupervisorHealth;

test("device health exposes four independent, screen-reader-labelled capabilities", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(() => <TargetHealthStatus health={health} />, root);

  expect(root.querySelectorAll("[data-target-health-plane]")).toHaveLength(4);
  expect(root.querySelector("[data-target-health-plane='overall']")?.textContent).toContain(
    "OverallPixels only",
  );
  expect(root.querySelector("[data-target-health-plane='pixels']")?.textContent).toContain(
    "PixelsLive",
  );
  expect(root.querySelector("[data-target-health-plane='semantics']")?.textContent).toContain(
    "LabelsUnavailable",
  );
  expect(
    root.querySelector("[data-target-health-plane='input']")?.getAttribute("aria-label"),
  ).toContain("Review what happened before sending another action");
  expect(root.textContent).not.toMatch(/disconnected/i);

  dispose();
});
