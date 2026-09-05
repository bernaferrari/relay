import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import {
  captureScrollableSurvey,
  captureScrollableSurveyForTarget,
  composeScrollSurveyFrames,
  scrollSurveyFastRestoreGesture,
  scrollSurveyGesture,
  scrollSurveyOutcomeUnknownDiagnostic,
  verticalScrollSeam,
  type ValidatedFrozenDocumentOrigin,
} from "./scrollable-survey.js";
import { semanticViewportIsStationary } from "./scrollable-survey-seams.js";
import { IosMutationOutcomeUnknownError } from "./ios-mutation-policy.js";
import { validatedFrozenOriginForTest } from "./scrollable-survey-test-support.js";
import type { SnapshotPayload } from "./workspace-capture.js";

async function temporarySurveyScreenshot(name: string) {
  const root = join(tmpdir(), "relay");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, `shot-survey-${name}-`));
  return { directory, path: join(directory, "capture.png") };
}

function unknownIosScroll(): IosMutationOutcomeUnknownError {
  return new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation: "scroll",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 1,
    },
    new Error("XCTest transport ended"),
  );
}

function image(offset: number): Buffer {
  const png = new PNG({ width: 64, height: 160 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (y * png.width + x) * 4;
      const value = (y + offset + x * 7) % 255;
      png.data[index] = value;
      png.data[index + 1] = (value * 3) % 255;
      png.data[index + 2] = (value * 5) % 255;
      png.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function flatImage(value: number): Buffer {
  const png = new PNG({ width: 64, height: 160 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = value;
    png.data[offset + 1] = Math.max(0, value - 12);
    png.data[offset + 2] = Math.min(255, value + 20);
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

test("finds a vertical overlap and detects an unchanged terminal viewport", () => {
  assert.equal(verticalScrollSeam(image(0), image(0))?.shiftY, 0);
  const seam = verticalScrollSeam(image(0), image(40));
  assert.ok(seam);
  assert.ok(Math.abs(seam!.shiftY - 40) <= 2);
});

test("identical pixels stop a survey even when the tree looks like it moved", () => {
  const png = image(0);
  const previous: SnapshotPayload = {
    capturedAt: 1,
    inspectable: true,
    source: "sdk",
    interactive: [],
    screenIdentity: { fingerprint: "same", nodes: [], volatileSignals: [] },
    bounds: { width: 64, height: 160 },
    nodes: [
      { label: "Row A", type: "TextView", rect: { x: 10, y: 200, width: 100, height: 40 } },
      { label: "Row B", type: "TextView", rect: { x: 10, y: 280, width: 100, height: 40 } },
      { label: "Row C", type: "TextView", rect: { x: 10, y: 360, width: 100, height: 40 } },
    ],
  };
  const current: SnapshotPayload = {
    ...previous,
    capturedAt: 2,
    nodes: [
      { label: "Row A", type: "TextView", rect: { x: 10, y: 140, width: 100, height: 40 } },
      { label: "Row B", type: "TextView", rect: { x: 10, y: 220, width: 100, height: 40 } },
      { label: "Row C", type: "TextView", rect: { x: 10, y: 300, width: 100, height: 40 } },
    ],
  };
  assert.equal(verticalScrollSeam(png, png, previous, current)?.shiftY, 0);
});

test("uses a reversible overlap-heavy Android survey drag without changing iOS", () => {
  const bounds = { width: 1080, height: 2340 };
  const androidDown = scrollSurveyGesture("android", bounds, "down");
  const androidUp = scrollSurveyGesture("android", bounds, "up");
  assert.equal(androidDown.durationMs, 480);
  const travel = androidDown.from.y - androidDown.to.y;
  assert.ok(travel >= bounds.height * 0.44);
  assert.ok(travel <= bounds.height * 0.48);
  assert.deepEqual(androidUp.from, androidDown.to);
  assert.deepEqual(androidUp.to, androidDown.from);
  assert.equal(androidUp.durationMs, androidDown.durationMs);

  const iosDown = scrollSurveyGesture("ios", bounds, "down");
  assert.equal(iosDown.from.y, bounds.height * 0.78);
  assert.equal(iosDown.to.y, bounds.height * 0.28);
  assert.equal(iosDown.durationMs, 360);

  const fastRestore = scrollSurveyFastRestoreGesture("android", bounds);
  assert.equal(fastRestore.durationMs, 180);
  assert.ok(fastRestore.from.y - fastRestore.to.y >= bounds.height * 0.7);
});

test("treats sticky-header shimmer as an unmoved viewport instead of an unknown seam", () => {
  const quiet = androidScrollableFrame(0, 1);
  const shimmer = androidScrollableFrame(0, 2);
  const png = PNG.sync.read(shimmer.bytes);
  for (let x = 0; x < png.width; x += 1) {
    const offset = (400 * png.width + x) * 4;
    png.data[offset] = Math.min(255, png.data[offset]! + 12);
  }
  const noisy = PNG.sync.write(png);
  const seam = verticalScrollSeam(quiet.bytes, noisy, quiet.snapshot, shimmer.snapshot);
  assert.equal(seam?.shiftY, 0);
});

function superGrokTerminalFrame(phase: number, capturedAt: number) {
  const width = 1080;
  const height = 2340;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      png.data[offset] = phase ? 92 : 18;
      png.data[offset + 1] = phase ? 38 : 24;
      png.data[offset + 2] = phase ? 116 : 31;
      png.data[offset + 3] = 255;
    }
  }
  const labels = [
    ["Super Grok", 283, 113],
    ["Your subscription includes:", 441, 60],
    ["World's smartest models", 602, 53],
    ["Smarter answers in Expert mode", 821, 53],
    ["Grok Imagine, with image & video", 983, 53],
    ["Fastest responses to complex questions", 1202, 110],
    ["Lightning-fast replies even during peak times", 1312, 110],
    ["Enhanced productivity", 1478, 53],
    ["Powerful Tasks, Projects, and intelligent file analysis", 1531, 110],
    ["Early access", 1697, 53],
    ["Be first to try every new feature", 1750, 53],
    ["Why is the universe so big?", 1966, 3],
    ["Close", 159, 68],
    ["Manage your billing", 2061, 53],
  ] as const;
  const snapshot: SnapshotPayload = {
    capturedAt,
    foregroundApp: "ai.x.grok",
    nodes: [
      {
        identifier: "android:id/content",
        type: "android.widget.FrameLayout",
        rect: { x: 0, y: 0, width, height },
        visibleToUser: true,
        index: 0,
      },
      {
        type: "android.widget.ScrollView",
        rect: { x: 45, y: 0, width: 990, height: 1969 },
        visibleToUser: true,
        index: 1,
        parentIndex: 0,
      },
      ...labels.map(([label, y, nodeHeight], index) => ({
        label,
        value: label,
        type: "android.widget.TextView",
        rect: { x: 90, y, width: 900, height: nodeHeight },
        visibleToUser: true,
        index: index + 2,
        parentIndex: 1,
      })),
    ],
    interactive: [],
    bounds: { width, height },
    inspectable: true,
    source: "sdk",
    screenIdentity: { fingerprint: "supergrok-terminal", nodes: [], volatileSignals: [] },
  };
  const bytes = PNG.sync.write(png);
  return {
    screenshot: { base64: bytes.toString("base64"), width, height, capturedAt },
    snapshot,
  };
}

function superGrokScrolledFrame(phase: number, capturedAt: number) {
  const frame = superGrokTerminalFrame(phase, capturedAt);
  const shifts = new Map([
    ["Fastest responses to complex questions", 1173],
    ["Lightning-fast replies even during peak times", 1173],
    ["Enhanced productivity", 1173],
    ["Powerful Tasks, Projects, and intelligent file analysis", 1173],
    ["Early access", 1173],
    ["Be first to try every new feature", 1173],
    ["Why is the universe so big?", 1150],
  ]);
  frame.snapshot = {
    ...frame.snapshot,
    screenIdentity: { fingerprint: "supergrok-bottom", nodes: [], volatileSignals: [] },
    nodes: frame.snapshot.nodes
      .filter(
        (node) =>
          ![
            "Super Grok",
            "Your subscription includes:",
            "World's smartest models",
            "Smarter answers in Expert mode",
            "Grok Imagine, with image & video",
          ].includes(node.label ?? ""),
      )
      .map((node) => {
        const shift = shifts.get(node.label ?? "");
        return shift && node.rect
          ? { ...node, rect: { ...node.rect, y: node.rect.y - shift } }
          : node;
      }),
  };
  return frame;
}

test("identical pixels beat a tree that looks like it scrolled", () => {
  const first = superGrokTerminalFrame(0, 1);
  const second = superGrokScrolledFrame(0, 2);
  assert.equal(first.screenshot.base64, second.screenshot.base64);
  const seam = verticalScrollSeam(
    Buffer.from(first.screenshot.base64, "base64"),
    Buffer.from(second.screenshot.base64, "base64"),
    first.snapshot,
    second.snapshot,
  );
  assert.equal(seam?.shiftY, 0);
});

test("keeps a dynamic one-viewport SuperGrok surface review-only when pixels cannot prove no movement", async () => {
  const frames = [superGrokTerminalFrame(0, 1), superGrokTerminalFrame(1, 2)];
  assert.equal(
    verticalScrollSeam(
      Buffer.from(frames[0]!.screenshot.base64, "base64"),
      Buffer.from(frames[1]!.screenshot.base64, "base64"),
      frames[0]!.snapshot,
      frames[1]!.snapshot,
    ),
    undefined,
    "dynamic pixels intentionally provide no trustworthy visual seam",
  );
  let captureIndex = 0;
  let inverseScrolls = 0;
  const survey = await captureScrollableSurvey({
    capture: async () => frames[Math.min(captureIndex++, frames.length - 1)]!,
    scrollDown: async () => {},
    scrollUp: async () => {
      inverseScrolls += 1;
    },
    settle: async () => {},
  });

  assert.equal(survey.status, "stopped");
  assert.equal(survey.reason, "seam-ambiguous");
  assert.equal(survey.frames.length, 1);
  assert.equal(
    survey.diagnosticFrames.length,
    2,
    "retain the rejected forward viewport and failed terminal proof for review",
  );
  assert.equal(survey.restoredStartViewport, false);
  assert.equal(inverseScrolls, 1);
  assert.equal(survey.stitched, undefined);
  assert.equal(survey.documentOriginProven, undefined);
});

test("keeps verified SuperGrok segments but does not certify a dynamic terminal viewport", async () => {
  let page = 0;
  let captureCount = 0;
  let inverseScrolls = 0;
  const survey = await captureScrollableSurvey({
    capture: async () =>
      page === 0
        ? superGrokTerminalFrame(captureCount++ % 2, captureCount)
        : superGrokScrolledFrame(captureCount++ % 2, captureCount),
    scrollDown: async () => {
      page = 1;
    },
    scrollUp: async () => {
      inverseScrolls += 1;
      page = 0;
    },
    settle: async () => {},
  });

  assert.equal(survey.status, "stopped");
  assert.equal(survey.reason, "seam-ambiguous");
  assert.equal(survey.frames.length, 2);
  assert.equal(survey.frames[1]?.offsetY, 1173);
  assert.equal(survey.frames[1]?.appendedHeight, 1173);
  assert.equal(survey.diagnosticFrames.length, 2);
  assert.equal(inverseScrolls, 2);
  assert.equal(survey.restoredStartViewport, false);
  assert.equal(survey.stitched, undefined);
  assert.equal(survey.documentOriginProven, undefined);
});

test("keeps an uncertain moved SuperGrok viewport stopped instead of calling it terminal", async () => {
  const frames = [superGrokTerminalFrame(0, 1), superGrokTerminalFrame(1, 2)];
  frames[1]!.snapshot = {
    ...frames[1]!.snapshot,
    nodes: frames[1]!.snapshot.nodes.map((node, index) => {
      if (!node.rect || !node.label || ["Close", "Manage your billing"].includes(node.label)) {
        return node;
      }
      const shift = 120 + (index % 3) * 170;
      return { ...node, rect: { ...node.rect, y: node.rect.y - shift } };
    }),
  };
  let captureIndex = 0;
  let inverseScrolls = 0;
  const survey = await captureScrollableSurvey({
    capture: async () => frames[Math.min(captureIndex++, frames.length - 1)]!,
    scrollDown: async () => {},
    scrollUp: async () => {
      inverseScrolls += 1;
    },
    settle: async () => {},
  });

  assert.equal(survey.status, "stopped");
  assert.equal(survey.reason, "seam-ambiguous");
  assert.equal(survey.frames.length, 1);
  assert.equal(
    survey.diagnosticFrames.length,
    2,
    "keep both the rejected forward viewport and failed final restoration proof",
  );
  assert.equal(survey.diagnosticFrames[0]?.appendedHeight, 0);
  assert.equal(survey.stitched, undefined);
  assert.equal(inverseScrolls, 1);
  assert.equal(survey.restoredStartViewport, false);
});

function androidScrollableFrame(shiftY: number, capturedAt: number) {
  const width = 1080;
  const height = 2340;
  const bodyTop = 280;
  const navigationTop = 2205;
  const png = new PNG({ width, height });
  const paint = (top: number, bottom: number, red: number, green: number, blue: number) => {
    for (let y = Math.max(0, top); y < Math.min(height, bottom); y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        png.data[offset] = red;
        png.data[offset + 1] = green;
        png.data[offset + 2] = blue;
        png.data[offset + 3] = 255;
      }
    }
  };
  paint(0, height, 23, 23, 23);
  paint(0, 95, 35, 35, 35); // fixed status bar
  paint(95, bodyTop, 45, 45, 45); // sticky product header
  const nodes: SnapshotPayload["nodes"] = [
    {
      identifier: "app-root",
      type: "Application",
      rect: { x: 0, y: 0, width, height },
      index: 0,
    },
    {
      identifier: "data-list",
      type: "ScrollView",
      rect: { x: 0, y: bodyTop, width, height: navigationTop - bodyTop },
      index: 1,
      parentIndex: 0,
    },
    {
      label: "Data Controls",
      type: "Toolbar",
      rect: { x: 40, y: 150, width: 500, height: 60 },
      index: 2,
      parentIndex: 0,
    },
  ];
  for (let index = 0; index < 12; index += 1) {
    const documentY = 330 + index * 190;
    const viewportY = documentY - shiftY;
    if (viewportY + 70 <= bodyTop || viewportY >= navigationTop) continue;
    paint(viewportY, viewportY + 70, 70 + index * 8, 90 + index * 5, 110 + index * 3);
    nodes.push({
      label: `Product row ${index}`,
      type: "TextView",
      rect: { x: 45, y: viewportY, width: 760, height: 70 },
      index: index + 3,
      parentIndex: 1,
    });
  }
  paint(navigationTop, height, 8, 8, 8);
  nodes.push(
    {
      label: "Back",
      type: "ImageView",
      rect: { x: 100, y: navigationTop, width: 150, height: 135 },
      index: 20,
      parentIndex: 0,
    },
    {
      label: "Home",
      type: "ImageView",
      rect: { x: 465, y: navigationTop, width: 150, height: 135 },
      index: 21,
      parentIndex: 0,
    },
    {
      label: "Recents",
      type: "ImageView",
      rect: { x: 820, y: navigationTop, width: 150, height: 135 },
      index: 22,
      parentIndex: 0,
    },
  );
  const bytes = PNG.sync.write(png);
  const snapshot: SnapshotPayload = {
    capturedAt,
    foregroundApp: "ai.x.GrokApp",
    nodes,
    interactive: [],
    bounds: { width, height },
    inspectable: true,
    source: "sdk",
    screenIdentity: { fingerprint: "data-controls", nodes: [], volatileSignals: [] },
  };
  return {
    bytes,
    snapshot,
    frame: {
      index: capturedAt,
      offsetY: capturedAt ? 1697 : 0,
      appendedHeight: capturedAt ? 1697 : 0,
      screenshot: { base64: bytes.toString("base64"), width, height, capturedAt },
      snapshot,
    },
  };
}

test("does not fling a one-viewport sheet whose last feature is already on screen", async () => {
  const initial = androidScrollableFrame(0, 1);
  initial.snapshot.nodes = initial.snapshot.nodes.map((node) =>
    node.type === "ScrollView"
      ? { ...node, rect: { x: 0, y: 280, width: 1080, height: 1925 } }
      : node.label?.startsWith("Product row")
        ? {
            ...node,
            rect: node.rect
              ? { ...node.rect, y: Math.min(node.rect.y, 1700), height: 60 }
              : node.rect,
          }
        : node,
  );
  // Keep only rows that sit well above the fold and drop the hidden-below hint.
  initial.snapshot.nodes = initial.snapshot.nodes.filter((node) => {
    if (node.label?.startsWith("Product row") && node.rect && node.rect.y > 1800) return false;
    return true;
  });
  let downs = 0;
  const survey = await captureScrollableSurvey(
    {
      capture: async () => ({
        screenshot: initial.frame.screenshot,
        snapshot: initial.snapshot,
      }),
      scrollDown: async () => {
        downs += 1;
      },
      scrollUp: async () => {},
      settle: async () => {},
    },
    { maxScrolls: 3, initialCapture: { screenshot: initial.frame.screenshot, snapshot: initial.snapshot } },
  );
  assert.equal(downs, 0);
  assert.equal(survey.frames.length, 1);
  assert.equal(survey.reason, "end-of-content");
});

test("uses a verified initial PNG/tree pair without recapturing the first viewport", async () => {
  const initial = androidScrollableFrame(0, 1);
  let captures = 0;
  const survey = await captureScrollableSurvey(
    {
      capture: () => {
        captures += 1;
        return Promise.resolve({
          screenshot: initial.frame.screenshot,
          snapshot: initial.snapshot,
        });
      },
      scrollDown: () => Promise.resolve(),
      scrollUp: () => Promise.resolve(),
      settle: () => Promise.resolve(),
    },
    {
      maxScrolls: 1,
      initialCapture: { screenshot: initial.frame.screenshot, snapshot: initial.snapshot },
    },
  );

  assert.equal(captures, 1);
  assert.equal(survey.frames[0]?.screenshot.capturedAt, 1);
  assert.equal(survey.reason, "end-of-content");
});

test("target-backed survey disposes every temporary viewport after copying its evidence", async () => {
  const temporaryDirectories: string[] = [];
  const surface = productSurfaceCapture("Settings", 0, 1);
  try {
    const survey = await captureScrollableSurveyForTarget(
      { serial: "android-survey-cleanup", maxScrolls: 1 },
      {
        devicePlatformForSerial: async () => "android",
        captureScreenshot: async () => {
          const temporary = await temporarySurveyScreenshot(
            `success-${temporaryDirectories.length}`,
          );
          temporaryDirectories.push(temporary.directory);
          const bytes = Buffer.from(surface.screenshot.base64, "base64");
          return {
            serial: "android-survey-cleanup",
            capturedAt: surface.screenshot.capturedAt,
            mime: "image/png" as const,
            base64: surface.screenshot.base64,
            path: temporary.path,
            bytes: bytes.byteLength,
            width: surface.screenshot.width,
            height: surface.screenshot.height,
          };
        },
        captureSnapshot: async () => surface.snapshot,
        interact: async () => ({}),
      },
    );

    assert.equal(survey.reason, "end-of-content");
    assert.equal(temporaryDirectories.length, 2);
    for (const directory of temporaryDirectories) assert.equal(existsSync(directory), false);
    assert.equal(survey.frames[0]?.screenshot.base64, surface.screenshot.base64);
  } finally {
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  }
});

test("target-backed survey disposes a temporary screenshot when AX capture fails", async () => {
  const temporary = await temporarySurveyScreenshot("failed-ax");
  const surface = productSurfaceCapture("Settings", 0, 1);
  try {
    await assert.rejects(
      captureScrollableSurveyForTarget(
        { serial: "android-survey-cleanup-failure" },
        {
          devicePlatformForSerial: async () => "android",
          captureScreenshot: async () => ({
            serial: "android-survey-cleanup-failure",
            capturedAt: surface.screenshot.capturedAt,
            mime: "image/png" as const,
            base64: surface.screenshot.base64,
            path: temporary.path,
            bytes: Buffer.from(surface.screenshot.base64, "base64").byteLength,
            width: surface.screenshot.width,
            height: surface.screenshot.height,
          }),
          captureSnapshot: async () => {
            throw new Error("AX capture failed");
          },
          interact: async () => ({}),
        },
      ),
      /AX capture failed/u,
    );
    assert.equal(existsSync(temporary.directory), false);
  } finally {
    await rm(temporary.directory, { recursive: true, force: true });
  }
});

test("composes Android chrome once using the corroborated semantic body translation", () => {
  const first = androidScrollableFrame(0, 0);
  const second = androidScrollableFrame(152, 1);
  assert.equal(
    verticalScrollSeam(first.bytes, second.bytes, first.snapshot, second.snapshot)?.shiftY,
    152,
  );
  const composition = composeScrollSurveyFrames([first.frame, second.frame]);
  assert.ok(composition?.stitched);
  assert.equal(composition!.frames[1]?.offsetY, 152);
  assert.equal(composition!.frames[1]?.appendedHeight, 152);
  assert.equal(composition!.stitched?.height, 2492);
  const stitched = PNG.sync.read(Buffer.from(composition!.stitched!.base64, "base64"));
  const centerRed = (y: number) => stitched.data[(y * stitched.width + 540) * 4];
  assert.notEqual(centerRed(2205), 8, "navigation chrome must not remain at the seam");
  assert.equal(centerRed(stitched.height - 1), 8, "navigation chrome belongs at the final edge");
  assert.equal(
    Array.from({ length: stitched.height }, (_, y) => centerRed(y)).filter((red) => red === 8)
      .length,
    135,
  );
  assert.equal(
    composition!.mergedNodes.filter((node) => node.label === "Data Controls").length,
    1,
    "sticky product chrome must appear once",
  );
});

function snapshot(anchor = "toolbar", capturedAt = 0): SnapshotPayload {
  return {
    capturedAt,
    nodes: [{ identifier: anchor, type: "Button", rect: { x: 0, y: 0, width: 20, height: 20 } }],
    interactive: [],
    bounds: { width: 64, height: 160 },
    inspectable: true,
    source: "sdk",
    screenIdentity: { fingerprint: `screen-${anchor}`, nodes: [], volatileSignals: [] },
  };
}

function captured(png: Buffer, capturedAt: number, anchor = "toolbar") {
  return {
    screenshot: {
      base64: png.toString("base64"),
      width: 64,
      height: 160,
      capturedAt,
    },
    snapshot: snapshot(anchor, capturedAt),
  };
}

/**
 * Three named sticky controls live inside the scroll hierarchy while the
 * actual row has no durable semantic key. This is the dangerous case for a
 * semantic-only stationary matcher: it can see broad, unchanged support even
 * though the document content moved beneath those controls.
 */
function stickyDescendantCapture(page: 0 | 1, capturedAt: number) {
  const nodes: SnapshotPayload["nodes"] = [
    {
      identifier: "grok-root",
      type: "Application",
      rect: { x: 0, y: 0, width: 64, height: 160 },
      visibleToUser: true,
      index: 0,
    },
    {
      identifier: "voice-scroll",
      type: "android.widget.ScrollView",
      rect: { x: 0, y: 0, width: 64, height: 160 },
      visibleToUser: true,
      index: 1,
      parentIndex: 0,
    },
    ...(
      [
        ["Filter", 24],
        ["Sort", 80],
        ["Display", 136],
      ] as const
    ).map(([label, y], index) => ({
      label,
      type: "Button",
      rect: { x: 4, y, width: 56, height: 12 },
      visibleToUser: true,
      index: index + 2,
      parentIndex: 1,
    })),
    {
      type: "TextView",
      rect: { x: 4, y: page === 0 ? 120 : 32, width: 56, height: 18 },
      visibleToUser: true,
      index: 5,
      parentIndex: 1,
    },
  ];
  return {
    screenshot: {
      base64: flatImage(page === 0 ? 24 : 188).toString("base64"),
      width: 64,
      height: 160,
      capturedAt,
    },
    snapshot: {
      capturedAt,
      foregroundApp: "ai.x.GrokApp",
      nodes,
      interactive: [],
      bounds: { width: 64, height: 160 },
      inspectable: true,
      source: "sdk" as const,
      screenIdentity: { fingerprint: "voice-sticky-controls", nodes: [], volatileSignals: [] },
    },
  };
}

/** A deterministic product-shaped surface rather than a generic scroll
 * fixture. It models the long Voice Library and Settings lists without
 * touching a saved App Map or a physical device. */
function productSurfaceCapture(
  title: "Voice Library" | "Settings",
  page: number,
  capturedAt = page,
) {
  const identifier = title === "Voice Library" ? "voice-library" : "settings";
  const offset = page * 40;
  const nodes = [
    {
      identifier: "grok-root",
      type: "Application",
      rect: { x: 0, y: 0, width: 64, height: 160 },
      visibleToUser: true,
      index: 0,
    },
    {
      identifier: `${identifier}-list`,
      type: "ScrollView",
      rect: { x: 0, y: 20, width: 64, height: 140 },
      visibleToUser: true,
      index: 1,
      parentIndex: 0,
    },
    {
      identifier: `${identifier}-title`,
      label: title,
      type: "Toolbar",
      rect: { x: 0, y: 0, width: 64, height: 20 },
      visibleToUser: true,
      index: 2,
      parentIndex: 0,
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      label:
        title === "Voice Library"
          ? `Voice ${index + page}`
          : ["Account", "Privacy", "Haptics", "Advanced"][index % 4],
      type: "TextView",
      rect: { x: 4, y: 28 + index * 14 - offset, width: 56, height: 10 },
      visibleToUser: true,
      index: index + 3,
      parentIndex: 1,
    })),
  ];
  return {
    screenshot: {
      base64: image(offset).toString("base64"),
      width: 64,
      height: 160,
      capturedAt,
    },
    snapshot: {
      capturedAt,
      foregroundApp: "ai.x.GrokApp",
      nodes,
      interactive: [],
      bounds: { width: 64, height: 160 },
      inspectable: true,
      source: "sdk" as const,
      screenIdentity: { fingerprint: identifier, nodes: [], volatileSignals: [] },
    },
  };
}

test("restores actual movement without inverting a confirmed terminal no-op", async () => {
  const startingPage = 2;
  const terminalPage = 3;
  let page = startingPage;
  let successfulDown = 0;
  let actualDownMovements = 0;
  let up = 0;
  const result = await captureScrollableSurvey({
    capture: async () => captured(image((page - startingPage) * 40), successfulDown),
    scrollDown: async () => {
      successfulDown += 1;
      const nextPage = Math.min(page + 1, terminalPage);
      if (nextPage !== page) actualDownMovements += 1;
      page = nextPage;
    },
    scrollUp: async () => {
      up += 1;
      page -= 1;
    },
    settle: async () => {},
  });
  assert.equal(result.status, "completed");
  assert.equal(result.reason, "end-of-content");
  assert.equal(result.frames.length, 2);
  assert.equal(successfulDown, 2);
  assert.equal(actualDownMovements, 1);
  assert.equal(up, actualDownMovements);
  assert.equal(page, startingPage);
  assert.equal(result.restoredStartViewport, true);
  assert.ok(result.stitched);
});

test("restores after a screen change on the first captured movement", async () => {
  let captureIndex = 0;
  let successfulDown = 0;
  let up = 0;
  let fastUp = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () =>
        captureIndex++ === 0 ? captured(image(0), 0) : captured(image(40), 1, "other-screen"),
      scrollDown: async () => {
        successfulDown += 1;
      },
      scrollUp: async () => {
        up += 1;
      },
      scrollUpFast: async () => {
        fastUp += 1;
      },
      settle: async () => {},
    },
    { frozenDocumentOrigin: validatedFrozenOriginForTest(captured(image(0), 0)) },
  );
  assert.equal(result.reason, "screen-changed");
  assert.equal(up, successfulDown);
  assert.equal(fastUp, 0, "an unproved screen change must never receive an origin fling");
  assert.equal(result.restoredStartViewport, false);
  assert.equal(result.documentOriginProven, undefined);
});

