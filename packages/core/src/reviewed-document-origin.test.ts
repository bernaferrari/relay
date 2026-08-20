import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
  type AppMap,
  type AppMapScenarioTest,
  type TargetProfile,
} from "@relay/protocol";
import { PNG } from "pngjs";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import { scrollSurfaceDocumentOriginPlan } from "./app-map-scroll-surface-baseline.js";
import { compileAppMapTest } from "./map-work.js";
import {
  duplicateAppMap,
  importAppMap,
  readAppMap,
  resetControlDatabaseCache,
} from "./collaboration.js";
import { controlDatabasePath, openControlDatabase } from "./collaboration-db.js";
import {
  attachAppMapScrollSurface,
  persistLogicalScrollSurface,
} from "./logical-scroll-surface.js";
import {
  activeReviewedDocumentOriginsForAppMap,
  inspectReviewedDocumentOrigin,
  reviewDocumentOrigin,
  reviewedDocumentOriginExecutionReferenceIsActive,
  reviewedDocumentOriginReferenceForSurface,
  reviewedDocumentOriginRevocationEvidenceIsValid,
  revokeReviewedDocumentOrigin,
} from "./reviewed-document-origin.js";
import { validateRecipeSteps } from "./recipe-validation.js";
import type { ScrollSurveyResult } from "./scrollable-survey.js";

const profile: TargetProfile = {
  id: "android-profile",
  targetId: "android-device",
  source: "device",
  platform: "android",
  name: "Pixel · English",
  viewport: { width: 8, height: 16 },
  capabilities: ["scroll", "snapshot", "screenshot"],
  observedAt: 10,
};

function png(red: number): string {
  const image = new PNG({ width: 8, height: 16 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 1] = 30;
    image.data[index + 2] = 50;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image).toString("base64");
}

function legacyCompletedSurvey(): ScrollSurveyResult {
  const frame = (index: number, offsetY: number, appendedHeight: number) => ({
    index,
    offsetY,
    appendedHeight,
    screenshot: { base64: png(50 + index), width: 8, height: 16, capturedAt: 100 + index },
    snapshot: {
      serial: profile.targetId,
      capturedAt: 100 + index,
      foregroundApp: "com.example.settings",
      nodes: [
        {
          identifier: "settings-scroll",
          type: "android.widget.ScrollView",
          rect: { x: 0, y: 0, width: 8, height: 16 },
        },
        {
          label: `Settings row ${index}`,
          type: "android.widget.TextView",
          rect: { x: 1, y: 4, width: 6, height: 4 },
        },
      ],
      interactive: [],
      bounds: { width: 8, height: 16 },
      inspectable: true,
      source: "sdk" as const,
      screenIdentity: { fingerprint: "f".repeat(64), nodes: [], volatileSignals: [] },
    },
  });
  return {
    status: "completed",
    reason: "end-of-content",
    frames: [frame(0, 0, 0), frame(1, 8, 8)],
    diagnosticFrames: [],
    stitched: { base64: png(80), width: 8, height: 24, mime: "image/png" },
    mergedNodes: [
      { label: "Settings row 0", type: "android.widget.TextView" },
      { label: "Settings row 1", type: "android.widget.TextView" },
    ],
    restoredStartViewport: true,
    message: "Imported legacy survey completed without a native capture receipt.",
  };
}

