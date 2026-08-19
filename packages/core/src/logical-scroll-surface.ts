import { createHash } from "node:crypto";
import type {
  AppMap,
  AppMapMutationContext,
  LogicalScrollSurface,
  LogicalScrollSurfaceImport,
  ScrollSurfaceCapturePolicy,
  ScrollSurfaceEvidence,
  TargetProfile,
} from "@relay/protocol";
import { PNG } from "pngjs";
import { persistAuthoringEvidence, readAuthoringEvidence } from "./authoring-evidence.js";
import {
  composeScrollSurveyFrames,
  mergeScrollSurfaceNodes,
  type ScrollSurveyFrame,
  type ScrollSurveyResult,
} from "./scrollable-survey.js";
import { appMapFail } from "./app-map/errors.js";
import { mutateAppMap } from "./app-map/mutation.js";
import { compileScrollSurfaceSemanticIndex } from "./scroll-surface-semantic-index.js";

type SurfaceWithoutManifest = Omit<LogicalScrollSurface, "manifest">;

function evidenceReference(
  evidence: Awaited<ReturnType<typeof persistAuthoringEvidence>>,
  mime: ScrollSurfaceEvidence["mime"],
): ScrollSurfaceEvidence {
  if (!evidence.sha256) throw new Error(`Evidence ${evidence.id} has no content digest`);
  return {
    id: evidence.id,
    uri: evidence.uri,
    sha256: evidence.sha256,
    mime,
    bytes: evidence.bytes ?? 0,
  };
}

function evidenceReferenceForBytes(
  bytes: Buffer,
  mime: ScrollSurfaceEvidence["mime"],
): ScrollSurfaceEvidence {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    id: `evidence-${sha256.slice(0, 24)}`,
    uri: `relay-evidence://${sha256}`,
    sha256,
    mime,
    bytes: bytes.byteLength,
  };
}

function stableCaptureId(input: {
  targetProfileId: string;
  capturedAt: number;
  evidence: ScrollSurfaceEvidence[];
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        targetProfileId: input.targetProfileId,
        capturedAt: input.capturedAt,
        evidence: input.evidence.map((item) => item.sha256),
      }),
    )
    .digest("hex");
  return `scroll-surface-${digest.slice(0, 24)}`;
}

export function logicalScrollSurfaceId(screenId: string, variantId: string): string {
  const digest = createHash("sha256")
    .update(`${screenId}\0${variantId}\0full-surface`)
    .digest("hex");
  return `scroll-surface-${digest.slice(0, 24)}`;
}

/** Persist a survey without retaining base64 in the logical App Map. Every raw
 * screenshot/tree pair is written first, followed by the regenerable derived
 * artifacts and a self-contained JSON manifest. */
