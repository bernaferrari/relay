import type { ConnectionPort, ConnectionPresentation } from "@relay/protocol";
import type { CanvasConnection } from "./app-map-connection-draft";
import {
  autoConnectorPortPair,
  screenCardGeometry,
  screenFrameBounds,
  type CanvasPoint,
  type ScreenCardGeometry,
} from "./app-map-canvas-layout";

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

function automaticPortPair(
  from: CanvasPoint,
  to: CanvasPoint,
  fromGeometry?: ScreenCardGeometry,
  toGeometry?: ScreenCardGeometry,
): { source: EdgePort; target: EdgePort } {
  return autoConnectorPortPair(
    screenFrameBounds(from, fromGeometry ?? screenCardGeometry()),
    screenFrameBounds(to, toGeometry ?? screenCardGeometry()),
  );
}

function explicitPort(port: ConnectionPort | undefined): EdgePort | undefined {
  return port && port !== "auto" ? port : undefined;
}

function supportsAutomaticLane(connection: LaneConnection, endpoint: "source" | "target"): boolean {
  const presentation = connection.presentation;
  if (endpoint === "source") {
    // An interaction anchor fixes where the connector starts inside the
    // source preview. It does not fix the route's non-persisted fan lane
    // after that point. Only an authored offset opts out of that lane.
    return presentation?.sourceOffset === undefined;
  }
  return presentation?.targetOffset === undefined;
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

/**
 * A recorded interaction is the one reliable ordering signal at a fan's
 * source: it says which control sits above/before another control on the
 * screen.  Destination positions can be rearranged independently (or be
 * temporarily stale while someone drags cards), so using them for an
 * anchored source fan can make a later action claim the outer rail and cut
 * across an earlier one.
 */
function sourceAnchorOrder(
  connection: LaneConnection,
  direction: EdgePort,
): number | undefined {
  const point = connection.sourceAnchor?.point;
  const value = direction === "left" || direction === "right" ? point?.y : point?.x;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

function compareSourceFanOrder(
  direction: EdgePort,
  left: LaneConnection,
  right: LaneConnection,
): number | undefined {
  const leftAnchor = sourceAnchorOrder(left, direction);
  const rightAnchor = sourceAnchorOrder(right, direction);
  if (leftAnchor === undefined && rightAnchor === undefined) return undefined;
  // An unrecorded branch leaves the centre of its source edge before lane
  // distribution moves it. Treat that real default as the comparison point
  // so a planned link above/below a captured action does not jump to an
  // arbitrary end of the fan merely because it lacks source evidence.
  return (leftAnchor ?? 0.5) - (rightAnchor ?? 0.5);
}

function sourcePortDirection(
  connection: LaneConnection,
  positionFor: (screenId: string) => CanvasPoint | undefined,
  geometryFor?: (screenId: string) => ScreenCardGeometry | undefined,
): EdgePort | undefined {
  const from = positionFor(connection.fromScreenId);
  const to = positionFor(connection.toScreenId);
  if (!from || !to) return undefined;
  return (
    explicitPort(connection.presentation?.sourcePort) ??
    automaticPortPair(
      from,
      to,
      geometryFor?.(connection.fromScreenId),
      geometryFor?.(connection.toScreenId),
    ).source
  );
}

function sharesOrderingAxis(left: EdgePort, right: EdgePort): boolean {
  const leftIsVerticalEdge = left === "left" || left === "right";
  const rightIsVerticalEdge = right === "left" || right === "right";
  return leftIsVerticalEdge === rightIsVerticalEdge;
}

function distributeLaneOffsets(
  groups: ReadonlyMap<string, LaneGroup>,
  endpoint: "source" | "target",
  positionFor: (screenId: string) => CanvasPoint | undefined,
  geometryFor: ((screenId: string) => ScreenCardGeometry | undefined) | undefined,
  lanes: Map<string, ConnectorAutoLane>,
) {
  for (const group of groups.values()) {
    if (group.connections.length < 2) continue;
    const ordered = [...group.connections].sort((left, right) => {
      if (endpoint === "source") {
        const sourceOrder = compareSourceFanOrder(group.direction, left, right);
        if (sourceOrder !== undefined && sourceOrder) return sourceOrder;
      }
      // Multiple actions from one screen can converge on the same target.
      // Their source screen positions tie, so keep the target-side handles in
      // the same action order instead of falling through to opaque IDs.
      if (endpoint === "target" && left.fromScreenId === right.fromScreenId) {
        const leftSourceDirection = sourcePortDirection(left, positionFor, geometryFor);
        const rightSourceDirection = sourcePortDirection(right, positionFor, geometryFor);
        if (
          leftSourceDirection &&
          rightSourceDirection &&
          sharesOrderingAxis(leftSourceDirection, rightSourceDirection) &&
          sharesOrderingAxis(leftSourceDirection, group.direction)
        ) {
          const sourceOrder = compareSourceFanOrder(leftSourceDirection, left, right);
          if (sourceOrder !== undefined && sourceOrder) return sourceOrder;
        }
      }
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
 * Derive stable, non-persisted edge lanes for a fan-out/fan-in. Chosen ports
 * and recorded interaction origins stay intact while unset offsets receive a
 * lane. Keeping these lanes computed means a collaboration merge never fights
 * over presentation data merely to make a crowded canvas readable.
 */
export function connectorAutoLanes(
  connections: readonly LaneConnection[],
  positionFor: (screenId: string) => CanvasPoint | undefined,
  geometryFor?: (screenId: string) => ScreenCardGeometry | undefined,
): ReadonlyMap<string, ConnectorAutoLane> {
  const sourceGroups = new Map<string, LaneGroup>();
  const targetGroups = new Map<string, LaneGroup>();
  for (const connection of connections) {
    const from = positionFor(connection.fromScreenId);
    const to = positionFor(connection.toScreenId);
    if (!from || !to) continue;
    const automaticPorts = automaticPortPair(
      from,
      to,
      geometryFor?.(connection.fromScreenId),
      geometryFor?.(connection.toScreenId),
    );
    const sourceDirection = explicitPort(connection.presentation?.sourcePort) ?? automaticPorts.source;
    const targetDirection = explicitPort(connection.presentation?.targetPort) ?? automaticPorts.target;
    if (supportsAutomaticLane(connection, "source")) {
      addToGroup(
        sourceGroups,
        groupKey(connection.fromScreenId, sourceDirection),
        sourceDirection,
        connection,
      );
    }
    if (supportsAutomaticLane(connection, "target")) {
      addToGroup(
        targetGroups,
        groupKey(connection.toScreenId, targetDirection),
        targetDirection,
        connection,
      );
    }
  }
  const lanes = new Map<string, ConnectorAutoLane>();
  distributeLaneOffsets(sourceGroups, "source", positionFor, geometryFor, lanes);
  distributeLaneOffsets(targetGroups, "target", positionFor, geometryFor, lanes);
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

/**
 * Auto lanes are render-only guidance, not authored endpoint placement. Keep
 * that provenance separate from the merged presentation so routing can use a
 * nested fan for computed lanes without changing what an explicit offset
 * means to the person who set it.
 */
export function connectorHasAutomaticSourceLane(
  connection: Pick<CanvasConnection, "id" | "presentation">,
  lanes: ReadonlyMap<string, ConnectorAutoLane>,
): boolean {
  return (
    connection.presentation?.sourceOffset === undefined &&
    lanes.get(connection.id)?.sourceOffset !== undefined
  );
}