test("keeps a scrollable surface when its identifier-less header shifts but semantics overlap", async () => {
  const shared = Array.from({ length: 33 }, (_, index) => ({
    label: `Control ${index}`,
    type: "Button",
    rect: { x: 0, y: 28 + index * 3, width: 20, height: 3 },
    visibleToUser: true,
  }));
  const surfaceSnapshot = (page: number): SnapshotPayload => ({
    ...snapshot(page === 0 ? "header-top" : "header-bottom", page),
    foregroundApp: "ai.x.GrokApp",
    nodes: [
      {
        identifier: "app-root",
        type: "Application",
        depth: 0,
        rect: { x: 0, y: 0, width: 64, height: 160 },
        visibleToUser: true,
      },
      {
        identifier: page === 0 ? "compose-header-top" : "compose-header-bottom",
        type: "NavigationBar",
        rect: { x: 0, y: 0, width: 64, height: 24 },
        visibleToUser: true,
      },
      ...shared,
      ...Array.from({ length: page === 0 ? 22 : 21 }, (_, index) => ({
        label: `Page ${page} item ${index}`,
        type: "StaticText",
        rect: { x: 20, y: 30 + index * 4, width: 30, height: 3 },
        visibleToUser: true,
      })),
    ],
  });
  let page = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => ({
        ...captured(image(page * 40), page),
        snapshot: surfaceSnapshot(page),
      }),
      scrollDown: async () => {
        page += 1;
      },
      scrollUp: async () => {
        page -= 1;
      },
      settle: async () => {},
    },
    { maxScrolls: 1 },
  );
  assert.equal(result.reason, "limit-reached");
  assert.equal(result.frames.length, 2);
  assert.ok(result.stitched);
});