export async function persistLogicalScrollSurface(input: {
  survey: ScrollSurveyResult;
  targetProfile: TargetProfile;
  surfaceId: string;
  capturePolicy: ScrollSurfaceCapturePolicy & { captureMode: "full-surface" };
}): Promise<LogicalScrollSurface> {
  const viewports: LogicalScrollSurface["viewports"] = [];
  for (const frame of input.survey.frames) {
    const screenshot = await persistAuthoringEvidence({
      kind: "screenshot",
      capturedAt: frame.screenshot.capturedAt,
      data: Buffer.from(frame.screenshot.base64, "base64"),
      mime: "image/png",
    });
    const accessibilityTree = await persistAuthoringEvidence({
      kind: "snapshot",
      capturedAt: frame.snapshot.capturedAt,
      data: JSON.stringify(frame.snapshot),
      mime: "application/json",
    });
    viewports.push({
      index: frame.index,
      offsetY: frame.offsetY,
      appendedHeight: frame.appendedHeight,
      capturedAt: frame.screenshot.capturedAt,
      width: frame.screenshot.width,
      height: frame.screenshot.height,
      screenshot: {
        ...evidenceReference(screenshot, "image/png"),
        mime: "image/png",
      },
      accessibilityTree: {
        ...evidenceReference(accessibilityTree, "application/json"),
        mime: "application/json",
      },
    });
  }
  const diagnosticViewports: LogicalScrollSurface["viewports"] = [];
  for (const frame of input.survey.diagnosticFrames) {
    const screenshot = await persistAuthoringEvidence({
      kind: "screenshot",
      capturedAt: frame.screenshot.capturedAt,
      data: Buffer.from(frame.screenshot.base64, "base64"),
      mime: "image/png",
    });
    const accessibilityTree = await persistAuthoringEvidence({
      kind: "snapshot",
      capturedAt: frame.snapshot.capturedAt,
      data: JSON.stringify(frame.snapshot),
      mime: "application/json",
    });
    diagnosticViewports.push({
      index: frame.index,
      offsetY: frame.offsetY,
      appendedHeight: 0,
      capturedAt: frame.screenshot.capturedAt,
      width: frame.screenshot.width,
      height: frame.screenshot.height,
      screenshot: { ...evidenceReference(screenshot, "image/png"), mime: "image/png" },
      accessibilityTree: {
        ...evidenceReference(accessibilityTree, "application/json"),
        mime: "application/json",
      },
    });
  }

  const capturedAt = viewports[0]?.capturedAt ?? Date.now();
  const mergedTreeEvidence = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt,
    data: JSON.stringify({
      schemaVersion: 1,
      coordinateSpace: "logical-scroll-surface",
      nodes: input.survey.mergedNodes,
    }),
    mime: "application/json",
  });
  const mergedTree = {
    ...evidenceReference(mergedTreeEvidence, "application/json"),
    mime: "application/json" as const,
    nodeCount: input.survey.mergedNodes.length,
  };

  let composite: LogicalScrollSurface["composite"];
  if (input.survey.stitched) {
    const compositeEvidence = await persistAuthoringEvidence({
      kind: "screenshot",
      capturedAt,
      data: Buffer.from(input.survey.stitched.base64, "base64"),
      mime: "image/png",
    });
    composite = {
      ...evidenceReference(compositeEvidence, "image/png"),
      mime: "image/png",
      width: input.survey.stitched.width,
      height: input.survey.stitched.height,
    };
  }

  const rawEvidence = [
    ...viewports.flatMap((viewport) => [viewport.screenshot, viewport.accessibilityTree]),
    ...diagnosticViewports.flatMap((viewport) => [viewport.screenshot, viewport.accessibilityTree]),
    ...(composite ? [composite] : []),
    mergedTree,
  ];
  const surface: SurfaceWithoutManifest = {
    schemaVersion: 1,
    id: input.surfaceId,
    captureId: stableCaptureId({
      targetProfileId: input.targetProfile.id,
      capturedAt,
      evidence: rawEvidence,
    }),
    targetProfileId: input.targetProfile.id,
    capturePolicy: structuredClone(input.capturePolicy),
    capturedAt,
    status: input.survey.status,
    reason: input.survey.reason,
    message: input.survey.message,
    restoredStartViewport: input.survey.restoredStartViewport,
    viewports,
    ...(diagnosticViewports.length > 0 ? { diagnosticViewports } : {}),
    ...(composite ? { composite } : {}),
    mergedTree,
    semanticIndex: compileScrollSurfaceSemanticIndex({
      nodes: input.survey.mergedNodes,
      frames: input.survey.frames,
      ...(input.survey.stitched ? { compositeHeight: input.survey.stitched.height } : {}),
    }),
  };
  const manifestEvidence = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt,
    data: JSON.stringify({
      schemaVersion: 1,
      kind: "relay.logical-scroll-surface",
      targetProfile: input.targetProfile,
      surface,
    }),
    mime: "application/json",
  });
  return {
    ...surface,
    manifest: {
      ...evidenceReference(manifestEvidence, "application/json"),
      mime: "application/json",
    },
  };
}

