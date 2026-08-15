import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import {
  captureScrollableSurvey,
  composeScrollSurveyFrames,
  verticalScrollSeam,
} from "./scrollable-survey.js";
import type { SnapshotPayload } from "./workspace-capture.js";

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

test("finds a vertical overlap and detects an unchanged terminal viewport", () => {
  assert.equal(verticalScrollSeam(image(0), image(0))?.shiftY, 0);
  const seam = verticalScrollSeam(image(0), image(40));
  assert.ok(seam);
  assert.ok(Math.abs(seam!.shiftY - 40) <= 2);
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
    { identifier: "app-root", type: "Application", rect: { x: 0, y: 0, width, height } },
    { label: "Data Controls", type: "Toolbar", rect: { x: 40, y: 150, width: 500, height: 60 } },
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
    });
  }
  paint(navigationTop, height, 8, 8, 8);
  nodes.push(
    {
      label: "Back",
      type: "ImageView",
      rect: { x: 100, y: navigationTop, width: 150, height: 135 },
    },
    {
      label: "Home",
      type: "ImageView",
      rect: { x: 465, y: navigationTop, width: 150, height: 135 },
    },
    {
      label: "Recents",
      type: "ImageView",
      rect: { x: 820, y: navigationTop, width: 150, height: 135 },
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
  const result = await captureScrollableSurvey({
    capture: async () =>
      captureIndex++ === 0 ? captured(image(0), 0) : captured(image(40), 1, "other-screen"),
    scrollDown: async () => {
      successfulDown += 1;
    },
    scrollUp: async () => {
      up += 1;
    },
    settle: async () => {},
  });
  assert.equal(result.reason, "screen-changed");
  assert.equal(up, successfulDown);
  assert.equal(result.restoredStartViewport, true);
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
      },
      settle: async () => {},
    },
    { maxScrolls: 3 },
  );
  assert.equal(result.reason, "screen-changed");
  assert.equal(result.frames.length, 2);
  assert.equal(up, successfulDown);
});

test("restores after an ambiguous seam", async () => {
  let captureIndex = 0;
  let successfulDown = 0;
  let up = 0;
  const result = await captureScrollableSurvey({
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
    settle: async () => {},
  });
  assert.equal(result.reason, "seam-ambiguous");
  assert.equal(up, successfulDown);
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
  assert.equal(result.restoredStartViewport, true);
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