test("rejects another screen in the same app when only generic chrome overlaps", async () => {
  const surfaceSnapshot = (page: number): SnapshotPayload => ({
    ...snapshot(`header-${page}`, page),
    foregroundApp: "ai.x.GrokApp",
    nodes: [
      {
        identifier: "app-root",
        type: "Application",
        depth: 0,
        rect: { x: 0, y: 0, width: 64, height: 160 },
        visibleToUser: true,
      },
      {
        identifier: page === 0 ? "compose-header" : "account-header",
        type: "NavigationBar",
        rect: { x: 0, y: 0, width: 64, height: 24 },
        visibleToUser: true,
      },
      { label: "Close", type: "Button", visibleToUser: true },
      ...Array.from({ length: 12 }, (_, index) => ({
        label: `${page === 0 ? "Compose" : "Account"} ${index}`,
        type: "StaticText",
        visibleToUser: true,
      })),
    ],
  });
  let page = 0;
  const result = await captureScrollableSurvey({
    capture: async () => ({
      ...captured(image(page * 40), page),
      snapshot: surfaceSnapshot(page),
    }),
    scrollDown: async () => {
      page = 1;
    },
    scrollUp: async () => {
      page = 0;
    },
    settle: async () => {},
  });
  assert.equal(result.reason, "screen-changed");
  assert.equal(result.frames.length, 1);
});