function surfaceEvidence(surface: LogicalScrollSurface): ScrollSurfaceEvidence[] {
  return [
    ...surface.viewports.flatMap((viewport) => [viewport.screenshot, viewport.accessibilityTree]),
    ...(surface.diagnosticViewports ?? []).flatMap((viewport) => [
      viewport.screenshot,
      viewport.accessibilityTree,
    ]),
    ...(surface.composite ? [surface.composite] : []),
    surface.mergedTree,
    surface.manifest,
  ];
}

function derivedSurfaceEvidence(surface: LogicalScrollSurface): ScrollSurfaceEvidence[] {
  return [...(surface.composite ? [surface.composite] : []), surface.mergedTree, surface.manifest];
}

async function requireRawEvidence(reference: ScrollSurfaceEvidence): Promise<Buffer> {
  if (reference.uri !== `relay-evidence://${reference.sha256}`) {
    appMapFail("invalid-map", `Raw scroll evidence ${reference.id} has an invalid URI`);
  }
  const bytes = await readAuthoringEvidence(reference.sha256);
  if (
    !bytes ||
    bytes.byteLength !== reference.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== reference.sha256
  ) {
    appMapFail("missing-reference", `Raw scroll evidence ${reference.id} is missing or corrupt`);
  }
  return bytes;
}

/** Materialize an imported seam-ambiguous logical surface from existing raw
 * CAS evidence. Derived refs are computed in memory for previews and written
 * only when requested; callers never supply authoritative derived artifacts. */
