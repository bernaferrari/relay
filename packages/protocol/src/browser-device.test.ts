import assert from "node:assert/strict";
import test from "node:test";
import {
  browserDeviceControlInputSchema,
  browserDeviceFrameSchema,
  browserDeviceSessionSchema,
  compileBrowserEnvironment,
} from "./index.js";

const profile = compileBrowserEnvironment({ viewport: { width: 800, height: 600 } });
const session = {
  schemaVersion: 1 as const,
  sessionId: "session-1",
  targetId: "browser-1",
  status: "streaming" as const,
  ownership: "controlled" as const,
  sequence: 4,
  activePageId: "page-1",
  pages: [
    {
      id: "page-1",
      kind: "page" as const,
      title: "Product",
      url: "https://example.test/",
      active: true,
      closed: false,
    },
  ],
  profile,
  startedAt: 1,
  frameCapturedAt: 2,
};

test("Browser Device contracts retain exact session, page, and frame identity", () => {
  assert.deepEqual(browserDeviceSessionSchema.parse(session), session);
  const frame = {
    sessionId: "session-1",
    sequence: 4,
    pageId: "page-1",
    pageUrl: "https://example.test/",
    visualFingerprint: "sha256-frame",
    capturedAt: 2,
    mime: "image/jpeg" as const,
    base64: "AA==",
    bytes: 1,
    width: 800,
    height: 600,
  };
  assert.deepEqual(browserDeviceFrameSchema.parse(frame), frame);
  assert.equal(
    browserDeviceControlInputSchema.safeParse({
      targetId: "browser-1",
      input: {
        sessionId: "session-1",
        pageId: "page-1",
        expectedSequence: 4,
        kind: "click",
        x: 10,
        y: 20,
      },
    }).success,
    true,
  );
});

test("Browser Device input fails schema validation without frame provenance", () => {
  assert.equal(
    browserDeviceControlInputSchema.safeParse({
      targetId: "browser-1",
      input: { kind: "click", x: 10, y: 20 },
    }).success,
    false,
  );
  assert.equal(
    browserDeviceControlInputSchema.safeParse({
      targetId: "browser-1",
      input: {
        sessionId: "session-1",
        pageId: "page-1",
        expectedSequence: 4,
        kind: "key",
        key: "Meta+Alt+Unbounded",
      },
    }).success,
    false,
  );
});