async function persistedLegacyMap(): Promise<AppMap> {
  const surface = await persistLogicalScrollSurface({
    survey: legacyCompletedSurvey(),
    targetProfile: profile,
    surfaceId: "settings-surface",
    capturePolicy: {
      captureMode: "full-surface",
      source: "explicit",
      reason: "Settings is a stable full document.",
      decidedAt: 100,
    },
  });
  assert.equal(surface.documentOriginProof, undefined);
  const base: AppMap = {
    schemaVersion: 1,
    id: "settings-map",
    organizationId: "org-1",
    projectId: "project-1",
    name: "Settings",
    revision: 7,
    notes: {},
    groups: {},
    screens: {
      home: {
        id: "home",
        organizationId: "org-1",
        projectId: "project-1",
        appMapId: "settings-map",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: [],
        createdAt: 10,
        updatedAt: 10,
      },
      settings: {
        id: "settings",
        organizationId: "org-1",
        projectId: "project-1",
        appMapId: "settings-map",
        title: "Settings",
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
        variantIds: ["settings-en"],
        createdAt: 10,
        updatedAt: 10,
      },
    },
    screenVariants: {
      "settings-en": {
        id: "settings-en",
        organizationId: "org-1",
        projectId: "project-1",
        appMapId: "settings-map",
        screenId: "settings",
        targetProfile: profile,
        evidenceIds: [],
        createdAt: 10,
        updatedAt: 10,
      },
    },
    connections: {
      "open-settings": {
        id: "open-settings",
        organizationId: "org-1",
        projectId: "project-1",
        appMapId: "settings-map",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        label: "Settings",
        state: "ready",
        actions: [{ id: "tap-settings", kind: "tap", target: { label: "Settings" } }],
        createdAt: 10,
        updatedAt: 10,
      },
    },
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
    createdAt: 10,
    updatedAt: 10,
  };
  const attached = attachAppMapScrollSurface(
    base,
    { screenId: "settings", variantId: "settings-en", surface },
    {
      expectedRevision: 7,
      eventId: "attach-imported-settings",
      actorId: "agent:importer",
      actorKind: "agent",
      at: 101,
    },
  );
  await importAppMap({
    organizationId: "org-1",
    projectId: "project-1",
    appMap: attached,
    conflict: "replace",
  });
  const stored = await readAppMap("project-1", "settings-map");
  if (!stored) throw new Error("Expected imported Settings App Map");
  return stored;
}

async function withStateRoot(operation: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-reviewed-origin-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    await operation();
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function reviewInput(appMap: AppMap) {
  return {
    appMap,
    screenId: "settings",
    variantId: "settings-en",
    captureId: appMap.screenVariants["settings-en"]!.scrollSurfaces![0]!.captureId,
    expectedRevision: appMap.revision,
    actor: { actorId: "human:reviewer", actorKind: "human" as const },
    reason: "The saved first frame was inspected as document top.",
    assertion: REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
    confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
    at: 1_000,
  };
}

function captureTest(appMap: AppMap): AppMapScenarioTest {
  const surface = appMap.screenVariants["settings-en"]!.scrollSurfaces![0]!;
  return {
    organizationId: appMap.organizationId,
    projectId: appMap.projectId,
    appMapId: appMap.id,
    id: "settings-capture",
    name: "Capture Settings",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "open-settings",
        kind: "instruction",
        intent: "Open Settings",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["open-settings"],
        },
      },
    ],
    surfaceBindings: [
      {
        screenId: "settings",
        variantId: "settings-en",
        captureMode: "full-surface",
        reason: "Compare the reviewed Settings document.",
        surfaceId: surface.id,
        baselineCaptureId: surface.captureId,
        compare: "visual-and-semantic",
        repair: "propose-recapture",
      },
    ],
    createdAt: 10,
    updatedAt: 10,
  };
}

function compiledCapture(appMap: AppMap, options: Parameters<typeof compileAppMapTest>[2] = {}) {
  return Object.values(compileAppMapTest(appMap, captureTest(appMap), options).graph)
    .flatMap((recipe) => recipe.steps)
    .find((step) => step.kind === "capture-surface");
}

