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
  regenerateLogicalScrollSurface,
  replaceAppMapScrollSurfaceDerived,
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

function patternedPng(documentOffset: number): Buffer {
  const image = new PNG({ width: 64, height: 160 });
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const value = (y + documentOffset + x * 7) % 255;
      image.data[offset] = value;
      image.data[offset + 1] = (value * 3) % 255;
      image.data[offset + 2] = (value * 5) % 255;
      image.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

const regenerationProfile: TargetProfile = {
  ...profile,
  id: "android-en",
  targetId: "android-1",
  platform: "android",
  name: "Android · English",
  viewport: { width: 64, height: 160 },
};

function regenerableSurvey(): ScrollSurveyResult {
  const frame = (index: number, documentOffset: number) => {
    const screenshot = patternedPng(documentOffset);
    return {
      index,
      offsetY: index === 0 ? 0 : 93,
      appendedHeight: index === 0 ? 0 : 93,
      screenshot: {
        base64: screenshot.toString("base64"),
        width: 64,
        height: 160,
        capturedAt: 100 + index,
      },
      snapshot: {
        serial: "android-1",
        capturedAt: 100 + index,
        foregroundApp: "app.relay.fixture",
        nodes: Array.from({ length: 4 }, (_, nodeIndex) => ({
          label: `Stable row ${nodeIndex}`,
          type: "TextView",
          rect: { x: 4, y: 60 + nodeIndex * 20 - documentOffset, width: 40, height: 12 },
        })),
        interactive: [],
        bounds: { width: 64, height: 160 },
        inspectable: true,
        source: "sdk" as const,
        screenIdentity: {
          fingerprint: "regenerable-surface",
          nodes: [],
          volatileSignals: [],
        },
      },
    };
  };
  return {
    status: "completed",
    reason: "end-of-content",
    frames: [frame(0, 0), frame(1, 40)],
    // Deliberately stale derived artifacts. Regeneration must ignore them.
    stitched: { base64: png(91), width: 4, height: 4, mime: "image/png" },
    mergedNodes: [{ label: "Stale node", type: "StaticText" }],
    restoredStartViewport: true,
    message: "Fixture contains stale derived views.",
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

test("regenerates derived views deterministically while retaining all raw capture evidence", async () => {
  const state = await mkdtemp(join(tmpdir(), "relay-scroll-surface-regenerate-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = state;
  try {
    const initial = await persistLogicalScrollSurface({
      survey: regenerableSurvey(),
      targetProfile: regenerationProfile,
      surfaceId: logicalScrollSurfaceId("settings", "settings-ja"),
      capturePolicy: {
        captureMode: "full-surface",
        source: "explicit",
        reason: "Stable product-owned fixture.",
        decidedAt: 100,
      },
    });
    const rawIdentity = (surface: typeof initial) =>
      surface.viewports.map((viewport) => ({
        screenshot: viewport.screenshot,
        accessibilityTree: viewport.accessibilityTree,
      }));
    const regenerated = await regenerateLogicalScrollSurface({
      surface: initial,
      targetProfile: regenerationProfile,
    });
    assert.equal(regenerated.id, initial.id);
    assert.equal(regenerated.captureId, initial.captureId);
    assert.deepEqual(rawIdentity(regenerated), rawIdentity(initial));
    assert.equal(regenerated.viewports[1]?.offsetY, 40);
    assert.equal(regenerated.viewports[1]?.appendedHeight, 40);
    assert.equal(regenerated.composite?.width, 64);
    assert.equal(regenerated.composite?.height, 200);
    assert.notEqual(regenerated.composite?.sha256, initial.composite?.sha256);
    assert.notEqual(regenerated.mergedTree.sha256, initial.mergedTree.sha256);
    assert.notEqual(regenerated.manifest.sha256, initial.manifest.sha256);

    const repeated = await regenerateLogicalScrollSurface({
      surface: regenerated,
      targetProfile: regenerationProfile,
    });
    assert.deepEqual(rawIdentity(repeated), rawIdentity(initial));
    assert.deepEqual(repeated.viewports, regenerated.viewports);
    assert.equal(repeated.composite?.sha256, regenerated.composite?.sha256);
    assert.equal(repeated.mergedTree.sha256, regenerated.mergedTree.sha256);
    assert.equal(repeated.manifest.sha256, regenerated.manifest.sha256);

    const fixture = mapFixture();
    fixture.screenVariants["settings-ja"]!.targetProfile = regenerationProfile;
    const attached = attachAppMapScrollSurface(
      fixture,
      { screenId: "settings", variantId: "settings-ja", surface: initial },
      {
        expectedRevision: 0,
        eventId: "initial-capture",
        actorId: "human:designer",
        actorKind: "human",
        at: 200,
      },
    );
    const replaced = replaceAppMapScrollSurfaceDerived(
      attached,
      { screenId: "settings", variantId: "settings-ja", surface: regenerated },
      {
        expectedRevision: 1,
        eventId: "regenerate-capture",
        actorId: "human:designer",
        actorKind: "human",
        at: 210,
      },
    );
    const stored = replaced.screenVariants["settings-ja"]!.scrollSurfaces?.[0];
    assert.deepEqual(stored, regenerated);
    assert.deepEqual(rawIdentity(stored!), rawIdentity(initial));
    assert.equal(replaced.activity["regenerate-capture"]?.subject.id, "settings");
    assert.ok(
      replaced.screenVariants["settings-ja"]!.evidenceIds.includes(regenerated.manifest.id),
    );
    assert.ok(!replaced.screenVariants["settings-ja"]!.evidenceIds.includes(initial.manifest.id));
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
  const licenses = recommendScrollSurfaceCapturePolicy({
    title: "Open Source Licenses",
    semanticLabels: ["AndroidX", "Kotlin", "Licenses"],
    decidedAt: 80,
  });
  assert.equal(licenses.captureMode, "viewport");
  assert.match(licenses.reason, /representative viewport/iu);
});
