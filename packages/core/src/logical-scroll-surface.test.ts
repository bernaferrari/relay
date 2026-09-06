import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
import { captureScrollableSurvey, type ScrollSurveyResult } from "./scrollable-survey.js";
import { validatedFrozenOriginForTest } from "./scrollable-survey-test-support.js";

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
    diagnosticFrames: [{ ...frame(2, 2, png(70)), appendedHeight: 0 }],
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
        nodes: [
          {
            identifier: "android:id/content",
            type: "android.widget.FrameLayout",
            rect: { x: 0, y: 0, width: 64, height: 160 },
            index: 0,
          },
          {
            identifier: "regenerable-scroll",
            type: "android.widget.ScrollView",
            rect: { x: 0, y: 24, width: 64, height: 136 },
            index: 1,
            parentIndex: 0,
            hiddenContentBelow: index === 0,
          },
          ...Array.from({ length: 4 }, (_, nodeIndex) => ({
            label: `Stable row ${nodeIndex}`,
            type: "android.widget.TextView",
            rect: { x: 4, y: 60 + nodeIndex * 20 - documentOffset, width: 40, height: 12 },
            index: nodeIndex + 2,
            parentIndex: 1,
          })),
        ],
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
    diagnosticFrames: [],
    // Deliberately stale derived artifacts. Regeneration must ignore them.
    stitched: { base64: png(91), width: 4, height: 4, mime: "image/png" },
    mergedNodes: [{ label: "Stale node", type: "StaticText" }],
    restoredStartViewport: true,
    documentOriginProven: true,
    message: "Fixture contains stale derived views.",
  };
}

/** The only fixture that receives the runtime-only issuance marker. It models
 * a Voice/Settings-shaped surface: a stable scroll container advances once,
 * then the terminal drag proves end-of-content and one fast return reaches the
 * same fresh document origin. Hand-built completed results remain untrusted. */
async function provenRegenerableSurvey(): Promise<ScrollSurveyResult> {
  const fixture = regenerableSurvey();
  const [first, second] = fixture.frames;
  if (!first || !second) throw new Error("regenerable fixture requires two frames");
  let page = 0;
  return captureScrollableSurvey(
    {
      capture: async () => {
        const frame = page === 0 ? first : second;
        return { screenshot: frame.screenshot, snapshot: frame.snapshot };
      },
      scrollDown: async () => {
        page = 1;
      },
      scrollUp: async () => {
        page = 0;
      },
      scrollUpFast: async () => {
        page = 0;
      },
      settle: async () => undefined,
    },
    {
      maxScrolls: 2,
      frozenDocumentOrigin: validatedFrozenOriginForTest({
        screenshot: first.screenshot,
        snapshot: first.snapshot,
      }),
    },
  );
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
    assert.equal(surface.diagnosticViewports?.length, 1);
    assert.equal(surface.composite?.height, 6);
    assert.equal(surface.mergedTree.nodeCount, 2);
    assert.deepEqual(surface.confidenceModel?.coverage, [
      {
        startY: 0,
        endY: 6,
        state: "captured",
        confidence: 1,
        sourceViewportIndexes: [0, 1],
      },
      {
        startY: 6,
        endY: null,
        state: "not-reached",
        confidence: 1,
        sourceViewportIndexes: [],
      },
    ]);
    assert.equal(surface.confidenceModel?.classification, "partial");
    assert.equal(surface.confidenceModel?.mergeAnchors[0]?.basis, "capture-offset");
    assert.deepEqual(surface.semanticIndex?.anchors, [
      {
        order: 0,
        documentY: 1,
        target: { label: "Row 0" },
        label: "Row 0",
        role: "statictext",
      },
      {
        order: 1,
        documentY: 5,
        target: { label: "Row 1" },
        label: "Row 1",
        role: "statictext",
      },
    ]);
    assert.match(surface.manifest.uri, /^relay-evidence:\/\/[a-f0-9]{64}$/u);

    const firstTree = await readAuthoringEvidence(surface.viewports[0]!.accessibilityTree.sha256);
    assert.equal(JSON.parse(firstTree!.toString("utf8")).nodes[0].label, "Row 0");
    const manifest = await readAuthoringEvidence(surface.manifest.sha256);
    const parsedManifest = JSON.parse(manifest!.toString("utf8"));
    assert.equal(parsedManifest.kind, "relay.logical-scroll-surface");
    assert.equal(parsedManifest.targetProfile.id, "ipad-ja");
    assert.equal(parsedManifest.surface.viewports.length, 2);
    assert.equal(parsedManifest.surface.diagnosticViewports.length, 1);
    assert.deepEqual(parsedManifest.surface.semanticIndex, surface.semanticIndex);
    assert.deepEqual(parsedManifest.surface.confidenceModel, surface.confidenceModel);

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
    assert.ok(variant.evidenceUris?.includes(surface.diagnosticViewports![0]!.screenshot.uri));
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
    const alteredConfidence = structuredClone(attached);
    alteredConfidence.screenVariants[
      "settings-ja"
    ]!.scrollSurfaces![0]!.confidenceModel!.capturedPixels = 999;
    assert.throws(
      () => validateAppMap(alteredConfidence),
      /capturedPixels must match raw viewports/u,
    );
    attached.tests!["settings-surface"]!.surfaceBindings![0]!.baselineCaptureId = "missing";
    assert.throws(() => validateAppMap(attached), /missing logical surface baseline/u);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(state, { recursive: true, force: true });
  }
});

