import type { AppMap, LogicalScrollSurface } from "@relay/protocol";
import type { RecipeStep } from "../context/server";
import {
  companionLogicalViewport,
  companionOrientationEdge,
} from "../components/app-map-device-companion-geometry";
import type { ScreenshotOrientationEvidence } from "../components/oriented-screenshot";
import { latestScreenVariant } from "./app-map-workspace-helpers";

export type EvidenceServer = {
  recordingEvidenceUrl: (recipeId: string, id: string) => string;
  authoringEvidenceUrl: (uri: string, mime?: string) => string;
  devices: () => Array<{ serial: string; platform?: string }>;
};

export function screenshotUrl(server: EvidenceServer, step: RecipeStep | undefined): string {
  const screenshot = step?.evidence?.screenshot;
  return screenshot ? server.recordingEvidenceUrl(screenshot.recipeId, screenshot.id) : "";
}

export function variantScreenshotUrl(
  server: EvidenceServer,
  appMap: AppMap | null | undefined,
  screenId: string,
): string {
  const variant = latestScreenVariant(appMap, screenId);
  const uri = variant?.screenshotUri;
  return uri ? server.authoringEvidenceUrl(uri, "image/png") : "";
}

/** The newest decomposable full-page capture for one logical map screen. */
export function variantScrollSurface(
  appMap: AppMap | null | undefined,
  screenId: string,
): LogicalScrollSurface | undefined {
  return latestScreenVariant(appMap, screenId)?.scrollSurfaces?.toSorted(
    (left, right) =>
      right.capturedAt - left.capturedAt || right.captureId.localeCompare(left.captureId),
  )[0];
}

export function variantOrientationEvidence(
  appMap: AppMap | null | undefined,
  screenId: string,
): ScreenshotOrientationEvidence | undefined {
  const profile = latestScreenVariant(appMap, screenId)?.targetProfile;
  return profile
    ? {
        ...(profile.viewport ? { logicalViewport: { ...profile.viewport } } : {}),
        platform: profile.platform,
      }
    : undefined;
}

export function screenshotOrientationEvidence(
  server: EvidenceServer,
  step: RecipeStep | undefined,
): ScreenshotOrientationEvidence | undefined {
  const evidence = step?.evidence;
  if (!evidence) return undefined;
  const logicalViewport =
    companionLogicalViewport(evidence.nodes) ??
    (evidence.deviceBounds ? { ...evidence.deviceBounds } : undefined);
  const platform = evidence.serial
    ? server.devices().find((device) => device.serial === evidence.serial)?.platform
    : undefined;
  const edge = companionOrientationEdge(evidence.nodes, logicalViewport);
  return {
    ...(logicalViewport ? { logicalViewport } : {}),
    ...(platform ? { platform } : {}),
    ...(edge ? { edge } : {}),
  };
}