export async function materializeLogicalScrollSurfaceImport(input: {
  surfaceImport: LogicalScrollSurfaceImport;
  targetProfile: TargetProfile;
  ownedEvidenceIds: ReadonlySet<string>;
  ownedEvidenceUris: ReadonlySet<string>;
  persist: boolean;
}): Promise<LogicalScrollSurface> {
  const imported = input.surfaceImport;
  if (
    imported.schemaVersion !== 1 ||
    imported.targetProfileId !== input.targetProfile.id ||
    imported.capturePolicy?.captureMode !== "full-surface" ||
    !Array.isArray(imported.viewports) ||
    imported.viewports.length < 2 ||
    imported.viewports.length > 13
  ) {
    appMapFail("invalid-map", "Logical surface import metadata is invalid");
  }
  const frames: ScrollSurveyFrame[] = [];
  for (const viewport of imported.viewports) {
    for (const reference of [viewport.screenshot, viewport.accessibilityTree]) {
      if (
        !input.ownedEvidenceIds.has(reference.id) ||
        !input.ownedEvidenceUris.has(reference.uri)
      ) {
        appMapFail("scope-mismatch", `Raw viewport evidence ${reference.id} is not map-owned`);
      }
    }
    if (viewport.screenshot.mime !== "image/png") {
      appMapFail("invalid-map", `Raw viewport ${viewport.index} screenshot must be PNG`);
    }
    if (viewport.accessibilityTree.mime !== "application/json") {
      appMapFail("invalid-map", `Raw viewport ${viewport.index} tree must be JSON`);
    }
    const [screenshotBytes, treeBytes] = await Promise.all([
      requireRawEvidence(viewport.screenshot),
      requireRawEvidence(viewport.accessibilityTree),
    ]);
    let decoded: PNG;
    try {
      decoded = PNG.sync.read(screenshotBytes);
    } catch {
      appMapFail("invalid-map", `Raw viewport ${viewport.index} screenshot is not a valid PNG`);
    }
    if (decoded.width !== viewport.width || decoded.height !== viewport.height) {
      appMapFail("invalid-map", `Raw viewport ${viewport.index} dimensions do not match its PNG`);
    }
    let snapshot: ScrollSurveyFrame["snapshot"];
    try {
      snapshot = JSON.parse(treeBytes.toString("utf8")) as ScrollSurveyFrame["snapshot"];
    } catch {
      appMapFail("invalid-map", `Raw viewport ${viewport.index} tree is invalid JSON`);
    }
    if (!snapshot || !Array.isArray(snapshot.nodes)) {
      appMapFail("invalid-map", `Raw viewport ${viewport.index} tree has no nodes`);
    }
    frames.push({
      index: viewport.index,
      offsetY: viewport.offsetY,
      appendedHeight: viewport.appendedHeight,
      screenshot: {
        base64: screenshotBytes.toString("base64"),
        width: viewport.width,
        height: viewport.height,
        capturedAt: viewport.capturedAt,
      },
      snapshot,
    });
  }
  const capturedAt = imported.viewports[0]!.capturedAt;
  const mergedNodes = mergeScrollSurfaceNodes(frames);
  const mergedTreeBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      coordinateSpace: "logical-scroll-surface",
      nodes: mergedNodes,
    }),
  );
  const mergedTree = {
    ...evidenceReferenceForBytes(mergedTreeBytes, "application/json"),
    mime: "application/json" as const,
    nodeCount: mergedNodes.length,
  };
  const withoutManifest: SurfaceWithoutManifest = {
    schemaVersion: 1,
    id: imported.id,
    captureId: stableCaptureId({
      targetProfileId: input.targetProfile.id,
      capturedAt,
      evidence: [
        ...imported.viewports.flatMap((viewport) => [
          viewport.screenshot,
          viewport.accessibilityTree,
        ]),
        mergedTree,
      ],
    }),
    targetProfileId: input.targetProfile.id,
    capturePolicy: structuredClone(imported.capturePolicy),
    capturedAt,
    status: "stopped",
    reason: "seam-ambiguous",
    message: imported.message,
    restoredStartViewport: imported.restoredStartViewport,
    viewports: structuredClone(imported.viewports),
    mergedTree,
    semanticIndex: compileScrollSurfaceSemanticIndex({
      nodes: mergedNodes,
      frames,
    }),
  };
  const manifestBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      kind: "relay.logical-scroll-surface",
      targetProfile: input.targetProfile,
      surface: withoutManifest,
    }),
  );
  const manifest = {
    ...evidenceReferenceForBytes(manifestBytes, "application/json"),
    mime: "application/json" as const,
  };
  if (input.persist) {
    const persistedMergedTree = await persistAuthoringEvidence({
      kind: "snapshot",
      capturedAt,
      data: mergedTreeBytes,
      mime: "application/json",
    });
    const persistedManifest = await persistAuthoringEvidence({
      kind: "snapshot",
      capturedAt,
      data: manifestBytes,
      mime: "application/json",
    });
    if (
      persistedMergedTree.sha256 !== mergedTree.sha256 ||
      persistedManifest.sha256 !== manifest.sha256
    ) {
      throw new Error("Persisted logical surface artifacts do not match their derivation");
    }
  }
  return { ...withoutManifest, manifest };
}

/** Rebuild every derived view from immutable raw viewport PNG/tree evidence.
 * No target interaction is performed and capture identity is retained. */