test("reviewed origin is an immutable sidecar that enables only exact legacy evidence", async () => {
  await withStateRoot(async () => {
    const appMap = await persistedLegacyMap();
    const input = reviewInput(appMap);
    const approved = await reviewDocumentOrigin(input);
    const surface = appMap.screenVariants["settings-en"]!.scrollSurfaces![0]!;

    assert.equal(surface.documentOriginProof, undefined);
    assert.equal(approved.ledger.status, "active");
    assert.equal(approved.ledger.sequence, 2);
    assert.equal(approved.projection.binding.appMapRevision, appMap.revision);
    assert.equal(approved.projection.binding.appMapId, appMap.id);
    assert.equal(approved.projection.binding.captureId, surface.captureId);
    assert.equal(approved.projection.approval.actor.actorId, "human:reviewer");
    const approvalBytes = await readAuthoringEvidence(approved.projection.approval.evidence.sha256);
    assert.match(approvalBytes?.toString("utf8") ?? "", /human:reviewer/u);

    const inspection = await inspectReviewedDocumentOrigin(input);
    assert.equal(inspection.lineage.length, 1);
    assert.equal(inspection.lineage[0]?.currentBinding, true);
    assert.equal(inspection.lineage[0]?.ledger?.status, "active");
    assert.deepEqual(
      inspection.lineage[0]?.ledgerEvents.map(({ sequence, status }) => ({ sequence, status })),
      [
        { sequence: 1, status: "pending" },
        { sequence: 2, status: "active" },
      ],
    );
    assert.deepEqual(await activeReviewedDocumentOriginsForAppMap(appMap), [approved.projection]);

    assert.equal(
      scrollSurfaceDocumentOriginPlan({
        appMap,
        screenId: "settings",
        variantId: "settings-en",
        surface,
      }),
      undefined,
    );
    const reference = reviewedDocumentOriginReferenceForSurface({
      appMap,
      screenId: "settings",
      variantId: "settings-en",
      surface,
      projections: [approved.projection],
    });
    assert.ok(reference);
    const plan = scrollSurfaceDocumentOriginPlan({
      appMap,
      screenId: "settings",
      variantId: "settings-en",
      surface,
      reviewedDocumentOrigins: [approved.projection],
    });
    assert.equal(plan?.reviewedDocumentOrigin?.projection.id, approved.projection.id);

    const offlineCapture = compiledCapture(appMap);
    assert.equal(offlineCapture?.kind, "capture-surface");
    if (offlineCapture?.kind === "capture-surface") {
      assert.equal(offlineCapture.baselineTrust, "recapture-required");
      assert.equal(offlineCapture.reviewedDocumentOrigin, undefined);
    }
    const reviewedCaptureFromCompiler = compiledCapture(appMap, {
      reviewedDocumentOrigins: [approved.projection],
    });
    assert.equal(reviewedCaptureFromCompiler?.kind, "capture-surface");
    if (reviewedCaptureFromCompiler?.kind === "capture-surface") {
      assert.equal(reviewedCaptureFromCompiler.baselineTrust, "trusted");
      assert.equal(
        reviewedCaptureFromCompiler.reviewedDocumentOrigin?.projection.id,
        approved.projection.id,
      );
    }

    const origin = surface.viewports[0]!;
    const reviewedCapture = {
      kind: "capture-surface" as const,
      screenId: "settings",
      screenTitle: "Settings",
      variantId: "settings-en",
      surfaceId: surface.id,
      baselineCaptureId: surface.captureId,
      reason: "Compare the reviewed Settings document.",
      baselineTrust: "trusted" as const,
      documentOrigin: origin,
      reviewedDocumentOrigin: reference,
    };
    assert.equal(validateRecipeSteps([reviewedCapture])[0]?.kind === "capture-surface", true);
    const mismatchedReference = structuredClone(reference)!;
    mismatchedReference.projection.binding.surfaceId = "other-surface";
    assert.throws(
      () =>
        validateRecipeSteps([{ ...reviewedCapture, reviewedDocumentOrigin: mismatchedReference }]),
      /reviewedDocumentOrigin must bind this exact first raw viewport/u,
    );
    assert.equal(
      await reviewedDocumentOriginExecutionReferenceIsActive({
        reference,
        origin,
        targetProfileId: profile.id,
        screenId: "settings",
        variantId: "settings-en",
        surfaceId: surface.id,
        captureId: surface.captureId,
      }),
      true,
    );
    assert.equal(
      await reviewedDocumentOriginExecutionReferenceIsActive({
        reference,
        origin,
        targetProfileId: profile.id,
        screenId: "settings",
        variantId: "settings-en",
        surfaceId: "other-surface",
        captureId: surface.captureId,
      }),
      false,
    );
    assert.equal(
      await reviewedDocumentOriginExecutionReferenceIsActive({
        reference,
        origin: { ...origin, offsetY: 1 },
        targetProfileId: profile.id,
        screenId: "settings",
        variantId: "settings-en",
        surfaceId: surface.id,
        captureId: surface.captureId,
      }),
      false,
    );

    const nativeSurface = structuredClone(surface);
    nativeSurface.documentOriginProof = {
      schemaVersion: 1,
      method: "frozen-origin-match",
      firstViewport: {
        screenshotSha256: origin.screenshot.sha256,
        accessibilityTreeSha256: origin.accessibilityTree.sha256,
      },
      attestation: nativeSurface.manifest,
      authorization: {
        schemaVersion: 1,
        issuer: "relay-local-capture",
        signature: "a".repeat(43),
      },
    };
    const nativePlan = scrollSurfaceDocumentOriginPlan({
      appMap,
      screenId: "settings",
      variantId: "settings-en",
      surface: nativeSurface,
      reviewedDocumentOrigins: [approved.projection],
    });
    assert.ok(nativePlan?.documentOriginProof);
    assert.equal(nativePlan?.reviewedDocumentOrigin, undefined);

    const revoked = await revokeReviewedDocumentOrigin({
      ...input,
      projectionId: approved.projection.id,
      reason: "The prior review must no longer authorize restoration.",
      assertion: REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
      at: 2_000,
    });
    assert.equal(revoked.ledger.status, "revoked");
    assert.equal(revoked.ledger.sequence, 3);
    assert.equal(await reviewedDocumentOriginRevocationEvidenceIsValid(revoked), true);
    assert.equal(
      await reviewedDocumentOriginExecutionReferenceIsActive({
        reference,
        origin,
        targetProfileId: profile.id,
        screenId: "settings",
        variantId: "settings-en",
        surfaceId: surface.id,
        captureId: surface.captureId,
      }),
      false,
    );
    assert.deepEqual(await activeReviewedDocumentOriginsForAppMap(appMap), []);
    const revokedInspection = await inspectReviewedDocumentOrigin(input);
    assert.deepEqual(
      revokedInspection.lineage[0]?.ledgerEvents.map(({ sequence, status }) => ({
        sequence,
        status,
      })),
      [
        { sequence: 1, status: "pending" },
        { sequence: 2, status: "active" },
        { sequence: 3, status: "revoked" },
      ],
    );
    assert.equal(revokedInspection.lineage[0]?.revocationTombstone?.sequence, 3);
  });
});

