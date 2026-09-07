import assert from "node:assert/strict";
import test from "node:test";
import {
  browserDeviceControlInputSchema,
  browserDeviceBinaryFrameMetadataSchema,
  browserDeviceFrameSchema,
  browserDeviceInputResolutionSchema,
  browserDeviceOpenInputSchema,
  browserDeviceSemanticOverlaySchema,
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
  assert.deepEqual(
    browserDeviceBinaryFrameMetadataSchema.parse({
      schemaVersion: 1,
      transport: "binary",
      session,
      frame: Object.fromEntries(Object.entries(frame).filter(([key]) => key !== "base64")),
    }),
    {
      schemaVersion: 1,
      transport: "binary",
      session,
      frame: Object.fromEntries(Object.entries(frame).filter(([key]) => key !== "base64")),
    },
  );
  const overlay = {
    schemaVersion: 1 as const,
    sessionId: "session-1",
    pageId: "page-1",
    sequence: 4,
    visualFingerprint: "sha256-frame",
    capturedAt: 2,
    truncated: false,
    candidates: [
      {
        id: "candidate-0",
        role: "button",
        label: "Continue",
        rect: { x: 10, y: 20, width: 100, height: 40 },
        enabled: true,
        selected: false,
        focused: false,
        locator: { strategy: "role-name" as const, value: "Continue", role: "button", exact: true },
        reasoning: 'Role "button" with accessible name "Continue".',
      },
    ],
  };
  assert.deepEqual(browserDeviceSemanticOverlaySchema.parse(overlay), overlay);
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
        coordinateFallback: "reviewed",
      },
    }).success,
    true,
  );
  assert.deepEqual(
    browserDeviceOpenInputSchema.parse({
      targetId: "browser-1",
      signedOut: true,
      sessionId: "session-1",
      configurationDigest: "browser-1::signed-out:out",
    }),
    {
      targetId: "browser-1",
      signedOut: true,
      sessionId: "session-1",
      configurationDigest: "browser-1::signed-out:out",
    },
  );
  assert.equal(
    browserDeviceOpenInputSchema.safeParse({
      targetId: "browser-1",
      signedOut: true,
      authenticationFixtureId: "authfx:admin:4",
    }).success,
    false,
  );
});

test("Browser Device semantic overlays reject unbounded or stale-shaped data", () => {
  const valid = {
    schemaVersion: 1 as const,
    sessionId: "session-1",
    pageId: "page-1",
    sequence: 1,
    visualFingerprint: "frame-1",
    capturedAt: 1,
    truncated: false,
    candidates: [],
  };
  assert.equal(browserDeviceSemanticOverlaySchema.safeParse(valid).success, true);
  assert.equal(
    browserDeviceSemanticOverlaySchema.safeParse({
      ...valid,
      candidates: Array.from({ length: 129 }, (_, index) => ({
        id: `candidate-${index}`,
        role: "button",
        rect: { x: 0, y: 0, width: 1, height: 1 },
        enabled: true,
        selected: false,
        focused: false,
        reasoning: "bounded",
      })),
    }).success,
    false,
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

test("Browser Device click resolution is bounded and distinguishes reviewed fallback", () => {
  assert.deepEqual(
    browserDeviceInputResolutionSchema.parse({
      outcome: "semantic",
      strategy: "role-name",
      candidateId: "candidate-0",
      locator: { strategy: "role-name", value: "Continue", role: "button", exact: true },
      reviewedCoordinateFallback: false,
      reasoning: "One visible enabled match at the exact painted point.",
    }).outcome,
    "semantic",
  );
  assert.equal(
    browserDeviceInputResolutionSchema.safeParse({
      outcome: "coordinate-fallback",
      strategy: "coordinate",
      reviewedCoordinateFallback: true,
      reasoning: "Reviewed coordinate fallback.",
    }).success,
    true,
  );
  assert.equal(
    browserDeviceInputResolutionSchema.safeParse({
      outcome: "coordinate-fallback",
      strategy: "coordinate",
      reviewedCoordinateFallback: false,
      reasoning: "x".repeat(321),
    }).success,
    false,
  );
  assert.equal(
    browserDeviceInputResolutionSchema.safeParse({
      outcome: "semantic",
      strategy: "role-name",
      candidateId: "candidate-0",
      locator: { strategy: "label", value: "Continue" },
      reviewedCoordinateFallback: false,
      reasoning: "mismatched strategy",
    }).success,
    false,
  );
  assert.equal(
    browserDeviceInputResolutionSchema.safeParse({
      outcome: "coordinate-fallback",
      strategy: "coordinate",
      candidateId: "candidate-0",
      reviewedCoordinateFallback: true,
      reasoning: "coordinate fallback cannot carry a candidate",
    }).success,
    false,
  );
});
