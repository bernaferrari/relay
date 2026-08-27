import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Device } from "./device.js";
import { runExpectScreenStep } from "./recipe-runner-screen.js";
import { parseFrameTreeNodes } from "./run-frame-tree.js";
import { observeScreenIdentity } from "./screen-identity.js";
import type { Recipe } from "./recipes.js";
import type { TestJob } from "./session-contract.js";
import type { ScrollSurveyTargetInput } from "./scrollable-survey.js";
import type { ScrollSurveyResult } from "./scrollable-survey-types.js";
import { runWithTargetContext } from "./target-context.js";
import type { ScreenshotPayload } from "./workspace-capture.js";

/**
 * Minimal stub covering the SDK surface the expect step touches:
 * interactions.find (presence probe) and command.wait (waitFor + sleep).
 */
function stubDevice(impl: {
  find?: () => Promise<unknown>;
  press?: (options: unknown) => Promise<unknown>;
  wait?: () => Promise<unknown>;
  snapshot?: () => Promise<unknown>;
}): Device {
  return {
    interactions: {
      find: impl.find ?? (() => Promise.resolve({})),
      press: impl.press ?? (() => Promise.resolve({})),
      longPress: () => Promise.resolve({}),
      fill: () => Promise.resolve({}),
      type: () => Promise.resolve({}),
      swipe: () => Promise.resolve({}),
      scroll: () => Promise.reject(new Error("scroll unavailable in test")),
      pan: () => Promise.resolve({}),
    },
    command: {
      wait: impl.wait ?? (() => Promise.resolve({})),
      back: () => Promise.resolve({}),
      home: () => Promise.resolve({}),
    },
    capture: { snapshot: impl.snapshot ?? (() => Promise.resolve({ nodes: [] })) },
  } as unknown as Device;
}

const nodes = [{ role: "button", label: "Continue", visibleToUser: true }];
const fingerprint = observeScreenIdentity(nodes).fingerprint;

const screenshot: ScreenshotPayload = {
  capturedAt: 1,
  mime: "image/png",
  base64: Buffer.from("landing").toString("base64"),
  path: "/tmp/landing.png",
  bytes: 7,
  width: 100,
  height: 200,
};

function fakeJob(runDir: string): TestJob {
  return {
    id: "destination-survey-job",
    action: "expect-screen",
    platform: "android",
    serial: "survey-device",
    targetKind: "device",
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
    title: "Destination survey",
    runDir,
  } as unknown as TestJob;
}