export async function regenerateLogicalScrollSurface(input: {
  surface: LogicalScrollSurface;
  targetProfile: TargetProfile;
}): Promise<LogicalScrollSurface> {
  if (
    input.surface.reason === "seam-ambiguous" &&
    !input.surface.composite &&
    !input.surface.diagnosticViewports?.length
  ) {
    const rawEvidence = input.surface.viewports.flatMap((viewport) => [
      viewport.screenshot,
      viewport.accessibilityTree,
    ]);
    return materializeLogicalScrollSurfaceImport({
      surfaceImport: {
        schemaVersion: 1,
        id: input.surface.id,
        targetProfileId: input.surface.targetProfileId,
        capturePolicy: structuredClone(input.surface.capturePolicy),
        message: input.surface.message,
        restoredStartViewport: input.surface.restoredStartViewport,
        viewports: structuredClone(input.surface.viewports),
      },
      targetProfile: input.targetProfile,
      ownedEvidenceIds: new Set(rawEvidence.map(({ id }) => id)),
      ownedEvidenceUris: new Set(rawEvidence.map(({ uri }) => uri)),
      persist: true,
    });
  }
  const frames: ScrollSurveyFrame[] = [];
  for (const viewport of input.surface.viewports) {
    const [screenshot, treeBytes] = await Promise.all([
      requireRawEvidence(viewport.screenshot),
      requireRawEvidence(viewport.accessibilityTree),
    ]);
    let snapshot: ScrollSurveyFrame["snapshot"];
    try {
      snapshot = JSON.parse(treeBytes.toString("utf8")) as ScrollSurveyFrame["snapshot"];
    } catch {
      appMapFail("invalid-map", `Raw scroll tree ${viewport.accessibilityTree.id} is invalid JSON`);
    }
    frames.push({
      index: viewport.index,
      offsetY: viewport.offsetY,
      appendedHeight: viewport.appendedHeight,
      screenshot: {
        base64: screenshot.toString("base64"),
        width: viewport.width,
        height: viewport.height,
        capturedAt: viewport.capturedAt,
      },
      snapshot,
    });
  }
  const composition = composeScrollSurveyFrames(frames);
  if (!composition?.stitched) {
    appMapFail("invalid-map", `Raw scroll evidence no longer yields one verified visual seam`);
  }
  const capturedAt = input.surface.capturedAt;
  const mergedTreeEvidence = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt,
    data: JSON.stringify({
      schemaVersion: 1,
      coordinateSpace: "logical-scroll-surface",
      nodes: composition.mergedNodes,
    }),
    mime: "application/json",
  });
  const compositeEvidence = await persistAuthoringEvidence({
    kind: "screenshot",
    capturedAt,
    data: Buffer.from(composition.stitched.base64, "base64"),
    mime: "image/png",
  });
  const { manifest: _previousManifest, ...surfaceIdentity } = structuredClone(input.surface);
  const withoutManifest: SurfaceWithoutManifest = {
    ...surfaceIdentity,
    viewports: input.surface.viewports.map((viewport, index) => ({
      ...structuredClone(viewport),
      offsetY: composition.frames[index]!.offsetY,
      appendedHeight: composition.frames[index]!.appendedHeight,
    })),
    composite: {
      ...evidenceReference(compositeEvidence, "image/png"),
      mime: "image/png",
      width: composition.stitched.width,
      height: composition.stitched.height,
    },
    mergedTree: {
      ...evidenceReference(mergedTreeEvidence, "application/json"),
      mime: "application/json",
      nodeCount: composition.mergedNodes.length,
    },
    semanticIndex: compileScrollSurfaceSemanticIndex({
      nodes: composition.mergedNodes,
      frames: composition.frames,
      compositeHeight: composition.stitched.height,
    }),
  };
  const manifestEvidence = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt,
    data: JSON.stringify({
      schemaVersion: 1,
      kind: "relay.logical-scroll-surface",
      targetProfile: input.targetProfile,
      surface: withoutManifest,
    }),
    mime: "application/json",
  });
  return {
    ...withoutManifest,
    manifest: {
      ...evidenceReference(manifestEvidence, "application/json"),
      mime: "application/json",
    },
  };
}

/** Atomically attach one immutable logical surface to exactly one selected
 * Screen Variant. Other target/locale variants remain untouched. */
