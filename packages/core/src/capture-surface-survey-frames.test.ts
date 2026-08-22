import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertCaptureSurfaceSurveyUsable,
  persistCaptureSurfaceSurveyFrames,
} from "./capture-surface-survey-frames.js";
import { runCaptureSurfaceStep } from "./recipe-runner-extended-steps.js";
import { parseFrameTreeNodes } from "./run-frame-tree.js";
import type { RecipeStep } from "./recipes.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { ScrollSurveyResult } from "./scrollable-survey-types.js";
import type { TestJob } from "./session-contract.js";

const step: Extract<RecipeStep, { kind: "capture-surface" }> = {
  kind: "capture-surface",
  screenId: "long-list",
  screenTitle: "Long list",
  variantId: "long-list-en",
  surfaceId: "long-list-surface",
  baselineCaptureId: "long-list-baseline",
  reason: "The destination list is longer than one viewport.",
  forceRecapture: true,
  baselineTrust: "recapture-required",
};

function job(runDir: string): TestJob {
  return {
    id: "combine-visual-cell",
    action: "combine-cell",
    platform: "ios",
    serial: "ipad-1",
    targetContext: { kind: "device", platform: "ios", serial: "ipad-1" },
    targetKind: "device",
    targetProfile: {
      id: "ipad-en",
      targetId: "ipad-1",
      source: "device",
      platform: "ios",
      name: "iPad",
      capabilities: ["screenshot", "snapshot", "scroll"],
      observedAt: 1,
    },
    status: "running",
    queuedAt: 1,
    startedAt: 1,
    logs: [],
    attempts: 1,
    steps: [],
    frames: [],
    artifacts: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Combine visual",
    runDir,
    resolvedInputs: { locale: "en", app_version: "1.0" },
    appVersion: "1.0",
    sensitiveInputNames: [],
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

function survey(
  frames: number,
  reason: ScrollSurveyResult["reason"] = "end-of-content",
): ScrollSurveyResult {
  return {
    status: reason === "end-of-content" ? "completed" : "stopped",
    reason,
    frames: Array.from({ length: frames }, (_, index) => ({
      index,
      offsetY: index * 80,
      appendedHeight: index === 0 ? 0 : 80,
      screenshot: {
        base64: Buffer.from(`raster-${index}`).toString("base64"),
        width: 100,
        height: 200,
        capturedAt: 10 + index,
      },
      snapshot: {
        capturedAt: 10 + index,
        nodes: [
          {
            identifier: index === 1 ? "delete-account" : "export-data",
            label: index === 1 ? "Delete Account" : "Export Data",
            type: "Button",
            rect: { x: 0, y: 40, width: 100, height: 40 },
          },
        ],
        interactive: [],
        inspectable: true,
        source: "sdk",
        screenIdentity: { fingerprint: "f".repeat(64), nodes: [], volatileSignals: [] },
      },
    })),
    diagnosticFrames: [],
    mergedNodes: [],
    restoredStartViewport: true,
    message: reason,
  };
}

test("a usable survey persists every raw PNG and tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-surface-frames-"));
  const current = job(directory);
  try {
    await persistCaptureSurfaceSurveyFrames(current, step, survey(2));
    assert.equal(current.frames.length, 2);
    assert.deepEqual(
      current.frames.map((frame) => frame.caption),
      ["surface:Long list · 1", "surface:Long list · 2"],
    );
    const tree = parseFrameTreeNodes(
      JSON.parse(await readFile(join(directory, "frames", "002.json"), "utf8")),
    );
    assert.equal(tree?.[0]?.identifier, "delete-account");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a requested full-surface survey that cannot run is a visible failure", () => {
  assert.throws(
    () => assertCaptureSurfaceSurveyUsable(survey(0, "inspection-unavailable"), step),
    /full-surface survey did not run/u,
  );
  assert.throws(
    () => assertCaptureSurfaceSurveyUsable(survey(1, "inspection-unavailable"), step),
    /inspection-unavailable/u,
  );
  for (const reason of [
    "screen-changed",
    "scroll-failed",
    "restore-failed",
    "start-viewport-unproven",
    "seam-ambiguous",
    "dimension-changed",
  ] as const) {
    assert.throws(
      () => assertCaptureSurfaceSurveyUsable(survey(1, reason), step),
      new RegExp(reason, "u"),
    );
  }
  assert.doesNotThrow(() => assertCaptureSurfaceSurveyUsable(survey(1, "end-of-content"), step));
  assert.doesNotThrow(() => assertCaptureSurfaceSurveyUsable(survey(1, "limit-reached"), step));
});

test("Combine visual capture-surface surveys after arrival and fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-surface-run-"));
  const current = job(directory);
  const ctx = { job: current, log() {} } as RecipeStepContext;
  const captured: string[] = [];
  try {
    await runCaptureSurfaceStep(step, ctx, {
      captureSurvey: async () => {
        captured.push("survey");
        return survey(2);
      },
      persistSurface: async ({ survey: result }) =>
        ({
          schemaVersion: 1,
          id: step.surfaceId,
          captureId: "live",
          targetProfileId: "ipad-en",
          capturePolicy: {
            captureMode: "full-surface",
            source: "explicit",
            reason: step.reason,
            decidedAt: 1,
          },
          capturedAt: 1,
          status: result.status,
          reason: result.reason,
          message: result.message,
          restoredStartViewport: result.restoredStartViewport,
          viewports: [],
          mergedTree: {
            id: "merged",
            uri: "relay-evidence://merged",
            sha256: "m".repeat(64),
            mime: "application/json",
            bytes: 2,
            nodeCount: 2,
          },
          manifest: {
            id: "manifest",
            uri: "relay-evidence://manifest",
            sha256: "n".repeat(64),
            mime: "application/json",
            bytes: 2,
          },
        }) as never,
    });
    assert.deepEqual(captured, ["survey"]);
    assert.equal(current.frames.length, 2);
    assert.equal(
      current.artifacts.some((artifact) => artifact.kind === "logical-scroll-surface-result"),
      true,
    );

    await assert.rejects(
      () =>
        runCaptureSurfaceStep(step, ctx, {
          captureSurvey: async () => survey(0, "inspection-unavailable"),
          persistSurface: async () => {
            throw new Error("survey must fail before persist");
          },
        }),
      /full-surface survey did not run/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