function surveyResult(frames: number): ScrollSurveyResult {
  return {
    status: "completed",
    reason: "end-of-content",
    frames: Array.from({ length: frames }, (_, index) => ({
      index,
      offsetY: index * 80,
      appendedHeight: index === 0 ? 0 : 80,
      screenshot: {
        base64: Buffer.from(`destination-${index}`).toString("base64"),
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
    message: "end-of-content",
  };
}

function landingStep() {
  return {
    id: "relay-destination-settings",
    kind: "expect-screen" as const,
    screenId: "settings",
    screenTitle: "Settings",
    fingerprint,
    timeoutMs: 0,
    destinationSurvey: { maxScrolls: 4 },
  };
}

function recipeSnapshot(steps: Recipe["steps"]): Recipe {
  return {
    id: "destination-survey-recipe",
    title: "Destination survey",
    source: "custom",
    steps,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("runExpectScreenStep destination survey", () => {
  it("persists destination survey frames after a verified scrollable landing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-destination-survey-"));
    const job = fakeJob(directory);
    let surveyed = 0;
    try {
      await runWithTargetContext(
        { kind: "device", platform: "android", serial: "survey-device" },
        () =>
          runExpectScreenStep(
            stubDevice({ snapshot: () => Promise.resolve({ nodes }) }),
            {
              kind: "expect-screen",
              screenId: "settings",
              screenTitle: "Settings",
              fingerprint,
              timeoutMs: 0,
              destinationSurvey: { maxScrolls: 4 },
            },
            { log: () => {}, job, runtime: {} },
            {
              captureScreenshot: async () => screenshot,
              captureSurvey: async () => {
                surveyed += 1;
                return surveyResult(2);
              },
            },
          ),
      );
      assert.equal(surveyed, 1);
      assert.equal(job.frames.length, 2);
      assert.deepEqual(
        job.frames.map((frame) => frame.caption),
        ["destination:Settings · 1", "destination:Settings · 2"],
      );
      const tree = parseFrameTreeNodes(
        JSON.parse(await readFile(join(directory, "frames", "002.json"), "utf8")),
      );
      assert.equal(tree?.[0]?.identifier, "delete-account");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not survey a landing without destinationSurvey", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-destination-survey-"));
    const job = fakeJob(directory);
    let surveyed = 0;
    try {
      await runWithTargetContext(
        { kind: "device", platform: "android", serial: "survey-device" },
        () =>
          runExpectScreenStep(
            stubDevice({ snapshot: () => Promise.resolve({ nodes }) }),
            {
              kind: "expect-screen",
              screenId: "settings",
              screenTitle: "Settings",
              fingerprint,
              timeoutMs: 0,
            },
            { log: () => {}, job, runtime: {} },
            {
              captureScreenshot: async () => screenshot,
              captureSurvey: async () => {
                surveyed += 1;
                return surveyResult(1);
              },
            },
          ),
      );
      assert.equal(surveyed, 0);
      assert.equal(job.frames.length, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("warns and keeps the verified landing when the survey engine throws", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-destination-survey-"));
    const job = fakeJob(directory);
    const logs: string[] = [];
    try {
      await runWithTargetContext(
        { kind: "device", platform: "android", serial: "survey-device" },
        () =>
          runExpectScreenStep(
            stubDevice({ snapshot: () => Promise.resolve({ nodes }) }),
            {
              kind: "expect-screen",
              screenId: "settings",
              screenTitle: "Settings",
              fingerprint,
              timeoutMs: 0,
              destinationSurvey: { maxScrolls: 4 },
            },
            { log: (line) => logs.push(line), job, runtime: {} },
            {
              captureScreenshot: async () => screenshot,
              captureSurvey: async () => {
                throw new Error("scroll surface disappeared");
              },
            },
          ),
      );
      assert.equal(job.frames.length, 0);
      assert.match(
        logs.join("\n"),
        /warn: destination survey of Settings failed; the verified first viewport remains the evidence \(scroll surface disappeared\)/u,
      );
      assert.match(logs.join("\n"), /screen: reached Settings/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("skips restoring a terminal destination survey", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-destination-survey-"));
    const landing = landingStep();
    const job = fakeJob(directory);
    job.recipeSnapshot = recipeSnapshot([
      landing,
      { kind: "sleep", ms: 10 },
      { kind: "expect", target: { label: "Done" }, condition: "visible" },
    ]);
    let captured: ScrollSurveyTargetInput | undefined;
    try {
      await runWithTargetContext(
        { kind: "device", platform: "android", serial: "survey-device" },
        () =>
          runExpectScreenStep(
            stubDevice({ snapshot: () => Promise.resolve({ nodes }) }),
            landing,
            { log: () => {}, job, runtime: {} },
            {
              captureScreenshot: async () => screenshot,
              captureSurvey: async (input) => {
                captured = input;
                return surveyResult(1);
              },
            },
          ),
      );
      assert.equal(captured?.restore, false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("restores a destination survey when later input remains", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-destination-survey-"));
    const landing = landingStep();
    const job = fakeJob(directory);
    job.recipeSnapshot = recipeSnapshot([landing, { kind: "tap", target: { label: "More" } }]);
    let captured: ScrollSurveyTargetInput | undefined;
    try {
      await runWithTargetContext(
        { kind: "device", platform: "android", serial: "survey-device" },
        () =>
          runExpectScreenStep(
            stubDevice({ snapshot: () => Promise.resolve({ nodes }) }),
            landing,
            { log: () => {}, job, runtime: {} },
            {
              captureScreenshot: async () => screenshot,
              captureSurvey: async (input) => {
                captured = input;
                return surveyResult(1);
              },
            },
          ),
      );
      assert.equal(captured?.restore, undefined);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