test("restores all movements after a later screen change", async () => {
  const pages = [captured(image(0), 0), captured(image(40), 1), captured(image(80), 2, "other")];
  let page = 0;
  let successfulDown = 0;
  let up = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => pages[page]!,
      scrollDown: async () => {
        successfulDown += 1;
        page += 1;
      },
      scrollUp: async () => {
        up += 1;
        page = Math.max(0, page - 1);
      },
      settle: async () => {},
    },
    { maxScrolls: 3 },
  );
  assert.equal(result.reason, "screen-changed");
  assert.equal(result.frames.length, 2);
  assert.equal(up, successfulDown);
  assert.equal(result.restoredStartViewport, true);
});

test("restores after an ambiguous seam", async () => {
  let captureIndex = 0;
  let successfulDown = 0;
  let up = 0;
  let fastUp = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () =>
        captureIndex++ === 0
          ? captured(image(0), 0)
          : {
              ...captured(image(40), 1),
              screenshot: {
                base64: Buffer.from("not-png").toString("base64"),
                width: 64,
                height: 160,
                capturedAt: 1,
              },
            },
      scrollDown: async () => {
        successfulDown += 1;
      },
      scrollUp: async () => {
        up += 1;
      },
      scrollUpFast: async () => {
        fastUp += 1;
      },
      settle: async () => {},
    },
    { frozenDocumentOrigin: validatedFrozenOriginForTest(captured(image(0), 0)) },
  );
  assert.equal(result.reason, "seam-ambiguous");
  assert.equal(up, successfulDown);
  assert.equal(fastUp, 0);
  assert.equal(result.restoredStartViewport, false);
  assert.equal(result.documentOriginProven, undefined);
});