test("replacing an identical portable App Map cannot revive a reviewed origin", async () => {
  await withStateRoot(async () => {
    const appMap = await persistedLegacyMap();
    const approved = await reviewDocumentOrigin(reviewInput(appMap));
    const surface = appMap.screenVariants["settings-en"]!.scrollSurfaces![0]!;
    const reference = reviewedDocumentOriginReferenceForSurface({
      appMap,
      screenId: "settings",
      variantId: "settings-en",
      surface,
      projections: [approved.projection],
    });
    const duplicate = await duplicateAppMap({
      organizationId: appMap.organizationId,
      projectId: appMap.projectId,
      sourceAppMapId: appMap.id,
      appMapId: "settings-map-copy",
      at: 1_500,
    });
    assert.deepEqual(await activeReviewedDocumentOriginsForAppMap(duplicate), []);
    await importAppMap({
      organizationId: appMap.organizationId,
      projectId: appMap.projectId,
      appMap,
      conflict: "replace",
    });
    const replacement = await readAppMap(appMap.projectId, appMap.id);
    if (!replacement) throw new Error("Expected replacement App Map");
    const replacementSurface = replacement.screenVariants["settings-en"]!.scrollSurfaces![0]!;
    const inspection = await inspectReviewedDocumentOrigin({
      appMap: replacement,
      screenId: "settings",
      variantId: "settings-en",
      captureId: replacementSurface.captureId,
    });
    assert.equal(inspection.lineage[0]?.currentBinding, false);
    assert.deepEqual(await activeReviewedDocumentOriginsForAppMap(replacement), []);
    assert.equal(
      await reviewedDocumentOriginExecutionReferenceIsActive({
        reference,
        origin: surface.viewports[0]!,
        targetProfileId: profile.id,
        screenId: "settings",
        variantId: "settings-en",
        surfaceId: surface.id,
        captureId: surface.captureId,
      }),
      false,
    );
  });
});

