import { createHash } from "node:crypto";
import type {
  AppMap,
  AppMapMutationContext,
  LogicalScrollSurface,
  ScrollSurfaceCapturePolicy,
  ScrollSurfaceEvidence,
  TargetProfile,
} from "@relay/protocol";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import type { ScrollSurveyResult } from "./scrollable-survey.js";
import { appMapFail } from "./app-map/errors.js";
import { mutateAppMap } from "./app-map/mutation.js";

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
    ...(composite ? { composite } : {}),
    mergedTree,
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
    ...(surface.composite ? [surface.composite] : []),
    surface.mergedTree,
    surface.manifest,
  ];
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