export function attachAppMapScrollSurface(
  map: AppMap,
  input: { screenId: string; variantId: string; surface: LogicalScrollSurface },
  context: AppMapMutationContext,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "screen.updated",
      subject: { kind: "screen", id: input.screenId },
      touched: [`screenVariants.${input.variantId}.scrollSurfaces`],
      summary: `Captured scrollable surface for screen ${input.screenId}`,
    },
    (draft) => {
      const screen = draft.screens[input.screenId];
      if (!screen) appMapFail("missing-reference", `Screen ${input.screenId} does not exist`);
      const variant = draft.screenVariants[input.variantId];
      if (!variant || variant.screenId !== screen.id || !screen.variantIds.includes(variant.id)) {
        appMapFail(
          "missing-reference",
          `Screen ${input.screenId} does not own variant ${input.variantId}`,
        );
      }
      if (input.surface.targetProfileId !== variant.targetProfile.id) {
        appMapFail("scope-mismatch", `Scroll surface belongs to another target profile`);
      }
      const evidence = surfaceEvidence(input.surface);
      variant.evidenceIds = [
        ...new Set([...variant.evidenceIds, ...evidence.map((item) => item.id)]),
      ];
      variant.evidenceUris = [
        ...new Set([...(variant.evidenceUris ?? []), ...evidence.map((item) => item.uri)]),
      ];
      if (
        !variant.scrollSurfaces?.some((surface) => surface.captureId === input.surface.captureId)
      ) {
        variant.scrollSurfaces = [
          ...(variant.scrollSurfaces ?? []),
          structuredClone(input.surface),
        ];
      }
      variant.scrollCapturePolicy = structuredClone(input.surface.capturePolicy);
      variant.updatedAt = context.at;
      screen.updatedAt = context.at;
    },
  );
}

/** Atomically replace only derived refs/geometry for one immutable capture. */
export function replaceAppMapScrollSurfaceDerived(
  map: AppMap,
  input: { screenId: string; variantId: string; surface: LogicalScrollSurface },
  context: AppMapMutationContext,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "screen.updated",
      subject: { kind: "screen", id: input.screenId },
      touched: [`screenVariants.${input.variantId}.scrollSurfaces`],
      summary: `Regenerated scroll surface for screen ${input.screenId}`,
    },
    (draft) => {
      const screen = draft.screens[input.screenId];
      const variant = draft.screenVariants[input.variantId];
      if (!screen || !variant || variant.screenId !== screen.id) {
        appMapFail(
          "missing-reference",
          `Screen ${input.screenId} does not own variant ${input.variantId}`,
        );
      }
      const index = variant.scrollSurfaces?.findIndex(
        (surface) => surface.captureId === input.surface.captureId,
      );
      if (index === undefined || index < 0) {
        appMapFail("missing-reference", `Scroll capture ${input.surface.captureId} does not exist`);
      }
      const existing = variant.scrollSurfaces![index]!;
      const rawIdentity = (surface: LogicalScrollSurface) =>
        surface.viewports.map((viewport) => ({
          index: viewport.index,
          capturedAt: viewport.capturedAt,
          width: viewport.width,
          height: viewport.height,
          screenshot: viewport.screenshot,
          accessibilityTree: viewport.accessibilityTree,
        }));
      if (
        existing.id !== input.surface.id ||
        existing.captureId !== input.surface.captureId ||
        JSON.stringify(rawIdentity(existing)) !== JSON.stringify(rawIdentity(input.surface))
      ) {
        appMapFail("scope-mismatch", `Regeneration cannot replace logical or raw capture identity`);
      }
      const oldDerived = derivedSurfaceEvidence(existing);
      variant.scrollSurfaces![index] = structuredClone(input.surface);
      const retained = new Set(
        variant
          .scrollSurfaces!.flatMap((surface) => surfaceEvidence(surface))
          .map((item) => item.id),
      );
      const retired = new Set(
        oldDerived.filter((item) => !retained.has(item.id)).map((item) => item.id),
      );
      const retiredUris = new Set(
        oldDerived.filter((item) => retired.has(item.id)).map((item) => item.uri),
      );
      const nextEvidence = surfaceEvidence(input.surface);
      variant.evidenceIds = [
        ...new Set([
          ...variant.evidenceIds.filter((id) => !retired.has(id)),
          ...nextEvidence.map((item) => item.id),
        ]),
      ];
      variant.evidenceUris = [
        ...new Set([
          ...(variant.evidenceUris ?? []).filter((uri) => !retiredUris.has(uri)),
          ...nextEvidence.map((item) => item.uri),
        ]),
      ];
      variant.updatedAt = context.at;
      screen.updatedAt = context.at;
    },
  );
}