test("runtime reopens CAS bytes instead of trusting a precompiled reviewed reference", async () => {
  await withStateRoot(async () => {
    const appMap = await persistedLegacyMap();
    const approved = await reviewDocumentOrigin(reviewInput(appMap));
    const surface = appMap.screenVariants["settings-en"]!.scrollSurfaces![0]!;
    const reference = reviewedDocumentOriginReferenceForSurface({
      appMap,
      screenId: "settings",
      variantId: "settings-en",
      surface,
      projections: [approved.projection],
    });
    await rm(
      join(
        process.env.RELAY_STATE_DIR!,
        "authoring-evidence",
        surface.viewports[0]!.screenshot.sha256,
      ),
    );
    assert.deepEqual(await activeReviewedDocumentOriginsForAppMap(appMap), []);
    assert.equal(
      await reviewedDocumentOriginExecutionReferenceIsActive({
        reference,
        origin: surface.viewports[0]!,
        targetProfileId: profile.id,
        screenId: "settings",
        variantId: "settings-en",
        surfaceId: surface.id,
        captureId: surface.captureId,
      }),
      false,
    );
  });
});

test("runtime and idempotent review fail closed when a signed lifecycle event is tampered", async () => {
  await withStateRoot(async () => {
    const appMap = await persistedLegacyMap();
    const input = reviewInput(appMap);
    const approved = await reviewDocumentOrigin(input);
    const surface = appMap.screenVariants["settings-en"]!.scrollSurfaces![0]!;
    const reference = reviewedDocumentOriginReferenceForSurface({
      appMap,
      screenId: "settings",
      variantId: "settings-en",
      surface,
      projections: [approved.projection],
    });
    assert.ok(reference);

    resetControlDatabaseCache();
    const db = openControlDatabase(controlDatabasePath(process.env.RELAY_STATE_DIR!));
    try {
      const row = db
        .prepare(
          `SELECT document FROM reviewed_document_origin_ledger_events
           WHERE projection_id = ? AND event_sequence = 2`,
        )
        .get(approved.projection.id) as { document: string };
      const tampered = JSON.parse(row.document) as {
        authorization: { signature: string };
      };
      tampered.authorization.signature = "x".repeat(43);
      db.prepare(
        `UPDATE reviewed_document_origin_ledger_events SET document = ?
         WHERE projection_id = ? AND event_sequence = 2`,
      ).run(JSON.stringify(tampered), approved.projection.id);
    } finally {
      db.close();
    }

    assert.deepEqual(await activeReviewedDocumentOriginsForAppMap(appMap), []);
    assert.equal(
      await reviewedDocumentOriginExecutionReferenceIsActive({
        reference,
        origin: surface.viewports[0]!,
        targetProfileId: profile.id,
        screenId: "settings",
        variantId: "settings-en",
        surfaceId: surface.id,
        captureId: surface.captureId,
      }),
      false,
    );
    await assert.rejects(reviewDocumentOrigin(input), /fails immutable authorization checks/u);
  });
});