test("does not let sticky descendant controls certify a moved Voice Library viewport", async () => {
  const first = stickyDescendantCapture(0, 0);
  const moved = stickyDescendantCapture(1, 1);
  assert.equal(
    semanticViewportIsStationary(first.snapshot, moved.snapshot),
    true,
    "the review-only semantic hint sees the three fixed controls, not the unlabeled moving row",
  );
  assert.equal(
    verticalScrollSeam(
      Buffer.from(first.screenshot.base64, "base64"),
      Buffer.from(moved.screenshot.base64, "base64"),
      first.snapshot,
      moved.snapshot,
    ),
    undefined,
    "the dynamically redrawn pixels provide no physical overlap proof",
  );
  let page: 0 | 1 = 0;
  let exactUp = 0;
  let fastUp = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => stickyDescendantCapture(page, page + exactUp + fastUp),
      scrollDown: async () => {
        page = 1;
      },
      scrollUp: async () => {
        exactUp += 1;
        page = 0;
      },
      scrollUpFast: async () => {
        fastUp += 1;
        page = 0;
      },
      settle: async () => {},
    },
    {
      maxScrolls: 1,
      frozenDocumentOrigin: validatedFrozenOriginForTest(first),
    },
  );

  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "seam-ambiguous");
  assert.equal(result.frames.length, 1);
  assert.equal(result.diagnosticFrames.length, 1);
  assert.equal(exactUp, 1);
  assert.equal(fastUp, 0, "an ambiguous forward movement never receives an Android fling");
  assert.equal(result.restoredStartViewport, true);
  assert.equal(result.documentOriginProven, undefined);
});

