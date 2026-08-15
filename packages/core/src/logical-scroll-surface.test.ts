import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import type { AppMap, TargetProfile } from "@relay/protocol";
import { validateAppMap } from "./app-map.js";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import {
  attachAppMapScrollSurface,
  logicalScrollSurfaceId,
  persistLogicalScrollSurface,
} from "./logical-scroll-surface.js";
import { recommendScrollSurfaceCapturePolicy } from "./scroll-surface-policy.js";
import type { ScrollSurveyResult } from "./scrollable-survey.js";

function png(red: number): string {
  const image = new PNG({ width: 4, height: 4 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = red;
    image.data[offset + 1] = 20;
    image.data[offset + 2] = 30;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image).toString("base64");
}

const profile: TargetProfile = {
  id: "ipad-ja",
  targetId: "ipad-1",
  source: "device",
  platform: "ios",
  name: "iPad · Japanese",
  viewport: { width: 4, height: 4 },
  capabilities: ["scroll", "snapshot", "screenshot"],
  observedAt: 1,
};

function survey(): ScrollSurveyResult {
  const frame = (index: number, offsetY: number, base64: string) => ({
    index,
    offsetY,
    screenshot: { base64, width: 4, height: 4, capturedAt: 10 + index },
    snapshot: {
      serial: "ipad-1",
      capturedAt: 10 + index,
      nodes: [{ label: `Row ${index}`, type: "StaticText" }],
      interactive: [],
      bounds: { width: 4, height: 4 },
      inspectable: true,
      source: "sdk" as const,
      screenIdentity: {
        fingerprint: `${index}`.repeat(64),
        nodes: [{ role: "StaticText", label: `Row ${index}` }],
        volatileSignals: [],
      },
    },
    appendedHeight: index === 0 ? 0 : 2,
  });
  return {
    status: "stopped",
    reason: "limit-reached",
    frames: [frame(0, 0, png(10)), frame(1, 2, png(40))],
    stitched: { base64: png(80), width: 4, height: 6, mime: "image/png" },
    mergedNodes: [
      { label: "Row 0", type: "StaticText", rect: { x: 0, y: 0, width: 4, height: 2 } },
      { label: "Row 1", type: "StaticText", rect: { x: 0, y: 4, width: 4, height: 2 } },
    ],
    restoredStartViewport: true,
    message: "Relay reached the configured survey limit.",
  };
}

function mapFixture(): AppMap {
  return {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org-1",
    projectId: "project-1",
    name: "Settings",
    revision: 0,
    notes: {},
    groups: {},
    screens: {
      settings: {
        id: "settings",
        organizationId: "org-1",
        projectId: "project-1",
        appMapId: "map-1",
        title: "Settings",
        variantIds: ["settings-ja"],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: {
      "settings-ja": {
        id: "settings-ja",
        organizationId: "org-1",
        projectId: "project-1",
        appMapId: "map-1",
        screenId: "settings",
        targetProfile: profile,
        evidenceIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

test("persists every raw viewport and attaches only durable evidence URIs", async () => {
  const state = await mkdtemp(join(tmpdir(), "relay-scroll-surface-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = state;
  try {
    const captured = survey();
    const surface = await persistLogicalScrollSurface({
      survey: captured,
      targetProfile: profile,
      surfaceId: logicalScrollSurfaceId("settings", "settings-ja"),
      capturePolicy: {
        captureMode: "full-surface",
        source: "explicit",
        reason: "Authored as a complete stable settings surface.",
        decidedAt: 10,
      },
    });
    assert.equal(surface.viewports.length, 2);
    assert.equal(surface.composite?.height, 6);
    assert.equal(surface.mergedTree.nodeCount, 2);
    assert.match(surface.manifest.uri, /^relay-evidence:\/\/[a-f0-9]{64}$/u);

    const firstTree = await readAuthoringEvidence(surface.viewports[0]!.accessibilityTree.sha256);
    assert.equal(JSON.parse(firstTree!.toString("utf8")).nodes[0].label, "Row 0");
    const manifest = await readAuthoringEvidence(surface.manifest.sha256);
    const parsedManifest = JSON.parse(manifest!.toString("utf8"));
    assert.equal(parsedManifest.kind, "relay.logical-scroll-surface");
    assert.equal(parsedManifest.targetProfile.id, "ipad-ja");
    assert.equal(parsedManifest.surface.viewports.length, 2);

    const attached = attachAppMapScrollSurface(
      mapFixture(),
      { screenId: "settings", variantId: "settings-ja", surface },
      {
        expectedRevision: 0,
        eventId: "capture-full-settings",
        actorId: "human:designer",
        actorKind: "human",
        at: 20,
      },
    );
    const variant = attached.screenVariants["settings-ja"]!;
    assert.equal(variant.scrollSurfaces?.[0]?.id, surface.id);
    assert.equal(variant.scrollCapturePolicy?.captureMode, "full-surface");
    assert.ok(variant.evidenceUris?.includes(surface.manifest.uri));
    assert.ok(variant.evidenceUris?.includes(surface.viewports[1]!.screenshot.uri));
    assert.doesNotMatch(JSON.stringify(attached), /"base64"/u);
    assert.equal(attached.activity["capture-full-settings"]?.subject.id, "settings");
    attached.tests!["settings-surface"] = {
      id: "settings-surface",
      organizationId: "org-1",
      projectId: "project-1",
      appMapId: "map-1",
      name: "Settings logical surface",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: [],
      surfaceBindings: [
        {
          screenId: "settings",
          variantId: "settings-ja",
          captureMode: "full-surface",
          reason: "Stable settings UI is covered as one logical surface.",
          surfaceId: surface.id,
          baselineCaptureId: surface.captureId,
          compare: "visual-and-semantic",
          repair: "propose-recapture",
        },
      ],
      createdAt: 20,
      updatedAt: 20,
    };
    assert.doesNotThrow(() => validateAppMap(attached));
    attached.tests!["settings-surface"]!.surfaceBindings![0]!.baselineCaptureId = "missing";
    assert.throws(() => validateAppMap(attached), /missing logical surface baseline/u);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(state, { recursive: true, force: true });
  }
});

test("rejects attaching a surface to another target/locale variant", async () => {
  const state = await mkdtemp(join(tmpdir(), "relay-scroll-surface-scope-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = state;
  try {
    const surface = await persistLogicalScrollSurface({
      survey: survey(),
      targetProfile: profile,
      surfaceId: logicalScrollSurfaceId("settings", "settings-ja"),
      capturePolicy: {
        captureMode: "full-surface",
        source: "explicit",
        reason: "Authored as a complete stable settings surface.",
        decidedAt: 10,
      },
    });
    assert.throws(
      () =>
        attachAppMapScrollSurface(
          {
            ...mapFixture(),
            screenVariants: {
              "settings-ja": {
                ...mapFixture().screenVariants["settings-ja"]!,
                targetProfile: { ...profile, id: "ipad-en" },
              },
            },
          },
          { screenId: "settings", variantId: "settings-ja", surface },
          {
            expectedRevision: 0,
            eventId: "wrong-profile",
            actorId: "human:designer",
            actorKind: "human",
            at: 20,
          },
        ),
      /another target profile/u,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(state, { recursive: true, force: true });
  }
});

test("keeps dynamic or private content viewport-only while recommending stable product UI", () => {
  assert.equal(
    recommendScrollSurfaceCapturePolicy({
      title: "Import memory",
      semanticLabels: ["Provider", "Your memories"],
      decidedAt: 50,
    }).captureMode,
    "viewport",
  );
  assert.equal(
    recommendScrollSurfaceCapturePolicy({
      title: "SuperGrok settings",
      semanticLabels: ["Manage billing", "Account"],
      decidedAt: 60,
    }).captureMode,
    "full-surface",
  );
  assert.equal(
    recommendScrollSurfaceCapturePolicy({ title: "Unclassified page", decidedAt: 70 }).captureMode,
    "viewport",
  );
});
