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
  serverUrl?: () => string;
};

export function screenshotUrl(server: EvidenceServer, step: RecipeStep | undefined): string {
  const screenshot = step?.evidence?.screenshot;
  return screenshot ? server.recordingEvidenceUrl(screenshot.recipeId, screenshot.id) : "";
}

function observedDiscoveryImage(server: EvidenceServer, screenId: string): string {
  const match = /^observed:(discovery-[A-Za-z0-9-]+):screen:(screen-[A-Za-z0-9-]+)$/.exec(screenId);
  const base = server.serverUrl?.()?.replace(/\/+$/, "");
  if (!match || !base) return "";
  return `${base}/discovery/${encodeURIComponent(match[1]!)}/screens/${encodeURIComponent(match[2]!)}`;
}

export function variantScreenshotUrl(
  server: EvidenceServer,
  appMap: AppMap | null | undefined,
  screenId: string,
): string {
  const variant = latestScreenVariant(appMap, screenId);
  const uri = variant?.screenshotUri;
  if (uri) return server.authoringEvidenceUrl(uri, "image/png");
  return observedDiscoveryImage(server, screenId);
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

export type ScreenMediaNode = { id: string; representativeStepIndex: number };

/**
 * One answer to "which picture belongs to this screen", for every surface that
 * asks. The canvas frame, the Screens grid and the inspector each spelled the
 * same three-step fallback out by hand, which is three places to forget the
 * saved variant when the recording has no screenshot.
 */
export function screenMediaResolvers(input: {
  server: EvidenceServer;
  steps: () => Array<RecipeStep | undefined>;
  nodeFor: (screenId: string) => ScreenMediaNode | undefined;
  appMap: () => AppMap | undefined;
  capturedUrls: () => Record<string, string>;
}) {
  const imageForNode = (node: ScreenMediaNode): string =>
    screenshotUrl(input.server, input.steps()[node.representativeStepIndex]) ||
    input.capturedUrls()[node.id] ||
    variantScreenshotUrl(input.server, input.appMap(), node.id) ||
    "";
  const orientationForNode = (node: ScreenMediaNode) =>
    screenshotOrientationEvidence(input.server, input.steps()[node.representativeStepIndex]) ||
    variantOrientationEvidence(input.appMap(), node.id);
  return {
    imageForNode,
    orientationForNode,
    /** A screen the canvas has not filed yet can still have a live capture. */
    imageForScreen: (screenId: string): string => {
      const node = input.nodeFor(screenId);
      return node ? imageForNode(node) : (input.capturedUrls()[screenId] ?? "");
    },
    orientationForScreen: (screenId: string) => {
      const node = input.nodeFor(screenId);
      return node ? orientationForNode(node) : undefined;
    },
  };
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