test("restores after capture failure", async () => {
  let captures = 0;
  let successfulDown = 0;
  let up = 0;
  const result = await captureScrollableSurvey({
    capture: async () => {
      if (captures++ > 0) throw new Error("capture failed");
      return captured(image(0), 0);
    },
    scrollDown: async () => {
      successfulDown += 1;
    },
    scrollUp: async () => {
      up += 1;
    },
    settle: async () => {},
  });
  assert.equal(result.reason, "scroll-failed");
  assert.equal(up, successfulDown);
  assert.equal(result.restoredStartViewport, false);
});

test("restores after post-scroll settling fails", async () => {
  let settleCalls = 0;
  let successfulDown = 0;
  let up = 0;
  const result = await captureScrollableSurvey({
    capture: async () => captured(image(0), 0),
    scrollDown: async () => {
      successfulDown += 1;
    },
    scrollUp: async () => {
      up += 1;
    },
    settle: async () => {
      if (settleCalls++ === 0) throw new Error("settle failed");
    },
  });
  assert.equal(result.reason, "scroll-failed");
  assert.equal(up, successfulDown);
  assert.equal(result.restoredStartViewport, true);
});

test("does not restore a scrollDown call that never succeeded", async () => {
  let up = 0;
  const result = await captureScrollableSurvey({
    capture: async () => captured(image(0), 0),
    scrollDown: async () => {
      throw new Error("scroll failed");
    },
    scrollUp: async () => {
      up += 1;
    },
    settle: async () => {},
  });
  assert.equal(result.reason, "scroll-failed");
  assert.equal(up, 0);
  assert.equal(result.restoredStartViewport, true);
});

test("stops an unknown iOS scroll without an inverse movement and retains the proven frame", async () => {
  const movements: string[] = [];
  let failure: unknown;

  await assert.rejects(
    captureScrollableSurvey({
      capture: async () => captured(image(0), 1),
      scrollDown: async () => {
        movements.push("down");
        throw unknownIosScroll();
      },
      scrollUp: async () => {
        movements.push("up");
      },
      settle: async () => {},
    }),
    (error: unknown) => {
      failure = error;
      return error instanceof IosMutationOutcomeUnknownError;
    },
  );

  assert.deepEqual(movements, ["down"]);
  const diagnostic = scrollSurveyOutcomeUnknownDiagnostic(failure);
  assert.equal(diagnostic?.status, "interrupted");
  assert.equal(diagnostic?.restoration.attempted, false);
  assert.equal(diagnostic?.frames.length, 1);
  assert.equal(diagnostic?.frames[0]?.screenshot.capturedAt, 1);
});

test("stops an unknown guarded origin restore without trying another restoration movement", async () => {
  let page = 0;
  const movements: string[] = [];
  let failure: unknown;

  await assert.rejects(
    captureScrollableSurvey(
      {
        capture: async () => captured(image(page * 40), page),
        scrollDown: async () => {
          movements.push("down");
          page = 1;
        },
        scrollUp: async () => {
          movements.push("up");
        },
        scrollUpFast: async () => {
          movements.push("fast-up");
          throw unknownIosScroll();
        },
        settle: async () => {},
      },
      {
        maxScrolls: 1,
        frozenDocumentOrigin: validatedFrozenOriginForTest(captured(image(0), 0)),
      },
    ),
    (error: unknown) => {
      failure = error;
      return error instanceof IosMutationOutcomeUnknownError;
    },
  );

  assert.deepEqual(movements, ["down", "fast-up"]);
  const diagnostic = scrollSurveyOutcomeUnknownDiagnostic(failure);
  assert.equal(diagnostic?.frames.length, 2);
  assert.equal(diagnostic?.restoration.attempted, false);
});