test("manual reviewed-origin authority accepts deliberate agents but rejects system actors and unconfirmed prose", async () => {
  await withStateRoot(async () => {
    const appMap = await persistedLegacyMap();
    const input = reviewInput(appMap);
    const iosAppMap = structuredClone(appMap);
    iosAppMap.screenVariants["settings-en"]!.targetProfile.platform = "ios";
    await assert.rejects(reviewDocumentOrigin(reviewInput(iosAppMap)), /Android only/u);
    await assert.rejects(
      reviewDocumentOrigin({
        ...input,
        actor: { actorId: "system:recovery", actorKind: "system" },
      }),
      /Only a human or deliberate agent/u,
    );
    await assert.rejects(
      reviewDocumentOrigin({ ...input, assertion: "I looked at the screenshot" }),
      /review assertion must be exactly reviewed-document-top/u,
    );
    await assert.rejects(
      reviewDocumentOrigin({ ...input, confirmation: "not-confirmed" }),
      /confirmation must be exactly confirm/u,
    );
    const approved = await reviewDocumentOrigin({
      ...input,
      actor: { actorId: "agent:reviewer", actorKind: "agent" },
    });
    assert.equal(approved.projection.approval.actor.actorKind, "agent");
    await assert.rejects(
      revokeReviewedDocumentOrigin({
        ...input,
        projectionId: approved.projection.id,
        actor: { actorId: "system:recovery", actorKind: "system" },
        reason: "Automated cleanup is not manual authority.",
        assertion: REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
      }),
      /Only a human or deliberate agent/u,
    );
    await assert.rejects(
      revokeReviewedDocumentOrigin({
        ...input,
        projectionId: approved.projection.id,
        reason: "This has been deliberately reconsidered.",
        assertion: "please revoke it",
      }),
      /revoke assertion must be exactly revoke-reviewed-document-origin/u,
    );
  });
});

test("a durable revocation tombstone blocks a stale active ledger prefix", async () => {
  await withStateRoot(async () => {
    const appMap = await persistedLegacyMap();
    const input = reviewInput(appMap);
    const approved = await reviewDocumentOrigin(input);
    const surface = appMap.screenVariants["settings-en"]!.scrollSurfaces![0]!;
    const reference = reviewedDocumentOriginReferenceForSurface({
      appMap,
      screenId: "settings",
      variantId: "settings-en",
      surface,
      projections: [approved.projection],
    });
    assert.ok(reference);
    await revokeReviewedDocumentOrigin({
      ...input,
      projectionId: approved.projection.id,
      reason: "Disable the reviewed origin before validating stale recovery.",
      assertion: REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
      at: 2_000,
    });

    // Simulate a stale restore which copied only the old pending/active prefix.
    // The separate signed tombstone must still make every authority check fail.
    resetControlDatabaseCache();
    const db = openControlDatabase(controlDatabasePath(process.env.RELAY_STATE_DIR!));
    try {
      db.prepare(
        "DELETE FROM reviewed_document_origin_ledger_events WHERE projection_id = ? AND event_sequence = 3",
      ).run(approved.projection.id);
    } finally {
      db.close();
    }
    assert.deepEqual(await activeReviewedDocumentOriginsForAppMap(appMap), []);
    assert.equal(
      await reviewedDocumentOriginExecutionReferenceIsActive({
        reference,
        origin: surface.viewports[0]!,
        targetProfileId: profile.id,
        screenId: "settings",
        variantId: "settings-en",
        surfaceId: surface.id,
        captureId: surface.captureId,
      }),
      false,
    );
    const inspection = await inspectReviewedDocumentOrigin(input);
    assert.deepEqual(
      inspection.lineage[0]?.ledgerEvents.map(({ sequence }) => sequence),
      [1, 2],
    );
    assert.equal(inspection.lineage[0]?.revocationTombstone?.status, "revoked");
  });
});
