import {
  BROWSER_TARGET_CAPABILITIES,
  browserAuthoringCaseProfileForTarget,
  digestAppMapTestExecutionValue,
  listDevices,
  type AppMap,
} from "@relay/core";
import type {
  ActionSpec,
  AuthoringInteraction,
  AuthoringSession,
  ConnectionSourceAnchor,
  OperationInput,
  TargetProfile,
} from "@relay/protocol";

/** Fail open for an empty tree: iOS can legitimately lose AX briefly while
 * screenshot evidence remains valid. */
export function iosTeachObservationMatchesTitle(
  nodes: Array<Record<string, unknown>> | undefined,
  title: string,
): boolean {
  if (!nodes?.length) return true;
  const screenTitle = title.split(/\s*[·•]\s*/u, 1)[0] ?? title;
  const words = screenTitle
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length >= 4);
  if (!words.length) return true;
  const visibleText = nodes
    .filter((node) => node.visibleToUser !== false)
    .flatMap((node) => [node.label, node.identifier, node.value])
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();
  return words.every((word) => visibleText.includes(word));
}

function teachActionSemantics(action: ActionSpec): unknown {
  if (action.kind === "tap") {
    return {
      kind: "tap",
      target: action.target,
      ...(action.expectedApp ? { expectedApp: action.expectedApp } : {}),
    };
  }
  if (action.kind === "gesture" && action.gesture.kind === "swipe") {
    return { kind: "swipe", from: action.gesture.from, to: action.gesture.to };
  }
  return undefined;
}

export function findEquivalentTeachConnection(
  map: AppMap,
  input: { fromScreenId: string; destinationScreenId: string; action: ActionSpec },
): string | undefined {
  const action = teachActionSemantics(input.action);
  if (!action) return undefined;
  const semanticTap =
    input.action.kind === "tap" &&
    !input.action.target.point &&
    (input.action.target.identifier?.trim() || input.action.target.label?.trim())
      ? input.action.target
      : undefined;
  const expectedApp = input.action.kind === "tap" ? input.action.expectedApp : undefined;
  return Object.values(map.connections).find((connection) => {
    if (
      connection.fromScreenId !== input.fromScreenId ||
      connection.destination.kind !== "screen" ||
      connection.destination.screenId !== input.destinationScreenId ||
      connection.actions.length !== 1
    ) {
      return false;
    }
    const existing = connection.actions[0]!;
    if (JSON.stringify(teachActionSemantics(existing)) === JSON.stringify(action)) return true;
    // Omitting a point is an intentional semantic repair: reconcile the
    // reviewed label/identifier even if its old pixel fallback moved. A new
    // explicit point stays exact so duplicate-label rows remain distinct.
    return Boolean(
      semanticTap &&
      existing.kind === "tap" &&
      existing.expectedApp === expectedApp &&
      (semanticTap.identifier?.trim()
        ? existing.target.identifier?.trim() === semanticTap.identifier.trim()
        : existing.target.label?.trim() === semanticTap.label?.trim()),
    );
  })?.id;
}

export type TeachInteraction = NonNullable<OperationInput<"app-map.teach">["interaction"]>;
type InteractionPoint = { x: number; y: number };

export function teachInteractionToAuthoringInteraction(
  interaction: TeachInteraction,
  expectedApp?: string,
): AuthoringInteraction {
  switch (interaction.kind) {
    case "point":
      return {
        kind: "tap",
        target: { point: { x: interaction.x, y: interaction.y } },
        ...(expectedApp ? { expectedApp } : {}),
      };
    case "label":
      return {
        kind: "tap",
        target: {
          label: interaction.label,
          ...(interaction.point ? { point: interaction.point } : {}),
        },
        ...(expectedApp ? { expectedApp } : {}),
      };
    case "identifier":
      return {
        kind: "tap",
        target: {
          identifier: interaction.identifier,
          ...(interaction.point ? { point: interaction.point } : {}),
        },
        ...(expectedApp ? { expectedApp } : {}),
      };
    case "swipe":
      return {
        kind: "swipe",
        from: interaction.from,
        to: interaction.to,
        ...(interaction.durationMs !== undefined ? { durationMs: interaction.durationMs } : {}),
      };
  }
}

function finiteInteractionPoint(value: unknown): InteractionPoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const point = value as Partial<InteractionPoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    ? { x: point.x!, y: point.y! }
    : undefined;
}

export function sourceAnchorForTeachInteraction(
  map: AppMap,
  fromScreenId: string,
  interaction: TeachInteraction,
  resolvedPoint?: InteractionPoint,
  fallbackProfile?: TargetProfile,
): ConnectionSourceAnchor | undefined {
  const screen = map.screens[fromScreenId];
  const viewport =
    screen?.variantIds
      .slice()
      .reverse()
      .map((variantId) => map.screenVariants[variantId]?.targetProfile.viewport)
      .find((candidate) => candidate?.width && candidate.height) ?? fallbackProfile?.viewport;
  if (!viewport?.width || !viewport.height) return undefined;
  const rawPoint =
    resolvedPoint ??
    (interaction.kind === "swipe"
      ? interaction.from
      : interaction.kind === "point"
        ? { x: interaction.x, y: interaction.y }
        : interaction.point);
  const point = finiteInteractionPoint(rawPoint);
  if (!point) return undefined;
  return {
    point: {
      x: Math.max(0, Math.min(1, point.x / viewport.width)),
      y: Math.max(0, Math.min(1, point.y / viewport.height)),
    },
  };
}

export function currentTakeRevision(session: AuthoringSession) {
  const take = session.take;
  return take?.revisions.find((revision) => revision.revision === take.currentRevision);
}

export async function profileForCapture(
  target: OperationInput<"app-map.screen.capture">["target"],
  observedAt: number,
  bounds?: { width: number; height: number },
  dependencies: { listDevices?: typeof listDevices } = {},
): Promise<TargetProfile> {
  const viewport =
    bounds &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
      ? { width: Math.round(bounds.width), height: Math.round(bounds.height) }
      : undefined;
  const viewportKey = viewport ? `-${viewport.width}x${viewport.height}` : "";
  if (target.kind === "device") {
    // Inventory enriches an already captured target profile; it is not capture
    // authority. Preserve the exact target identity when host discovery is down.
    const devices = await (dependencies.listDevices ?? listDevices)().catch(() => []);
    const device = devices.find((item) => item.serial === target.targetId);
    return {
      id: `device:${target.targetId}${viewportKey}`,
      targetId: target.targetId,
      source: "device",
      platform: target.platform,
      name: device?.name?.trim() || target.targetId,
      ...(device?.kind ? { model: device.kind } : {}),
      ...(device?.avdName ? { androidAvdName: device.avdName } : {}),
      ...(device?.osVersion ? { osVersion: device.osVersion } : {}),
      capabilities: ["snapshot", "screenshot"],
      observedAt,
      ...(viewport ? { viewport } : {}),
    };
  }
  const browserCaseProfile = await browserAuthoringCaseProfileForTarget(target.targetId);
  const browserViewport = structuredClone(browserCaseProfile.viewport);
  const browserViewportKey = `-${browserViewport.width}x${browserViewport.height}`;
  const environmentKey = digestAppMapTestExecutionValue(browserCaseProfile).slice(0, 12);
  return {
    id: `browser:${target.targetId}${browserViewportKey}-${environmentKey}`,
    targetId: target.targetId,
    source: "browser",
    platform: "browser",
    name: target.targetId,
    capabilities: [...BROWSER_TARGET_CAPABILITIES],
    observedAt,
    viewport: browserViewport,
    browserCaseProfile,
  };
}