test("stops an unknown iOS inverse scroll without dispatching the next restoration command", async () => {
  let page = 0;
  const movements: string[] = [];
  let failure: unknown;

  await assert.rejects(
    captureScrollableSurvey(
      {
        capture: async () => captured(image(page * 40), page),
        scrollDown: async () => {
          movements.push("down");
          page += 1;
        },
        scrollUp: async () => {
          movements.push("up");
          throw unknownIosScroll();
        },
        settle: async () => {},
      },
      { maxScrolls: 2 },
    ),
    (error: unknown) => {
      failure = error;
      return error instanceof IosMutationOutcomeUnknownError;
    },
  );

  assert.deepEqual(movements, ["down", "down", "up"]);
  const diagnostic = scrollSurveyOutcomeUnknownDiagnostic(failure);
  assert.equal(diagnostic?.frames.length, 3);
  assert.equal(diagnostic?.restoration.attempted, false);
});

test("reports restore failure while still attempting one up per successful down", async () => {
  let page = 0;
  let successfulDown = 0;
  let upAttempts = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => captured(page === 0 ? image(0) : image(40), page),
      scrollDown: async () => {
        successfulDown += 1;
        page = 1;
      },
      scrollUp: async () => {
        upAttempts += 1;
        throw new Error("restore failed");
      },
      settle: async () => {},
    },
    { maxScrolls: 1 },
  );
  assert.equal(result.reason, "restore-failed");
  assert.equal(result.restoredStartViewport, false);
  assert.equal(upAttempts, successfulDown);
});

test("marks restoration incomplete when its settling step fails", async () => {
  let page = 0;
  let settleCalls = 0;
  let successfulDown = 0;
  let up = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => captured(page === 0 ? image(0) : image(40), page),
      scrollDown: async () => {
        successfulDown += 1;
        page = 1;
      },
      scrollUp: async () => {
        up += 1;
      },
      settle: async () => {
        settleCalls += 1;
        if (settleCalls === 2) throw new Error("restore did not settle");
      },
    },
    { maxScrolls: 1 },
  );
  assert.equal(result.reason, "restore-failed");
  assert.equal(result.restoredStartViewport, false);
  assert.equal(up, successfulDown);
});

test("restores every movement when the configured limit is reached", async () => {
  const pages = [image(0), image(40), image(80)];
  let page = 0;
  let successfulDown = 0;
  let up = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => captured(pages[page]!, page),
      scrollDown: async () => {
        successfulDown += 1;
        page += 1;
      },
      scrollUp: async () => {
        up += 1;
        page = Math.max(0, page - 1);
      },
      settle: async () => {},
    },
    { maxScrolls: 2 },
  );
  assert.equal(result.reason, "limit-reached");
  assert.equal(result.frames.length, 3);
  assert.equal(up, successfulDown);
  assert.equal(result.restoredStartViewport, true);
});

test("uses bounded Android restoration only after a frozen Voice Library origin is proven", async () => {
  let page = 0;
  let exactUp = 0;
  let fastUp = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => productSurfaceCapture("Voice Library", page),
      scrollDown: async () => {
        page = Math.min(3, page + 1);
      },
      scrollUp: async () => {
        exactUp += 1;
        page = Math.max(0, page - 1);
      },
      scrollUpFast: async () => {
        fastUp += 1;
        page = Math.max(0, page - 2);
      },
      settle: async () => {},
    },
    {
      maxScrolls: 3,
      frozenDocumentOrigin: validatedFrozenOriginForTest(productSurfaceCapture("Voice Library", 0)),
    },
  );

  assert.equal(result.reason, "limit-reached");
  assert.equal(result.restoredStartViewport, true);
  assert.equal(page, 0);
  assert.equal(fastUp, 2);
  assert.equal(exactUp, 0);
});

test("rejects a type-asserted frozen origin at the runtime capability boundary", async () => {
  let page = 0;
  let exactUp = 0;
  let fastUp = 0;
  const forged = productSurfaceCapture("Settings", 0) as unknown as ValidatedFrozenDocumentOrigin;
  const result = await captureScrollableSurvey(
    {
      capture: async () => productSurfaceCapture("Settings", page),
      scrollDown: async () => {
        page = 1;
      },
      scrollUp: async () => {
        exactUp += 1;
        page = 0;
      },
      scrollUpFast: async () => {
        fastUp += 1;
        page = 0;
      },
      settle: async () => {},
    },
    { maxScrolls: 1, frozenDocumentOrigin: forged },
  );
  assert.equal(result.reason, "limit-reached");
  assert.equal(result.restoredStartViewport, true);
  assert.equal(exactUp, 1);
  assert.equal(fastUp, 0);
  assert.equal(result.documentOriginProven, undefined);
});

test("keeps a minted Settings origin immutable after the evidence loader issues it", async () => {
  const origin = validatedFrozenOriginForTest(productSurfaceCapture("Settings", 0));
  const mutable = origin as unknown as {
    screenshot: { base64: string };
    snapshot: { nodes: Array<{ identifier?: string }> };
  };
  assert.throws(() => {
    mutable.screenshot.base64 = productSurfaceCapture("Settings", 1).screenshot.base64;
  }, TypeError);
  assert.throws(() => {
    mutable.snapshot.nodes[0]!.identifier = "forged-root";
  }, TypeError);

  let page = 0;
  let fastUp = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => productSurfaceCapture("Settings", page),
      scrollDown: async () => {
        page = 1;
      },
      scrollUp: async () => {
        page = 0;
      },
      scrollUpFast: async () => {
        fastUp += 1;
        page = 0;
      },
      settle: async () => {},
    },
    { maxScrolls: 1, frozenDocumentOrigin: origin },
  );

  assert.equal(result.reason, "limit-reached");
  assert.equal(result.restoredStartViewport, true);
  assert.equal(fastUp, 1, "the immutable original, not the attempted mutation, authorizes it");
});

test("refreshes a frozen Voice Library origin instead of trusting a stale checkpoint", async () => {
  let page = 1;
  let freshCaptures = 0;
  let exactUp = 0;
  let fastUp = 0;
  const staleCheckpoint = productSurfaceCapture("Voice Library", 0, 9);
  const result = await captureScrollableSurvey(
    {
      capture: async () => {
        freshCaptures += 1;
        return productSurfaceCapture("Voice Library", page, 100 + freshCaptures);
      },
      scrollDown: async () => {
        page = Math.min(2, page + 1);
      },
      scrollUp: async () => {
        exactUp += 1;
        page = Math.max(1, page - 1);
      },
      scrollUpFast: async () => {
        fastUp += 1;
        page = 0;
      },
      settle: async () => {},
    },
    {
      maxScrolls: 1,
      initialCapture: staleCheckpoint,
      frozenDocumentOrigin: validatedFrozenOriginForTest(productSurfaceCapture("Voice Library", 0)),
    },
  );

  assert.equal(result.frames[0]?.screenshot.capturedAt, 101);
  assert.ok(freshCaptures >= 3, "fresh first, scrolled, and terminal proof captures are required");
  assert.equal(fastUp, 0);
  assert.equal(exactUp, 1);
  assert.equal(page, 1);
  assert.equal(result.documentOriginProven, undefined);
  assert.match(result.message, /exact inverse restoration/u);
});