test("does not mint an origin proof from a stopped or unrestored survey", async () => {
  const state = await mkdtemp(join(tmpdir(), "relay-scroll-surface-unproven-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = state;
  try {
    const unproven = {
      ...regenerableSurvey(),
      status: "stopped" as const,
      reason: "seam-ambiguous" as const,
      restoredStartViewport: false,
      documentOriginProven: true as const,
    };
    const surface = await persistLogicalScrollSurface({
      survey: unproven,
      targetProfile: regenerationProfile,
      surfaceId: logicalScrollSurfaceId("settings", "settings-ja"),
      capturePolicy: {
        captureMode: "full-surface",
        source: "explicit",
        reason: "Stopped fixture must never create a document-origin proof.",
        decidedAt: 100,
      },
    });
    assert.equal(surface.documentOriginProof, undefined);
    const handAuthoredCompleted = await persistLogicalScrollSurface({
      survey: regenerableSurvey(),
      targetProfile: regenerationProfile,
      surfaceId: logicalScrollSurfaceId("settings", "settings-hand-authored"),
      capturePolicy: {
        captureMode: "full-surface",
        source: "explicit",
        reason: "A structural documentOriginProven flag is not an issuance authority.",
        decidedAt: 101,
      },
    });
    assert.equal(
      handAuthoredCompleted.documentOriginProof,
      undefined,
      "only captureScrollableSurvey can mint an origin-attestation receipt",
    );
    const issuedThenMutated = await provenRegenerableSurvey();
    issuedThenMutated.frames[0] = {
      ...issuedThenMutated.frames[0]!,
      screenshot: {
        ...issuedThenMutated.frames[0]!.screenshot,
        base64: patternedPng(17).toString("base64"),
      },
    };
    const mutatedRawEvidence = await persistLogicalScrollSurface({
      survey: issuedThenMutated,
      targetProfile: regenerationProfile,
      surfaceId: logicalScrollSurfaceId("settings", "settings-mutated-origin"),
      capturePolicy: {
        captureMode: "full-surface",
        source: "explicit",
        reason: "Mutating a marked survey must not mint a proof for new raw evidence.",
        decidedAt: 102,
      },
    });
    assert.equal(
      mutatedRawEvidence.documentOriginProof,
      undefined,
      "a runtime marker is bound to immutable first raw evidence, not a mutable result object",
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(state, { recursive: true, force: true });
  }
});

test("persists a completed survey when the optional local origin authority is unavailable", async () => {
  const state = await mkdtemp(join(tmpdir(), "relay-scroll-surface-authority-unavailable-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = state;
  try {
    // The evidence store can still write beneath state, but the signer cannot
    // read or create its secret at a path occupied by a directory.
    await mkdir(join(state, ".document-origin-attestation-authority"));
    const surface = await persistLogicalScrollSurface({
      survey: await provenRegenerableSurvey(),
      targetProfile: regenerationProfile,
      surfaceId: logicalScrollSurfaceId("settings", "settings-authority-unavailable"),
      capturePolicy: {
        captureMode: "full-surface",
        source: "explicit",
        reason: "A signer outage must not discard raw full-surface evidence.",
        decidedAt: 103,
      },
    });

    assert.equal(surface.status, "completed");
    assert.equal(surface.reason, "end-of-content");
    assert.equal(surface.restoredStartViewport, true);
    assert.equal(surface.documentOriginProof, undefined);
    assert.equal(surface.viewports.length, 2);
    assert.ok(await readAuthoringEvidence(surface.viewports[0]!.screenshot.sha256));
    assert.ok(await readAuthoringEvidence(surface.manifest.sha256));
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
    const captured = await provenRegenerableSurvey();
    // Derived artifacts are intentionally mutable preview data. Keep the
    // runtime-issued result object (and its private proof marker), but corrupt
    // only the derived projections so regeneration has meaningful work.
    captured.stitched = { base64: png(91), width: 4, height: 4, mime: "image/png" };
    captured.mergedNodes = [{ label: "Stale node", type: "StaticText" }];
    const initial = await persistLogicalScrollSurface({
      survey: captured,
      targetProfile: regenerationProfile,
      surfaceId: logicalScrollSurfaceId("settings", "settings-ja"),
      capturePolicy: {
        captureMode: "full-surface",
        source: "explicit",
        reason: "Stable product-owned fixture.",
        decidedAt: 100,
      },
    });
    assert.equal(initial.documentOriginProof?.schemaVersion, 1);
    assert.equal(initial.documentOriginProof?.method, "frozen-origin-match");
    assert.deepEqual(initial.documentOriginProof?.firstViewport, {
      screenshotSha256: initial.viewports[0]!.screenshot.sha256,
      accessibilityTreeSha256: initial.viewports[0]!.accessibilityTree.sha256,
    });
    assert.equal(initial.documentOriginProof?.attestation.mime, "application/json");
    const attestation = await readAuthoringEvidence(
      initial.documentOriginProof!.attestation.sha256,
    );
    assert.deepEqual(JSON.parse(attestation!.toString("utf8")), {
      schemaVersion: 1,
      kind: "relay.document-origin-attestation",
      method: "frozen-origin-match",
      targetProfileId: "android-en",
      surfaceId: logicalScrollSurfaceId("settings", "settings-ja"),
      capturedAt: 100,
      terminal: {
        status: "completed",
        reason: "end-of-content",
        restoredStartViewport: true,
      },
      firstViewport: {
        index: 0,
        offsetY: 0,
        appendedHeight: 0,
        capturedAt: 100,
        width: 64,
        height: 160,
        screenshotSha256: initial.viewports[0]!.screenshot.sha256,
        accessibilityTreeSha256: initial.viewports[0]!.accessibilityTree.sha256,
      },
      terminalViewport: {
        capturedAt: 100,
        width: 64,
        height: 160,
        screenshotSha256: initial.viewports[0]!.screenshot.sha256,
        accessibilityTreeSha256: initial.viewports[0]!.accessibilityTree.sha256,
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
    assert.deepEqual(regenerated.documentOriginProof, initial.documentOriginProof);
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
    assert.doesNotThrow(() => validateAppMap(replaced));

    // A legacy capture may be valid raw evidence, but a derived-only rebuild
    // must never be able to add an otherwise self-consistent origin proof to
    // it while retaining its old capture identity.
    const legacy = structuredClone(initial);
    delete legacy.documentOriginProof;
    const attachedLegacy = attachAppMapScrollSurface(
      (() => {
        const fixture = mapFixture();
        fixture.screenVariants["settings-ja"]!.targetProfile = regenerationProfile;
        return fixture;
      })(),
      { screenId: "settings", variantId: "settings-ja", surface: legacy },
      {
        expectedRevision: 0,
        eventId: "legacy-capture",
        actorId: "human:designer",
        actorKind: "human",
        at: 220,
      },
    );
    const forgedProof = structuredClone(legacy);
    forgedProof.documentOriginProof = structuredClone(initial.documentOriginProof!);
    assert.throws(
      () =>
        replaceAppMapScrollSurfaceDerived(
          attachedLegacy,
          { screenId: "settings", variantId: "settings-ja", surface: forgedProof },
          {
            expectedRevision: 1,
            eventId: "forge-origin-proof",
            actorId: "human:designer",
            actorKind: "human",
            at: 230,
          },
        ),
      /cannot replace immutable capture identity or provenance/u,
    );
    const forgedOriginProof = structuredClone(replaced);
    forgedOriginProof.screenVariants["settings-ja"]!.scrollSurfaces![0]!.documentOriginProof = {
      ...regenerated.documentOriginProof!,
      firstViewport: {
        ...regenerated.documentOriginProof!.firstViewport,
        screenshotSha256: "f".repeat(64),
      },
    };
    assert.throws(
      () => validateAppMap(forgedOriginProof),
      /must bind the first raw viewport evidence/u,
    );
    const unownedAttestation = structuredClone(replaced);
    unownedAttestation.screenVariants["settings-ja"]!.scrollSurfaces![0]!.documentOriginProof = {
      ...regenerated.documentOriginProof!,
      attestation: {
        id: "foreign-origin-attestation",
        uri: `relay-evidence://${"e".repeat(64)}`,
        sha256: "e".repeat(64),
        mime: "application/json",
        bytes: 1,
      },
    };
    assert.throws(
      () => validateAppMap(unownedAttestation),
      /foreign-origin-attestation is not owned by its variant/u,
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
  const licenses = recommendScrollSurfaceCapturePolicy({
    title: "Open Source Licenses",
    semanticLabels: ["AndroidX", "Kotlin", "Licenses"],
    decidedAt: 80,
  });
  assert.equal(licenses.captureMode, "viewport");
  assert.match(licenses.reason, /representative viewport/iu);
});
