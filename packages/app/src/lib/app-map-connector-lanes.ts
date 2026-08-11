import type { ConnectionPort, ConnectionPresentation } from "@relay/protocol";
import type { CanvasConnection } from "./app-map-connection-draft";
import type { CanvasPoint } from "./app-map-canvas-layout";

type EdgePort = Exclude<ConnectionPort, "auto">;

type LaneConnection = Pick<
  CanvasConnection,
  "id" | "fromScreenId" | "toScreenId" | "sourceAnchor" | "presentation"
>;

export type ConnectorAutoLane = Pick<ConnectionPresentation, "sourceOffset" | "targetOffset">;

type LaneGroup = {
  direction: EdgePort;
  connections: LaneConnection[];
};

function directionBetween(from: CanvasPoint, to: CanvasPoint): EdgePort {
  const x = to.x - from.x;
  const y = to.y - from.y;
  if (Math.abs(x) >= Math.abs(y)) return x >= 0 ? "right" : "left";
  return y >= 0 ? "bottom" : "top";
}

function opposite(direction: EdgePort): EdgePort {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

function manualPort(port: ConnectionPort | undefined): boolean {
  return Boolean(port && port !== "auto");
}

function supportsAutomaticLane(connection: LaneConnection, endpoint: "source" | "target"): boolean {
  const presentation = connection.presentation;
  if (endpoint === "source") {
    return (
      !connection.sourceAnchor &&
      !manualPort(presentation?.sourcePort) &&
      presentation?.sourceOffset === undefined
    );
  }
  return !manualPort(presentation?.targetPort) && presentation?.targetOffset === undefined;
}

function groupKey(screenId: string, direction: EdgePort): string {
  return `${screenId}\u0000${direction}`;
}

function addToGroup(
  groups: Map<string, LaneGroup>,
  key: string,
  direction: EdgePort,
  connection: LaneConnection,
) {
  const existing = groups.get(key);
  if (existing) {
    existing.connections.push(connection);
    return;
  }
  groups.set(key, { direction, connections: [connection] });
}

function compareAlongPort(direction: EdgePort, left: CanvasPoint, right: CanvasPoint): number {
  // Connections leaving a vertical edge are ordered vertically; connections
  // leaving a horizontal edge are ordered horizontally. This makes the fan
  // follow destination order instead of crossing itself near the source.
  const primary =
    direction === "left" || direction === "right" ? left.y - right.y : left.x - right.x;
  return primary || left.x - right.x || left.y - right.y;
}

function distributeLaneOffsets(
  groups: ReadonlyMap<string, LaneGroup>,
  endpoint: "source" | "target",
  positionFor: (screenId: string) => CanvasPoint | undefined,
  lanes: Map<string, ConnectorAutoLane>,
) {
  for (const group of groups.values()) {
    if (group.connections.length < 2) continue;
    const ordered = [...group.connections].sort((left, right) => {
      const leftPoint = positionFor(endpoint === "source" ? left.toScreenId : left.fromScreenId);
      const rightPoint = positionFor(endpoint === "source" ? right.toScreenId : right.fromScreenId);
      if (leftPoint && rightPoint) {
        const position = compareAlongPort(group.direction, leftPoint, rightPoint);
        if (position) return position;
      }
      return left.id.localeCompare(right.id);
    });
    // A small outer margin keeps port handles inside the card corner radius.
    const padding = ordered.length > 5 ? 0.12 : 0.2;
    for (const [index, connection] of ordered.entries()) {
      const offset = padding + (index * (1 - padding * 2)) / (ordered.length - 1);
      const current = lanes.get(connection.id) ?? {};
      lanes.set(
        connection.id,
        endpoint === "source"
          ? { ...current, sourceOffset: offset }
          : { ...current, targetOffset: offset },
      );
    }
  }
}

/**
 * Derive stable, non-persisted edge lanes for a fan-out/fan-in. Manual ports,
 * manual offsets, and recorded interaction anchors always win. Keeping these
 * lanes computed means a collaboration merge never fights over presentation
 * data merely to make a crowded canvas readable.
 */
export function connectorAutoLanes(
  connections: readonly LaneConnection[],
  positionFor: (screenId: string) => CanvasPoint | undefined,
): ReadonlyMap<string, ConnectorAutoLane> {
  const sourceGroups = new Map<string, LaneGroup>();
  const targetGroups = new Map<string, LaneGroup>();
  for (const connection of connections) {
    const from = positionFor(connection.fromScreenId);
    const to = positionFor(connection.toScreenId);
    if (!from || !to) continue;
    const sourceDirection = directionBetween(from, to);
    if (supportsAutomaticLane(connection, "source")) {
      addToGroup(
        sourceGroups,
        groupKey(connection.fromScreenId, sourceDirection),
        sourceDirection,
        connection,
      );
    }
    if (supportsAutomaticLane(connection, "target")) {
      const targetDirection = opposite(sourceDirection);
      addToGroup(
        targetGroups,
        groupKey(connection.toScreenId, targetDirection),
        targetDirection,
        connection,
      );
    }
  }
  const lanes = new Map<string, ConnectorAutoLane>();
  distributeLaneOffsets(sourceGroups, "source", positionFor, lanes);
  distributeLaneOffsets(targetGroups, "target", positionFor, lanes);
  return lanes;
}

/** Merge a computed lane beneath explicit user presentation values. */
export function connectorPresentationWithAutoLane(
  connection: Pick<CanvasConnection, "id" | "presentation">,
  lanes: ReadonlyMap<string, ConnectorAutoLane>,
): ConnectionPresentation | undefined {
  const lane = lanes.get(connection.id);
  const explicit = Object.fromEntries(
    Object.entries(connection.presentation ?? {}).filter(([, value]) => value !== undefined),
  ) as ConnectionPresentation;
  const presentation = { ...lane, ...explicit };
  return Object.keys(presentation).length ? presentation : undefined;
}