test("keeps a mid-page Settings capture exact-inverse and review-only", async () => {
  let page = 1;
  let down = 0;
  let exactUp = 0;
  let fastUp = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => productSurfaceCapture("Settings", page),
      scrollDown: async () => {
        down += 1;
        page = Math.min(2, page + 1);
      },
      scrollUp: async () => {
        exactUp += 1;
        page = Math.max(1, page - 1);
      },
      scrollUpFast: async () => {
        fastUp += 1;
        page = 0;
      },
      settle: async () => {},
    },
    {
      maxScrolls: 2,
      frozenDocumentOrigin: validatedFrozenOriginForTest(productSurfaceCapture("Settings", 0)),
    },
  );

  assert.equal(result.reason, "start-viewport-unproven");
  assert.equal(result.frames.length, 2);
  assert.equal(result.restoredStartViewport, true);
  assert.equal(down, 2);
  assert.equal(exactUp, 1);
  assert.equal(fastUp, 0);
  assert.equal(page, 1);
  assert.equal(result.documentOriginProven, undefined);
  assert.match(result.message, /exact inverse restoration/u);
});

test("uses exact inverse restoration when a proven Settings origin has no Android fast capability", async () => {
  let page = 0;
  let exactUp = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => productSurfaceCapture("Settings", page),
      scrollDown: async () => {
        page = Math.min(1, page + 1);
      },
      scrollUp: async () => {
        exactUp += 1;
        page = 0;
      },
      settle: async () => {},
    },
    {
      maxScrolls: 2,
      frozenDocumentOrigin: validatedFrozenOriginForTest(productSurfaceCapture("Settings", 0)),
    },
  );

  assert.equal(result.reason, "end-of-content");
  assert.equal(result.restoredStartViewport, true);
  assert.equal(page, 0);
  assert.equal(exactUp, 1);
  assert.equal(result.documentOriginProven, true);
});

test("retains rejected Voice Library restoration frames and never hides a blind fallback", async () => {
  let page = 0;
  let exactUp = 0;
  let fastUp = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => productSurfaceCapture("Voice Library", page),
      scrollDown: async () => {
        page = Math.min(3, page + 1);
      },
      scrollUp: async () => {
        exactUp += 1;
        page = Math.max(0, page - 1);
      },
      scrollUpFast: async () => {
        fastUp += 1;
        // The transport settled but never changed the viewport. Relay may
        // report the failure, but it must not secretly send exact inverse
        // gestures afterwards because their outcome would be ambiguous.
      },
      settle: async () => {},
    },
    {
      maxScrolls: 3,
      frozenDocumentOrigin: validatedFrozenOriginForTest(productSurfaceCapture("Voice Library", 0)),
    },
  );

  assert.equal(result.reason, "restore-failed");
  assert.equal(result.restoredStartViewport, false);
  assert.equal(fastUp, 3);
  assert.equal(exactUp, 0);
  assert.equal(result.diagnosticFrames.length, 3);
  assert.ok(
    result.diagnosticFrames.every((frame) => frame.snapshot.foregroundApp === "ai.x.GrokApp"),
  );
  assert.match(result.message, /rejected restoration viewports were retained/u);
});

test("never fast-restores after a forward gesture throws with an unknown movement", async () => {
  let page = 0;
  let down = 0;
  let exactUp = 0;
  let fastUp = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => productSurfaceCapture("Voice Library", page),
      scrollDown: async () => {
        down += 1;
        page = Math.min(2, page + 1);
        if (down === 2) throw new Error("transport lost after moving");
      },
      scrollUp: async () => {
        exactUp += 1;
        page = Math.max(0, page - 1);
      },
      scrollUpFast: async () => {
        fastUp += 1;
        page = 0;
      },
      settle: async () => {},
    },
    {
      maxScrolls: 2,
      frozenDocumentOrigin: validatedFrozenOriginForTest(productSurfaceCapture("Voice Library", 0)),
    },
  );

  assert.equal(result.reason, "scroll-failed");
  assert.equal(fastUp, 0);
  assert.equal(exactUp, 1);
  assert.equal(result.restoredStartViewport, false);
  assert.equal(result.documentOriginProven, undefined);
});

test("does not use fast restoration from an arbitrary starting viewport", async () => {
  const pages = [image(0), image(40), image(80)];
  let page = 1;
  let exactUp = 0;
  let fastUp = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => captured(pages[page]!, page),
      scrollDown: async () => {
        page = Math.min(2, page + 1);
      },
      scrollUp: async () => {
        exactUp += 1;
        page = Math.max(1, page - 1);
      },
      scrollUpFast: async () => {
        fastUp += 1;
        page = 0;
      },
      settle: async () => {},
    },
    { maxScrolls: 1 },
  );

  assert.equal(result.reason, "limit-reached");
  assert.equal(result.restoredStartViewport, true);
  assert.equal(page, 1);
  assert.equal(exactUp, 1);
  assert.equal(fastUp, 0);
});

test("does not claim restoration when inverse swipes leave a scrolled viewport", async () => {
  let page = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => captured(image(page * 40), page),
      scrollDown: async () => {
        page += 1;
      },
      scrollUp: async () => {},
      settle: async () => {},
    },
    { maxScrolls: 1 },
  );
  assert.equal(result.reason, "limit-reached");
  assert.equal(result.restoredStartViewport, false);
});

test("skips inverse restoration when restore is false", async () => {
  const startingPage = 2;
  const terminalPage = 3;
  let page = startingPage;
  let up = 0;
  const result = await captureScrollableSurvey(
    {
      capture: async () => captured(image((page - startingPage) * 40), page - startingPage),
      scrollDown: async () => {
        page = Math.min(page + 1, terminalPage);
      },
      scrollUp: async () => {
        up += 1;
        page -= 1;
      },
      settle: async () => {},
    },
    { restore: false },
  );
  assert.equal(result.status, "completed");
  assert.equal(result.reason, "end-of-content");
  assert.equal(result.frames.length, 2);
  assert.equal(up, 0);
  assert.equal(page, terminalPage);
  assert.equal(result.restoredStartViewport, false);
  assert.match(result.message, /Restore skipped/u);
});
